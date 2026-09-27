"""
Link Incident Engine — Handles Link/Interface incident lifecycle,
carrier-grade LINK_FLAPPING detection, parent device correlation,
and continuous UP Soak Timer (45 minutes).
"""
import logging
from datetime import timedelta
from django.db import transaction
from django.utils import timezone

from common.constants import (
    IncidentType, IncidentStatus, TimelineEventType,
    RelationshipType, Classification, Confidence
)
from devices.models import Device
from events.models import NetworkEvent
from incidents.models import Incident, EventTimeline

logger = logging.getLogger(__name__)

# Configurable constants
FLAP_WINDOW_SECONDS = 1800  # 30 minutes
SOAK_DURATION_MINUTES = 45  # 45 minutes continuous UP required
SOAK_COUNTDOWN_SECONDS = 2700  # 45 * 60 seconds


def generate_link_incident_number() -> str:
    """
    Generate unique link incident number: LNK-YYYYMMDD-NNNNNN.
    Concurrent-safe using select_for_update.
    """
    today = timezone.now().strftime('%Y%m%d')
    prefix = f'LNK-{today}-'

    last = (
        Incident.objects
        .filter(incident_number__startswith=prefix)
        .select_for_update()
        .order_by('-incident_number')
        .first()
    )

    if last:
        try:
            seq = int(last.incident_number.split('-')[-1]) + 1
        except (ValueError, IndexError):
            seq = 1
    else:
        seq = 1

    return f'{prefix}{seq:06d}'


def process_link_event(event: NetworkEvent, device: Device) -> dict:
    """
    Process incoming LINK_STATUS event (DOWN or UP).

    Rules:
    1. Parent Correlation: If primary router has active DEVICE DOWN incident,
       link event as child/supporting without creating a separate Link incident.
    2. Flapping Window (30 min): If repeated DOWN/UP occurs within 30 min of previous
       event for (device, interface), merge into same incident and increment flap_count.
    3. Continuous UP Soak Timer (45 min): When UP is received, status becomes STABILIZING.
       Must stay continuously UP for 45 minutes before RECOVERED.
    4. Reset on DOWN: If DOWN occurs during 45-min stabilization, cancel timer,
       set status to FLAPPING, increment flap_count, and restart wait for next UP.
    """
    metadata = event.metadata or {}
    interface_name = (
        metadata.get('interface_name') or
        metadata.get('prtg_sensor') or
        'Unknown-Interface'
    ).strip()
    prtg_sensor_id = str(metadata.get('prtg_sensor_id') or metadata.get('sensor_id') or '').strip()

    with transaction.atomic():
        # ------------------------------------------------------------------
        # Rule 1: Parent Device Correlation
        # ------------------------------------------------------------------
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

        if parent_incident:
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

        # ------------------------------------------------------------------
        # Rule 2: Find active or recent incident within 30-min Flap Window
        # ------------------------------------------------------------------
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

        is_within_window = False
        if recent_incident:
            time_diff = (event.event_time - recent_incident.last_seen).total_seconds()
            if recent_incident.status in IncidentStatus.ACTIVE_STATUSES or abs(time_diff) <= FLAP_WINDOW_SECONDS:
                is_within_window = True

        # ------------------------------------------------------------------
        # Process Event: DOWN
        # ------------------------------------------------------------------
        if event.event_status == 'DOWN':
            if is_within_window and recent_incident:
                inc = recent_incident

                # Case: DOWN while soak timer was running -> Cancel & Reset
                if inc.status == IncidentStatus.STABILIZING:
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

                # Case: Incident was already RECOVERED but flapped again within 30 mins
                elif inc.status == IncidentStatus.RECOVERED:
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

                # Case: Duplicate DOWN while already DOWN or FLAPPING
                else:
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

            # New Link Incident
            incident_number = generate_link_incident_number()
            inc = Incident.objects.create(
                incident_number=incident_number,
                incident_type=IncidentType.LINK,
                primary_device=device,
                interface_name=interface_name,
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

        # ------------------------------------------------------------------
        # Process Event: UP (Trigger 45-min Soak Timer)
        # ------------------------------------------------------------------
        elif event.event_status == 'UP':
            if is_within_window and recent_incident and recent_incident.status in IncidentStatus.ACTIVE_STATUSES:
                inc = recent_incident

                # Calculate downtime for the outage segment
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

            else:
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

        return {'action': 'IGNORED_UNKNOWN_STATUS', 'status': event.event_status}
