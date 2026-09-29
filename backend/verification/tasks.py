"""
Celery tasks for SNMP Verification and Incident Recovery Flow.
"""
import logging
from celery import shared_task
from django.conf import settings
from django.utils import timezone

from common.constants import (
    IncidentStatus, TimelineEventType, VerificationStatus,
    Classification as ClassificationConst
)
from common.settings_helper import get_setting_int
from classification.engine import ClassificationEngine
from incidents.models import Incident
from verification.models import Verification
from verification.engine import VerificationEngine

logger = logging.getLogger(__name__)

verification_engine = VerificationEngine()


@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def run_snmp_verification(self, incident_id: int):
    """
    Asynchronous SNMP sysUpTime verification task.

    Execution Flow:
    1. Fetch Incident and Device
    2. Add SNMP_VERIFY_START to timeline
    3. Query SNMP sysUpTime via VerificationEngine
    4. If Success:
       - Save Verification record (SUCCESS)
       - Classify incident via ClassificationEngine
       - Mark incident as RECOVERED
       - Add timeline entries (SNMP_VERIFY_SUCCESS, CLASSIFICATION_COMPLETED, RECOVERED)
    5. If Failure:
       - Save Verification record (FAILED / TIMEOUT)
       - If retries remaining -> retry after backoff delay
       - If retries exhausted -> mark incident as MANUAL_REVIEW_REQUIRED
    """
    attempt_number = self.request.retries + 1
    max_retries = get_setting_int('SNMP_VERIFY_MAX_RETRIES', 3)
    retry_delay = get_setting_int('SNMP_VERIFY_RETRY_DELAY', 30)
    snmp_timeout = get_setting_int('DEFAULT_SNMP_TIMEOUT', 5)

    try:
        incident = Incident.objects.select_related('primary_device').get(id=incident_id)
    except Incident.DoesNotExist:
        logger.error(f"VERIFICATION_TASK_ABORTED: Incident id={incident_id} not found")
        return {"status": "error", "message": "Incident not found"}

    device = incident.primary_device
    logger.info(
        f"VERIFY_START: incident={incident.incident_number} "
        f"device={device.name} ({device.management_ip}) attempt={attempt_number}/{max_retries}"
    )

    # 1. Timeline: SNMP_VERIFY_START
    incident.add_timeline_entry(
        event_type=TimelineEventType.SNMP_VERIFY_START,
        source='VERIFICATION_ENGINE',
        description=f"Started SNMP sysUpTime verification (attempt {attempt_number}/{max_retries})",
        data={
            "attempt": attempt_number,
            "max_retries": max_retries,
            "device_ip": device.management_ip
        }
    )

    # 2. Run Verification
    verif_res = verification_engine.verify_device(
        device=device,
        timeout=snmp_timeout,
        retries=1
    )

    check_time = timezone.now()

    if not Device.objects.filter(id=device.id).exists() or not Incident.objects.filter(id=incident.id).exists():
        logger.warning(f"Device {device.id} or Incident {incident.id} was deleted during verification. Aborting record creation.")
        return {"status": "aborted", "reason": "Device or incident deleted"}

    # 3. Create Verification Record
    verification_record = Verification.objects.create(
        incident=incident,
        device=device,
        verification_type='SNMP_SYSUPTIME',
        status=verif_res.status,
        check_time=check_time,
        result=verif_res.result,
        evidence=verif_res.evidence,
        error_message=verif_res.error_message,
        attempt_number=attempt_number
    )

    # 4. Handle Result
    if verif_res.status == VerificationStatus.SUCCESS:
        # Success flow: Classify and Recover
        classification, confidence = ClassificationEngine.classify(incident, verification_record)

        incident.status = IncidentStatus.RECOVERED
        incident.classification = classification
        incident.confidence = confidence
        incident.save(update_fields=['status', 'classification', 'confidence', 'updated_at'])

        # Add success timeline events
        incident.add_timeline_entry(
            event_type=TimelineEventType.SNMP_VERIFY_SUCCESS,
            source='VERIFICATION_ENGINE',
            description=f"SNMP sysUpTime retrieved: {verif_res.evidence.get('router_uptime_seconds', 0):.1f}s",
            data=verif_res.evidence
        )

        incident.add_timeline_entry(
            event_type=TimelineEventType.CLASSIFICATION_COMPLETED,
            source='CLASSIFICATION_ENGINE',
            description=f"Incident classified as {classification} (confidence: {confidence or 'N/A'})",
            data={
                "classification": classification,
                "confidence": confidence,
                "evidence": verif_res.evidence
            }
        )

        incident.add_timeline_entry(
            event_type=TimelineEventType.RECOVERED,
            source='CORE_ENGINE',
            description=f"Incident {incident.incident_number} resolved and marked as RECOVERED",
            data={
                "downtime_seconds": incident.downtime_seconds,
                "classification": classification
            }
        )

        logger.info(
            f"VERIFY_COMPLETE: incident={incident.incident_number} "
            f"status=RECOVERED classification={classification} confidence={confidence}"
        )
        return {
            "status": "success",
            "incident": incident.incident_number,
            "classification": classification,
            "confidence": confidence
        }

    else:
        # Failure flow
        logger.warning(
            f"VERIFY_ATTEMPT_FAILED: incident={incident.incident_number} "
            f"attempt={attempt_number} error={verif_res.error_message}"
        )

        if attempt_number < max_retries:
            # Retry available
            incident.status = IncidentStatus.VERIFICATION_FAILED
            incident.save(update_fields=['status', 'updated_at'])

            incident.add_timeline_entry(
                event_type=TimelineEventType.SNMP_VERIFY_RETRY,
                source='VERIFICATION_ENGINE',
                description=f"SNMP check failed ({verif_res.error_message}). Retrying in {retry_delay}s...",
                data={"attempt": attempt_number, "next_retry_seconds": retry_delay}
            )

            # Schedule Celery Retry
            raise self.retry(countdown=retry_delay)

        else:
            # Retries exhausted -> MANUAL_REVIEW_REQUIRED
            incident.status = IncidentStatus.MANUAL_REVIEW_REQUIRED
            incident.classification = ClassificationConst.UNABLE_TO_VERIFY
            incident.confidence = None
            incident.save(update_fields=['status', 'classification', 'confidence', 'updated_at'])

            incident.add_timeline_entry(
                event_type=TimelineEventType.SNMP_VERIFY_FAILED,
                source='VERIFICATION_ENGINE',
                description=f"SNMP verification failed after {max_retries} attempts: {verif_res.error_message}",
                data={"max_retries": max_retries, "last_error": verif_res.error_message}
            )

            incident.add_timeline_entry(
                event_type=TimelineEventType.MANUAL_REVIEW_REQUIRED,
                source='CORE_ENGINE',
                description=f"Incident requires manual review. Could not verify router reboot via SNMP.",
                data={"reason": "SNMP retries exhausted"}
            )

            logger.error(
                f"VERIFY_EXHAUSTED: incident={incident.incident_number} -> MANUAL_REVIEW_REQUIRED"
            )
            return {
                "status": "manual_review_required",
                "incident": incident.incident_number,
                "error": verif_res.error_message
            }
