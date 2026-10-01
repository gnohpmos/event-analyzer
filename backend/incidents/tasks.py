"""
Celery background tasks for Incidents Lifecycle, Flapping Soak Timer,
and automated SNMP verification.
"""
import logging
from celery import shared_task
from django.db import transaction
from django.utils import timezone

from common.constants import (
    IncidentStatus, TimelineEventType, Classification, Confidence, IncidentType
)
from incidents.models import Incident

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=5, default_retry_delay=60)
def check_link_soak_completion(self, incident_id: int):
    """
    Validates whether an incident in STABILIZING state has maintained
    continuous UP status for the full soak period (45 minutes).

    Safety:
    Uses select_for_update to avoid race conditions with incoming FLAP events.
    """
    try:
        with transaction.atomic():
            incident = (
                Incident.objects
                .select_for_update()
                .select_related('primary_device')
                .get(id=incident_id)
            )

            # If incident is no longer stabilizing (e.g. flapped and returned to FLAPPING/DOWN), abort
            if incident.status != IncidentStatus.STABILIZING:
                logger.info(
                    f"SOAK_TASK_SKIPPED: Incident {incident.incident_number} "
                    f"status is '{incident.status}' (no longer STABILIZING)"
                )
                return {"status": "skipped", "reason": f"Status is {incident.status}"}

            now = timezone.now()
            if not incident.soak_until:
                logger.warning(f"SOAK_TASK_ABORTED: Incident {incident.incident_number} has no soak_until")
                return {"status": "error", "reason": "No soak_until timestamp"}

            # Verify soak duration has fully elapsed
            if now < incident.soak_until:
                remaining_seconds = int((incident.soak_until - now).total_seconds()) + 2
                logger.info(
                    f"SOAK_TASK_RESCHEDULE: Incident {incident.incident_number} "
                    f"needs {remaining_seconds}s more"
                )
                check_link_soak_completion.apply_async(args=[incident_id], countdown=remaining_seconds)
                return {"status": "rescheduled", "remaining_seconds": remaining_seconds}

            # Soak timer successfully completed!
            incident.status = IncidentStatus.RECOVERED
            incident.up_time = incident.last_up_time or now

            # Determine RCA classification
            if incident.classification in (Classification.PARENT_DEVICE_DOWN, Classification.ADMIN_SHUTDOWN):
                pass  # Keep explicit parent or admin classification
            elif incident.flap_count >= 2:
                incident.classification = Classification.LINK_FLAPPING
                incident.confidence = Confidence.HIGH
            elif (incident.net_downtime_seconds or 0) >= 900:  # 15+ minutes sustained outage -> Physical Failure
                incident.classification = Classification.PHYSICAL_LINK_FAILURE
                incident.confidence = Confidence.HIGH
            else:  # Under 15 minutes isolated glitch -> Transient Glitch
                incident.classification = Classification.TRANSIENT_GLITCH
                incident.confidence = Confidence.HIGH

            incident.save(update_fields=[
                'status', 'up_time', 'classification', 'confidence', 'updated_at'
            ])

            # Record timeline entries
            incident.add_timeline_entry(
                event_type=TimelineEventType.SOAK_TIMER_COMPLETED,
                source='SYSTEM_ENGINE',
                description=(
                    f"Continuous UP soak period (45 mins) successfully completed. "
                    f"Interface [{incident.interface_name}] confirmed stable."
                ),
                data={
                    'soak_completed_at': now.isoformat(),
                    'flap_count': incident.flap_count,
                    'net_downtime_seconds': incident.net_downtime_seconds,
                },
                timestamp=now,
            )

            incident.add_timeline_entry(
                event_type=TimelineEventType.CLASSIFICATION_COMPLETED,
                source='CLASSIFICATION_ENGINE',
                description=f"Automated RCA classification: {incident.classification} ({incident.confidence})",
                data={'classification': incident.classification, 'confidence': incident.confidence},
                timestamp=now,
            )

            incident.add_timeline_entry(
                event_type=TimelineEventType.RECOVERED,
                source='SYSTEM_ENGINE',
                description=f"Incident {incident.incident_number} closed as RECOVERED.",
                data={'downtime_seconds': incident.downtime_seconds},
                timestamp=now,
            )

            logger.info(
                f"SOAK_COMPLETED: Incident {incident.incident_number} "
                f"RECOVERED classification={incident.classification}"
            )

            # Trigger optional SNMP IF-MIB verification
            try:
                from verification.tasks import verify_link_interface_task
                verify_link_interface_task.delay(incident.id)
            except Exception:
                pass

            return {
                "status": "success",
                "incident_number": incident.incident_number,
                "classification": incident.classification,
            }

    except Incident.DoesNotExist:
        logger.error(f"SOAK_TASK_ERROR: Incident id={incident_id} not found")
        return {"status": "error", "message": "Incident not found"}


@shared_task
def sync_pending_tss_tickets_task(interval_hour: int = 24):
    """
    Periodic task to check IPGET for any LINK or DEVICE incidents
    that do not yet have a TSS trouble ticket ID (ticket_id_tss).
    Delegates orchestration to IncidentEnrichmentService.
    """
    from incidents.services import IncidentEnrichmentService
    service = IncidentEnrichmentService()
    return service.enrich_pending_incidents(interval_hour=interval_hour)


@shared_task
def sync_single_incident_ticket_task(incident_id: int):
    """
    On-demand sync for a specific incident (triggered when opening IncidentDetailModal or clicking Sync Ticket).
    Supports both LINK and DEVICE incidents.
    Always queries latest TTS status, repair team, and actual cause.
    Delegates orchestration to IncidentEnrichmentService.
    """
    from incidents.services import IncidentEnrichmentService
    service = IncidentEnrichmentService()
    return service.enrich_single_incident(incident_id)


