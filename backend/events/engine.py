"""
Core Event Engine — Strategy & Registry-based Event Dispatcher.
Single entry point after event normalization. Follows Open/Closed Principle (OCP).
"""
import logging
from typing import Callable, Dict, Any

from common.constants import EventType, EventStatus
from events.models import NetworkEvent
from devices.models import Device
from incidents.engine import process_down_event, process_up_event
from incidents.link_engine import process_link_event

logger = logging.getLogger(__name__)

EventHandler = Callable[[NetworkEvent, Device], Dict[str, Any]]


def _handle_device_reachability(event: NetworkEvent, device: Device) -> Dict[str, Any]:
    """Strategy handler for Device Reachability events."""
    if event.event_status == EventStatus.DOWN:
        return process_down_event(event, device)
    elif event.event_status == EventStatus.UP:
        return process_up_event(event, device)
    else:
        logger.warning(
            f"UNKNOWN_EVENT_STATUS: {event.event_status} for type={event.event_type} device={device.name}"
        )
        return {'action': 'IGNORED', 'reason': f'Unknown status: {event.event_status}'}


class EventDispatcherRegistry:
    """
    Registry for event type strategies.
    Allows registering new event handlers without modifying core dispatch logic.
    """
    _registry: Dict[str, EventHandler] = {}

    @classmethod
    def register(cls, event_type: str, handler: EventHandler) -> None:
        """Register a handler function for a specific EventType."""
        cls._registry[event_type] = handler

    @classmethod
    def dispatch(cls, event: NetworkEvent, device: Device) -> Dict[str, Any]:
        """Dispatch a normalized event to its registered handler."""
        handler = cls._registry.get(event.event_type)
        if not handler:
            logger.warning(f"UNKNOWN_EVENT_TYPE: {event.event_type} device={device.name}")
            return {
                'action': 'IGNORED',
                'reason': f'Unknown or unregistered event type: {event.event_type}'
            }
        return handler(event, device)


# Register standard built-in handlers
EventDispatcherRegistry.register(EventType.DEVICE_REACHABILITY, _handle_device_reachability)
EventDispatcherRegistry.register(EventType.LINK_STATUS, process_link_event)


def dispatch_event(event: NetworkEvent, device: Device) -> Dict[str, Any]:
    """
    Route a stored NetworkEvent to the correct business logic handler.
    Public interface preserved 100% for callers.
    """
    return EventDispatcherRegistry.dispatch(event, device)
