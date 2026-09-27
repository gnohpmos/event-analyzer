"""
Event service — stores normalized events with idempotency protection.
"""
import logging
from django.db import IntegrityError
from django.utils import timezone

from events.models import EventSource, NetworkEvent
from devices.models import Device
from integrations.base.adapter import NormalizedEventData
from integrations.prtg.adapter import generate_idempotency_key

logger = logging.getLogger(__name__)


def get_or_create_event_source(source_name: str, source_type: str) -> EventSource:
    """Get or create an EventSource record."""
    source, created = EventSource.objects.get_or_create(
        name=source_name,
        defaults={
            'source_type': source_type,
            'enabled': True,
        }
    )
    if created:
        logger.info(f"EVENT_SOURCE_CREATED: {source_name} ({source_type})")
    return source


def store_event(
    normalized: NormalizedEventData,
    source: EventSource,
    device: Device
) -> tuple[NetworkEvent, bool]:
    """
    Store a normalized event with idempotency protection.

    Returns (event, is_new):
        - (event, True) if new event was stored
        - (event, False) if duplicate was detected
    """
    idempotency_key = generate_idempotency_key(normalized)

    # Check for duplicate
    existing = NetworkEvent.objects.filter(idempotency_key=idempotency_key).first()
    if existing:
        logger.info(f"DUPLICATE_EVENT_DETECTED: key={idempotency_key[:16]}... "
                     f"device={device.name} type={normalized.event_type}/{normalized.event_status}")
        return existing, False

    # Create new event
    try:
        event = NetworkEvent.objects.create(
            source=source,
            source_event_id=normalized.source_event_id,
            device=device,
            event_type=normalized.event_type,
            event_status=normalized.event_status,
            severity=normalized.severity,
            event_time=normalized.event_time,
            received_time=normalized.received_time or timezone.now(),
            message=normalized.message,
            metadata=normalized.metadata,
            raw_payload=normalized.raw_payload,
            idempotency_key=idempotency_key,
        )
        logger.info(f"EVENT_STORED: id={event.id} device={device.name} "
                     f"type={normalized.event_type}/{normalized.event_status}")
        return event, True

    except IntegrityError:
        # Race condition — another request created the same event
        existing = NetworkEvent.objects.filter(idempotency_key=idempotency_key).first()
        if existing:
            logger.info(f"DUPLICATE_EVENT_DETECTED (race): key={idempotency_key[:16]}...")
            return existing, False
        raise
