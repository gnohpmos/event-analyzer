"""
Classification Engine — Fact-based incident classification.
Classifies incidents based on evidence (e.g. SNMP sysUpTime, timestamps).
Does NOT speculate or invent root causes.
"""
from datetime import datetime, timezone as dt_timezone
import logging
from typing import Optional, Tuple

from django.conf import settings
from django.utils import timezone

from common.constants import Classification, Confidence
from incidents.models import Incident
from verification.models import Verification

logger = logging.getLogger(__name__)


class ClassificationEngine:
    """Classifies incidents based on objective evidence."""

    @staticmethod
    def classify(incident: Incident, verification: Optional[Verification]) -> Tuple[str, Optional[str]]:
        """
        Evaluate evidence and return (classification, confidence).

        Classification Types:
          - DEVICE_REBOOT_RELATED (HIGH confidence):
              uptime < threshold AND estimated boot time matches down_time within tolerance.
          - DEVICE_REBOOT_SUSPECTED (LOW / MEDIUM confidence):
              uptime < threshold BUT estimated boot time does not match down_time within tolerance.
          - CONNECTIVITY_LOSS (No confidence rating):
              uptime >= threshold (router has been up longer than the downtime).
          - UNABLE_TO_VERIFY:
              Verification failed, timed out, or unavailable.
        """
        if not verification or not verification.evidence or verification.status != 'SUCCESS':
            logger.info(f"CLASSIFY: {incident.incident_number} -> UNABLE_TO_VERIFY (no success evidence)")
            return Classification.UNABLE_TO_VERIFY, None

        evidence = verification.evidence
        uptime_seconds = evidence.get('router_uptime_seconds')
        estimated_boot_time_str = evidence.get('estimated_boot_time')

        if uptime_seconds is None or not estimated_boot_time_str:
            logger.warning(f"CLASSIFY: {incident.incident_number} missing uptime or boot_time in evidence")
            return Classification.UNABLE_TO_VERIFY, None

        threshold = getattr(settings, 'ROUTER_REBOOT_THRESHOLD_SECONDS', 3600)
        tolerance = getattr(settings, 'REBOOT_TIME_TOLERANCE_SECONDS', 300)

        # Parse estimated boot time
        try:
            estimated_boot_time = datetime.fromisoformat(estimated_boot_time_str)
            if timezone.is_naive(estimated_boot_time):
                estimated_boot_time = timezone.make_aware(estimated_boot_time)
        except (ValueError, TypeError) as e:
            logger.error(f"CLASSIFY: Error parsing estimated_boot_time: {e}")
            return Classification.UNABLE_TO_VERIFY, None

        # Compare uptime with reboot threshold
        if uptime_seconds < threshold:
            # Short uptime: Router was recently restarted
            down_time = incident.down_time
            if timezone.is_naive(down_time):
                down_time = timezone.make_aware(down_time)

            time_diff = abs((estimated_boot_time - down_time).total_seconds())

            logger.info(
                f"CLASSIFY: {incident.incident_number} uptime={uptime_seconds}s "
                f"time_diff={time_diff:.1f}s tolerance={tolerance}s"
            )

            if time_diff <= tolerance:
                # Reboot time aligns with Down event -> HIGH confidence
                return Classification.DEVICE_REBOOT_RELATED, Confidence.HIGH
            else:
                # Router rebooted, but time does not match Down event -> LOW confidence
                return Classification.DEVICE_REBOOT_SUSPECTED, Confidence.LOW

        else:
            # Long uptime: Router was running during the outage -> connectivity loss
            logger.info(
                f"CLASSIFY: {incident.incident_number} uptime={uptime_seconds}s >= threshold={threshold}s "
                f"-> CONNECTIVITY_LOSS"
            )
            return Classification.CONNECTIVITY_LOSS, None
