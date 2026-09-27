"""
Device service — handles device lookup and auto-discovery.
"""
import logging
from django.db import transaction
from devices.models import Device, SourceDeviceMapping
from events.models import EventSource
from integrations.base.adapter import NormalizedEventData

logger = logging.getLogger(__name__)


def get_or_create_device(normalized: NormalizedEventData, source: EventSource) -> Device:
    """
    Find or auto-create a Device from normalized event data.
    Also creates SourceDeviceMapping for future multi-source correlation.

    Lookup priority:
    1. SourceDeviceMapping (if source_event_id has device component)
    2. management_ip match
    3. Auto-create new device
    """
    device_ip = normalized.device_ip
    device_name = normalized.device_name or device_ip

    # Extract source device ID from metadata
    source_device_id = normalized.metadata.get('prtg_device_id', '')

    # 1. Try SourceDeviceMapping first (exact source + source_device_id)
    if source_device_id:
        try:
            mapping = SourceDeviceMapping.objects.select_related('device').get(
                source=source,
                source_device_id=source_device_id
            )
            logger.info(f"DEVICE_MATCHED via SourceDeviceMapping: "
                        f"{source.name}:{source_device_id} → {mapping.device.name}")
            return mapping.device
        except SourceDeviceMapping.DoesNotExist:
            pass

    # 2. Try management_ip match
    try:
        device = Device.objects.get(management_ip=device_ip)
        logger.info(f"DEVICE_MATCHED via management_ip: {device_ip} → {device.name}")

        # Create mapping if source_device_id exists but mapping doesn't
        if source_device_id:
            SourceDeviceMapping.objects.get_or_create(
                source=source,
                source_device_id=source_device_id,
                defaults={
                    'device': device,
                    'metadata': normalized.metadata,
                }
            )
        return device
    except Device.DoesNotExist:
        pass

    # 3. Auto-create device
    with transaction.atomic():
        device, created = Device.objects.get_or_create(
            management_ip=device_ip,
            defaults={
                'name': device_name,
                'device_type': '',
                'enabled': True,
            }
        )

        if created:
            logger.info(f"DEVICE_AUTO_CREATED: {device.name} ({device_ip})")
            # Auto-dispatch SNMP inventory & province discovery in background
            try:
                from devices.tasks import sync_device_snmp_task
                transaction.on_commit(lambda: sync_device_snmp_task.delay(device.id))
            except Exception as e:
                logger.warning(f"Failed to queue SNMP discovery task for {device.id}: {e}")
        else:
            logger.info(f"DEVICE_MATCHED via management_ip (race): {device_ip}")

        # Create source device mapping
        if source_device_id:
            SourceDeviceMapping.objects.get_or_create(
                source=source,
                source_device_id=source_device_id,
                defaults={
                    'device': device,
                    'metadata': normalized.metadata,
                }
            )

    return device
