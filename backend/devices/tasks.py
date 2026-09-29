"""
Celery background tasks for Device SNMP Inventory discovery and auto-enrichment.
"""
import logging
from celery import shared_task
from devices.models import Device
from devices.snmp_inventory import snmp_inventory

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=2, default_retry_delay=15)
def sync_device_snmp_task(self, device_id: int):
    """Asynchronously discover hardware model, serial, and province for a device."""
    try:
        device = Device.objects.get(id=device_id)
        logger.info(f"CELERY_SYNC_DEVICE_START: {device.name} ({device.management_ip})")
        result = snmp_inventory.sync_device(device)
        logger.info(f"CELERY_SYNC_DEVICE_DONE: {device.name} -> {result.get('success')}")
        return result
    except Device.DoesNotExist:
        logger.error(f"CELERY_SYNC_DEVICE_ERROR: Device {device_id} not found")
        return {'success': False, 'error': f'Device {device_id} not found'}
    except Exception as exc:
        if not Device.objects.filter(id=device_id).exists():
            logger.warning(f"Device {device_id} was deleted during SNMP sync task.")
            return {'success': False, 'error': f'Device {device_id} no longer exists'}
        logger.exception(f"CELERY_SYNC_DEVICE_EXCEPTION: {exc}")
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc)
        return {'success': False, 'error': str(exc)}


@shared_task
def sync_all_devices_snmp_task():
    """Batch discover all enabled devices."""
    devices = Device.objects.filter(enabled=True)
    results = []
    logger.info(f"CELERY_SYNC_ALL_DEVICES_START: {devices.count()} devices")
    for device in devices:
        res = snmp_inventory.sync_device(device)
        results.append(res)
    logger.info(f"CELERY_SYNC_ALL_DEVICES_COMPLETED: {len(results)} processed")
    return {'total': len(results), 'results': results}
