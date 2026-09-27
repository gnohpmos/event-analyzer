"""
Sequence & Identifier Generator.
Provides concurrency-safe sequence generation for incidents and domain entities.
Follows DRY and Single Responsibility Principle.
"""
import logging
from django.db import transaction
from django.utils import timezone
from incidents.models import Incident

logger = logging.getLogger(__name__)


class IncidentNumberFactory:
    """
    Factory for generating formatted incident numbers: {PREFIX}-YYYYMMDD-NNNNNN.
    Thread-safe and concurrency-safe via SELECT FOR UPDATE.
    """

    @classmethod
    def generate(cls, prefix_type: str = 'INC') -> str:
        """
        Generates the next sequential incident identifier.
        
        Args:
            prefix_type: Prefix code (e.g. 'INC' for Device incidents, 'LNK' for Link incidents).
            
        Returns:
            Formatted incident number string (e.g. 'INC-20260927-000005', 'LNK-20260927-000003').
        """
        today = timezone.now().strftime('%Y%m%d')
        clean_prefix = f"{prefix_type.strip().upper()}-{today}-"

        with transaction.atomic():
            # Lock the most recent matching record to avoid race conditions in sequence generation
            last_incident = (
                Incident.objects
                .filter(incident_number__startswith=clean_prefix)
                .select_for_update()
                .order_by('-incident_number')
                .first()
            )

        next_sequence = 1
        if last_incident and last_incident.incident_number:
            try:
                # Extract sequence portion from 'PREFIX-YYYYMMDD-NNNNNN'
                sequence_part = last_incident.incident_number.split('-')[-1]
                next_sequence = int(sequence_part) + 1
            except (ValueError, IndexError) as err:
                logger.warning(
                    f"Failed to parse sequence from {last_incident.incident_number}: {err}. Resetting to 1."
                )
                next_sequence = 1

        return f"{clean_prefix}{next_sequence:06d}"
