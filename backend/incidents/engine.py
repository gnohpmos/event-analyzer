"""
Incident Engine — Core business logic for incident lifecycle.
Operates ONLY on normalized events. No source-specific logic here.
"""
import logging
from django.db import transaction
from django.utils import timezone

from common.constants import (
    EventType, EventStatus, IncidentStatus,
    TimelineEventType, RelationshipType
)
from devices.models import Device
from events.models import NetworkEvent
from incidents.models import Incident, IncidentEvent, EventTimeline

logger = logging.getLogger(__name__)


def generate_incident_number() -> str:
    """
    Generate human-readable incident number: INC-YYYYMMDD-NNNNNN.
    Uses select_for_update to ensure concurrent safety.
    """
    today = timezone.now().strftime('%Y%m%d')
    prefix = f'INC-{today}-'

    last = (
        Incident.objects
        .filter(incident_number__startswith=prefix)
        .select_for_update()
        .order_by('-incident_number')
        .first()
    )

    if last:
        seq = int(last.incident_number.split('-')[-1]) + 1
    else:
        seq = 1

    return f'{prefix}{seq:06d}'


def process_down_event(event: NetworkEvent, device: Device) -> dict:
    """
    FLOW A — Device DOWN.
    1. Check for active incident on this device
    2. If none → create new incident
    3. If exists → record DOWN_REPEAT
    """
    with transaction.atomic():
        # Find active incident for this device
        active_incident = (
            Incident.objects
            .filter(
                primary_device=device,
                status__in=IncidentStatus.ACTIVE_STATUSES
            )
            .select_for_update()
            .first()
        )

        if active_incident:
            # Duplicate DOWN — don't create new incident
            active_incident.last_seen = event.event_time
            active_incident.save(update_fields=['last_seen', 'updated_at'])

            # Link event to existing incident
            active_incident.link_event(event, RelationshipType.RELATED)

            # Timeline entry
            active_incident.add_timeline_entry(
                event_type=TimelineEventType.DOWN_REPEAT,
                source=event.source.name,
                description=f'Duplicate DOWN event from {event.source.name}',
                data={'event_id': event.id, 'message': event.message},
                timestamp=event.event_time,
            )

            logger.info(
                f"INCIDENT_MATCHED: {active_incident.incident_number} "
                f"device={device.name} (DOWN_REPEAT)"
            )
            return {
                'action': 'DOWN_REPEAT',
                'incident_number': active_incident.incident_number,
                'incident_id': active_incident.id,
            }

        else:
            # New incident
            incident_number = generate_incident_number()
            incident = Incident.objects.create(
                incident_number=incident_number,
                primary_device=device,
                status=IncidentStatus.DOWN,
                down_time=event.event_time,
                last_seen=event.event_time,
            )

            # Link event
            incident.link_event(event, RelationshipType.PRIMARY)

            # Timeline entry
            incident.add_timeline_entry(
                event_type=TimelineEventType.DOWN,
                source=event.source.name,
                description=f'Device DOWN detected by {event.source.name}',
                data={'event_id': event.id, 'message': event.message},
                timestamp=event.event_time,
            )

            logger.info(
                f"INCIDENT_CREATED: {incident_number} "
                f"device={device.name} down_time={event.event_time}"
            )
            return {
                'action': 'INCIDENT_CREATED',
                'incident_number': incident_number,
                'incident_id': incident.id,
            }


def process_up_event(event: NetworkEvent, device: Device) -> dict:
    """
    FLOW B — Device UP.
    1. Find active DOWN incident for device
    2. If found → transition to RECOVERY_CHECK, dispatch SNMP verification
    3. If not found → log UP_WITHOUT_ACTIVE_INCIDENT (Edge Case 1)
    """
    with transaction.atomic():
        active_incident = (
            Incident.objects
            .filter(
                primary_device=device,
                status=IncidentStatus.DOWN
            )
            .select_for_update()
            .first()
        )

        if active_incident:
            # Transition to RECOVERY_CHECK
            active_incident.up_time = event.event_time
            active_incident.last_seen = event.event_time
            active_incident.status = IncidentStatus.RECOVERY_CHECK
            active_incident.save(update_fields=['up_time', 'last_seen', 'status', 'updated_at'])

            # Link event
            active_incident.link_event(event, RelationshipType.RECOVERY)

            # Timeline entry
            active_incident.add_timeline_entry(
                event_type=TimelineEventType.UP_RECEIVED,
                source=event.source.name,
                description=f'Device UP detected by {event.source.name}',
                data={'event_id': event.id, 'message': event.message},
                timestamp=event.event_time,
            )

            logger.info(
                f"UP_RECEIVED: {active_incident.incident_number} "
                f"device={device.name} → RECOVERY_CHECK"
            )

            # Dispatch SNMP Verification (async via Celery)
            try:
                from verification.tasks import run_snmp_verification
                run_snmp_verification.delay(active_incident.id)
                logger.info(f"VERIFICATION_DISPATCHED: {active_incident.incident_number}")
            except Exception as e:
                logger.error(f"VERIFICATION_DISPATCH_FAILED: {e}")

            return {
                'action': 'RECOVERY_CHECK',
                'incident_number': active_incident.incident_number,
                'incident_id': active_incident.id,
            }

        else:
            # UP without active incident — audit record in EventTimeline
            EventTimeline.objects.create(
                incident=None,
                event_type=TimelineEventType.UP_WITHOUT_ACTIVE_INCIDENT,
                source=event.source.name,
                description=f'UP event received but no active DOWN incident for {device.name} ({device.management_ip})',
                data={
                    'event_id': event.id,
                    'device_name': device.name,
                    'device_ip': device.management_ip,
                    'message': event.message,
                },
                timestamp=event.event_time,
            )

            logger.warning(
                f"UP_WITHOUT_ACTIVE_INCIDENT: device={device.name} "
                f"source={event.source.name}"
            )
            return {
                'action': 'UP_WITHOUT_ACTIVE_INCIDENT',
                'device': device.name,
            }
