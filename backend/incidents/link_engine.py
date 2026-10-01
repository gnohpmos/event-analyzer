"""
Link Incident Engine — Handles Link/Interface incident lifecycle,
carrier-grade LINK_FLAPPING detection, parent device correlation,
and continuous UP Soak Timer (45 minutes).
"""
import logging
from datetime import timedelta
from typing import Optional, Tuple
from django.db import transaction

from common.constants import (
    IncidentType, IncidentStatus, TimelineEventType,
    RelationshipType, Classification
)
from common.sequence_generator import IncidentNumberFactory
from devices.models import Device
from events.models import NetworkEvent
from incidents.models import Incident, EventTimeline

logger = logging.getLogger(__name__)

# Configurable constants
FLAP_WINDOW_SECONDS = 1800      # 30 minutes
SOAK_DURATION_MINUTES = 45      # 45 minutes continuous UP required
SOAK_COUNTDOWN_SECONDS = 2700    # 45 * 60 seconds


def generate_link_incident_number() -> str:
    """
    Generate unique link incident number: LNK-YYYYMMDD-NNNNNN.
    Delegates to centralized IncidentNumberFactory.
    """
    return IncidentNumberFactory.generate(prefix_type='LNK')


def process_link_event(event: NetworkEvent, device: Device) -> dict:
    """
    Process incoming LINK_STATUS event (DOWN or UP).

    Applies the 4 Carrier-Grade Rules:
    1. Parent Correlation: Suppresses link event if parent router is currently DOWN.
    2. Flapping Window (30 min): Re-uses incident and increments flap_count on repeated changes.
    3. Continuous UP Soak Timer (45 min): Holds incident in STABILIZING for 45 minutes.
    4. Reset on DOWN: Resets soak timer immediately if interface drops again during stabilization.
    """
    metadata = event.metadata or {}
    interface_name = (
        metadata.get('interface_name') or
        metadata.get('prtg_sensor') or
        'Unknown-Interface'
    ).strip()
    link_description = str(metadata.get('link_description') or '').strip()
    prtg_sensor_id = str(metadata.get('prtg_sensor_id') or metadata.get('sensor_id') or '').strip()

    with transaction.atomic():
        # Rule 1: Parent Device Correlation
        parent_result = _correlate_with_parent_device(device, event, interface_name)
        if parent_result:
            return parent_result

        # Rule 2: Find active or recent incident within 30-min Flap Window
        recent_incident, is_within_window = _find_recent_link_incident(
            device, interface_name, link_description, event.event_time
        )

        # Dispatch by event status (Guard Clauses)
        if event.event_status == 'DOWN':
            return _handle_link_down(
                device, event, interface_name, link_description, prtg_sensor_id,
                recent_incident, is_within_window
            )
        elif event.event_status == 'UP':
            return _handle_link_up(
                device, event, interface_name,
                recent_incident, is_within_window
            )

        return {'action': 'IGNORED_UNKNOWN_STATUS', 'status': event.event_status}


# =============================================================================
# Helper Handlers & Decomposition (Clean Code SRP)
# =============================================================================

def _correlate_with_parent_device(
    device: Device,
    event: NetworkEvent,
    interface_name: str
) -> Optional[dict]:
    """
    Rule 1: If primary router has an active DEVICE DOWN incident,
    link the event as subordinate without creating a separate Link incident.
    """
    parent_incident = (
        Incident.objects
        .filter(
            incident_type=IncidentType.DEVICE,
            primary_device=device,
            status__in=IncidentStatus.ACTIVE_STATUSES
        )
        .select_for_update()
        .first()
    )
    if not parent_incident:
        return None

    parent_incident.link_event(event, RelationshipType.SUPPORTING)
    parent_incident.add_timeline_entry(
        event_type=TimelineEventType.LINK_DOWN if event.event_status == 'DOWN' else TimelineEventType.LINK_UP,
        source=event.source.name,
        description=(
            f"Subordinate interface [{interface_name}] {event.event_status} "
            f"suppressed under parent device outage ({parent_incident.incident_number})"
        ),
        data={
            'event_id': event.id,
            'interface_name': interface_name,
            'link_status': event.event_status,
            'classification': Classification.PARENT_DEVICE_DOWN,
        },
        timestamp=event.event_time,
    )
    logger.info(
        f"PARENT_CORRELATION: event={event.id} ({interface_name} {event.event_status}) "
        f"linked to parent incident={parent_incident.incident_number}"
    )
    return {
        'action': 'LINKED_TO_PARENT_DEVICE',
        'parent_incident_number': parent_incident.incident_number,
        'classification': Classification.PARENT_DEVICE_DOWN,
        'interface_name': interface_name,
    }


def _find_recent_link_incident(
    device: Device,
    interface_name: str,
    link_description: str,
    event_time
) -> Tuple[Optional[Incident], bool]:
    """
    Rule 2: Finds recent incident for (device, interface) and checks
    if event occurred within the 30-minute flapping window.
    """
    recent_incident = (
        Incident.objects
        .filter(
            incident_type=IncidentType.LINK,
            primary_device=device,
            interface_name=interface_name,
        )
        .select_for_update()
        .order_by('-last_seen')
        .first()
    )

    if not recent_incident:
        return None, False

    if not recent_incident.link_description and link_description:
        recent_incident.link_description = link_description
        recent_incident.save(update_fields=['link_description', 'updated_at'])

    time_diff = (event_time - recent_incident.last_seen).total_seconds()
    is_within_window = (
        recent_incident.status in IncidentStatus.ACTIVE_STATUSES or
        abs(time_diff) <= FLAP_WINDOW_SECONDS
    )
    return recent_incident, is_within_window


def _handle_link_down(
    device: Device,
    event: NetworkEvent,
    interface_name: str,
    link_description: str,
    prtg_sensor_id: str,
    recent_incident: Optional[Incident],
    is_within_window: bool
) -> dict:
    """Handles DOWN event for an interface."""
    if is_within_window and recent_incident:
        inc = recent_incident

        # Case 1: DOWN during soak stabilization -> Cancel timer and Flap
        if inc.status == IncidentStatus.STABILIZING:
            return _handle_down_during_soak(inc, event, interface_name)

        # Case 2: Incident was already RECOVERED but flapped again within 30 min window
        if inc.status == IncidentStatus.RECOVERED:
            return _handle_down_reopen_recovered(inc, event, interface_name)

        # Case 3: Duplicate DOWN while already DOWN or FLAPPING
        return _handle_down_repeat(inc, event, interface_name)

    # Case 4: Create new Link Incident
    return _create_new_link_incident(
        device, event, interface_name, link_description, prtg_sensor_id
    )


def _handle_down_during_soak(inc: Incident, event: NetworkEvent, interface_name: str) -> dict:
    """Rule 4: Cancels soak timer and increments flap count when DOWN occurs during soak."""
    inc.soak_until = None
    inc.status = IncidentStatus.FLAPPING
    inc.flap_count += 1
    inc.last_down_time = event.event_time
    inc.last_seen = event.event_time
    inc.save(update_fields=[
        'soak_until', 'status', 'flap_count',
        'last_down_time', 'last_seen', 'updated_at'
    ])

    inc.link_event(event, RelationshipType.RELATED)
    inc.add_timeline_entry(
        event_type=TimelineEventType.SOAK_TIMER_RESET,
        source=event.source.name,
        description=(
            f"Interface [{interface_name}] dropped DOWN again during 45-min soak window! "
            f"Soak timer cancelled. Status set to FLAPPING (Flap #{inc.flap_count})"
        ),
        data={'event_id': event.id, 'flap_count': inc.flap_count},
        timestamp=event.event_time,
    )
    inc.add_timeline_entry(
        event_type=TimelineEventType.LINK_FLAP_DETECTED,
        source=event.source.name,
        description=f"LINK_FLAPPING cycle detected on {interface_name}",
        data={'event_id': event.id, 'flap_count': inc.flap_count},
        timestamp=event.event_time,
    )
    logger.warning(
        f"SOAK_TIMER_RESET: incident={inc.incident_number} "
        f"interface={interface_name} flap_count={inc.flap_count}"
    )
    return {
        'action': 'SOAK_TIMER_RESET_FLAPPING',
        'incident_number': inc.incident_number,
        'flap_count': inc.flap_count,
    }


def _handle_down_reopen_recovered(inc: Incident, event: NetworkEvent, interface_name: str) -> dict:
    """Reopens a recently recovered incident as FLAPPING if interface drops within 30 mins."""
    inc.status = IncidentStatus.FLAPPING
    inc.flap_count += 1
    inc.last_down_time = event.event_time
    inc.last_seen = event.event_time
    inc.up_time = None
    inc.save(update_fields=[
        'status', 'flap_count', 'last_down_time',
        'last_seen', 'up_time', 'updated_at'
    ])

    inc.link_event(event, RelationshipType.RELATED)
    inc.add_timeline_entry(
        event_type=TimelineEventType.LINK_FLAP_DETECTED,
        source=event.source.name,
        description=(
            f"Interface [{interface_name}] went DOWN again within 30 min flap window. "
            f"Incident reopened as FLAPPING (Flap #{inc.flap_count})"
        ),
        data={'event_id': event.id, 'flap_count': inc.flap_count},
        timestamp=event.event_time,
    )
    return {
        'action': 'REOPENED_FLAPPING',
        'incident_number': inc.incident_number,
        'flap_count': inc.flap_count,
    }


def _handle_down_repeat(inc: Incident, event: NetworkEvent, interface_name: str) -> dict:
    """Records repeat DOWN without changing existing incident state."""
    inc.last_seen = event.event_time
    inc.save(update_fields=['last_seen', 'updated_at'])
    inc.link_event(event, RelationshipType.RELATED)
    inc.add_timeline_entry(
        event_type=TimelineEventType.DOWN_REPEAT,
        source=event.source.name,
        description=f"Duplicate LINK_DOWN event for {interface_name}",
        data={'event_id': event.id},
        timestamp=event.event_time,
    )
    return {
        'action': 'DOWN_REPEAT',
        'incident_number': inc.incident_number,
    }


def _create_new_link_incident(
    device: Device,
    event: NetworkEvent,
    interface_name: str,
    link_description: str,
    prtg_sensor_id: str
) -> dict:
    """Creates a new link outage incident."""
    incident_number = generate_link_incident_number()
    inc = Incident.objects.create(
        incident_number=incident_number,
        incident_type=IncidentType.LINK,
        primary_device=device,
        interface_name=interface_name,
        link_description=link_description,
        prtg_sensor_id=prtg_sensor_id,
        status=IncidentStatus.DOWN,
        down_time=event.event_time,
        last_down_time=event.event_time,
        last_seen=event.event_time,
        flap_count=0,
        net_downtime_seconds=0.0,
    )
    inc.link_event(event, RelationshipType.PRIMARY)
    inc.add_timeline_entry(
        event_type=TimelineEventType.LINK_DOWN,
        source=event.source.name,
        description=f"Interface [{interface_name}] DOWN detected by {event.source.name}",
        data={'event_id': event.id, 'interface_name': interface_name, 'message': event.message},
        timestamp=event.event_time,
    )
    logger.info(f"LINK_INCIDENT_CREATED: {incident_number} interface={interface_name}")
    return {
        'action': 'LINK_INCIDENT_CREATED',
        'incident_number': incident_number,
        'incident_id': inc.id,
    }


def _handle_link_up(
    device: Device,
    event: NetworkEvent,
    interface_name: str,
    recent_incident: Optional[Incident],
    is_within_window: bool
) -> dict:
    """Rule 3: Handles UP event by entering 45-min continuous soak period."""
    if is_within_window and recent_incident and recent_incident.status in IncidentStatus.ACTIVE_STATUSES:
        inc = recent_incident

        # Calculate outage segment duration
        ref_down = inc.last_down_time or inc.down_time
        if ref_down and event.event_time > ref_down:
            segment = (event.event_time - ref_down).total_seconds()
            inc.net_downtime_seconds = (inc.net_downtime_seconds or 0.0) + segment

        # Set 45-minute continuous UP soak window
        soak_until = event.event_time + timedelta(minutes=SOAK_DURATION_MINUTES)
        inc.last_up_time = event.event_time
        inc.last_seen = event.event_time
        inc.status = IncidentStatus.STABILIZING
        inc.soak_until = soak_until
        inc.save(update_fields=[
            'net_downtime_seconds', 'last_up_time', 'last_seen',
            'status', 'soak_until', 'updated_at'
        ])

        inc.link_event(event, RelationshipType.RECOVERY)
        inc.add_timeline_entry(
            event_type=TimelineEventType.SOAK_TIMER_START,
            source=event.source.name,
            description=(
                f"Interface [{interface_name}] came UP. Starting 45-minute continuous hold-down "
                f"soak timer until {soak_until.strftime('%H:%M:%S UTC')}. "
                f"Accumulated Net Downtime: {round(inc.net_downtime_seconds, 1)}s"
            ),
            data={
                'event_id': event.id,
                'soak_until': soak_until.isoformat(),
                'net_downtime_seconds': inc.net_downtime_seconds,
            },
            timestamp=event.event_time,
        )

        # Schedule Celery background task for 45-minute countdown verification
        try:
            from incidents.tasks import check_link_soak_completion
            check_link_soak_completion.apply_async(
                args=[inc.id],
                countdown=SOAK_COUNTDOWN_SECONDS
            )
        except Exception as ex:
            logger.warning(f"Failed to schedule soak completion task: {ex}")

        logger.info(
            f"SOAK_TIMER_STARTED: incident={inc.incident_number} "
            f"interface={interface_name} soak_until={soak_until.isoformat()}"
        )
        return {
            'action': 'SOAK_TIMER_STARTED',
            'incident_number': inc.incident_number,
            'soak_until': soak_until.isoformat(),
            'net_downtime_seconds': inc.net_downtime_seconds,
        }

    # UP event received without active incident
    EventTimeline.objects.create(
        incident=None,
        event_type=TimelineEventType.UP_WITHOUT_ACTIVE_INCIDENT,
        source=event.source.name,
        description=f"Standalone LINK_UP received for {device.name} port {interface_name} (no active incident)",
        data={'event_id': event.id, 'interface_name': interface_name},
        timestamp=event.event_time,
    )
    return {
        'action': 'IGNORED_NO_ACTIVE_INCIDENT',
        'device': device.name,
        'interface_name': interface_name,
    }
