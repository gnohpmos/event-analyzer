"""
Core Event Engine — dispatches normalized events to the appropriate handler.
This is the single entry point after normalization. Source-agnostic.
"""
import logging
from common.constants import EventType, EventStatus
from events.models import NetworkEvent
from devices.models import Device
from incidents.engine import process_down_event, process_up_event
from incidents.link_engine import process_link_event

logger = logging.getLogger(__name__)


def dispatch_event(event: NetworkEvent, device: Device) -> dict:
    """
    Route a stored NetworkEvent to the correct business logic handler.
    Uses event_type and event_status — NEVER source-specific fields.
    """
    if event.event_type == EventType.DEVICE_REACHABILITY:
        if event.event_status == EventStatus.DOWN:
            return process_down_event(event, device)
        elif event.event_status == EventStatus.UP:
            return process_up_event(event, device)
        else:
            logger.warning(
                f"UNKNOWN_EVENT_STATUS: {event.event_status} "
                f"for type={event.event_type} device={device.name}"
            )
            return {'action': 'IGNORED', 'reason': f'Unknown status: {event.event_status}'}

    elif event.event_type == EventType.LINK_STATUS:
        return process_link_event(event, device)

    else:
        logger.warning(
            f"UNKNOWN_EVENT_TYPE: {event.event_type} device={device.name}"
        )
        return {'action': 'IGNORED', 'reason': f'Unknown event type: {event.event_type}'}
