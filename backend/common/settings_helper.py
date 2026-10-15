import os
import logging
from django.conf import settings

logger = logging.getLogger(__name__)

DEFAULT_SETTINGS = {
    'SNMP_COMMUNITY': {
        'value': 'public',
        'category': 'SNMP',
        'description': 'Default SNMP v2c community string for device sysUpTime verification',
        'is_secret': True,
    },
    'SNMP_VERIFY_MAX_RETRIES': {
        'value': '3',
        'category': 'SNMP',
        'description': 'Maximum number of retries for SNMP sysUpTime query',
        'is_secret': False,
    },
    'SNMP_VERIFY_RETRY_DELAY': {
        'value': '30',
        'category': 'SNMP',
        'description': 'Delay between SNMP verification retries in seconds',
        'is_secret': False,
    },
    'DEFAULT_SNMP_TIMEOUT': {
        'value': '5',
        'category': 'SNMP',
        'description': 'Timeout in seconds for a single SNMP request',
        'is_secret': False,
    },
    'ROUTER_REBOOT_THRESHOLD_SECONDS': {
        'value': '3600',
        'category': 'THRESHOLD',
        'description': 'Uptime threshold (in seconds) to consider a router recently rebooted (< 1 hr)',
        'is_secret': False,
    },
    'REBOOT_TIME_TOLERANCE_SECONDS': {
        'value': '300',
        'category': 'THRESHOLD',
        'description': 'Allowed delta between estimated boot time and event trigger time (in seconds)',
        'is_secret': False,
    },
    'PRTG_ENABLED': {
        'value': 'True',
        'category': 'INTEGRATION',
        'description': 'Enable or disable PRTG webhook ingestion',
        'is_secret': False,
    },
    'PRTG_API_TOKEN': {
        'value': 'prtg-secure-webhook-token-2026',
        'category': 'INTEGRATION',
        'description': 'Shared secret token for PRTG webhook authorization',
        'is_secret': True,
    },
    'SSH_USERNAME': {
        'value': 'admin',
        'category': 'SSH',
        'description': 'Default SSH Username for Cisco IOS-XR show reboot-history automation',
        'is_secret': False,
    },
    'SSH_PASSWORD': {
        'value': '',
        'category': 'SSH',
        'description': 'Default SSH Password for Cisco IOS-XR automation',
        'is_secret': True,
    },
    'SSH_PORT': {
        'value': '22',
        'category': 'SSH',
        'description': 'Default SSH Port (typically 22)',
        'is_secret': False,
    },
    'SSH_TIMEOUT': {
        'value': '5',
        'category': 'SSH',
        'description': 'Timeout in seconds for SSH connection and command execution',
        'is_secret': False,
    },
    'OSTICKET_AUTO_CREATE': {
        'value': 'False',
        'category': 'INTEGRATION',
        'description': 'Enable or disable automated osTicket creation for confirmed incidents',
        'is_secret': False,
    },
    'OSTICKET_AUTO_CREATE_DELAY_SECONDS': {
        'value': '0',
        'category': 'INTEGRATION',
        'description': 'Delay in seconds after NT TTS ticket is linked before automatically creating osTicket (0 = immediate)',
        'is_secret': False,
    },
    'OSTICKET_TOPIC_ID': {
        'value': '27',
        'category': 'INTEGRATION',
        'description': 'Default osTicket Help Topic ID (27 = CATMA TTS)',
        'is_secret': False,
    },
    'OSTICKET_SLA_ID': {
        'value': '10',
        'category': 'INTEGRATION',
        'description': 'Default osTicket SLA Plan ID',
        'is_secret': False,
    },
    'OSTICKET_SENDER_NAME': {
        'value': 'พงศธร พันสนิท',
        'category': 'INTEGRATION',
        'description': 'Default Staff/Sender Name for osTicket creation',
        'is_secret': False,
    },
    'OSTICKET_SENDER_EMAIL': {
        'value': 'p.pansanit@gmail.com',
        'category': 'INTEGRATION',
        'description': 'Default Staff/Sender Email for osTicket creation',
        'is_secret': False,
    },
}


def get_setting(key: str, default=None):
    """
    Retrieve dynamic setting from database first, fallback to Django settings / os.environ / default.
    Safe to call from both synchronous and asynchronous contexts.
    """
    import asyncio
    from common.models import SystemSetting
    try:
        # Check if running in an active event loop
        loop = None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            pass

        if loop is not None and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(lambda: SystemSetting.objects.filter(key=key).first())
                obj = future.result(timeout=2.0)
        else:
            obj = SystemSetting.objects.filter(key=key).first()

        if obj and obj.value is not None:
            return obj.value
    except Exception as e:
        logger.debug(f"Could not load setting {key} from DB: {e}")

    # Fallback to Django settings or environment variable
    return getattr(settings, key, os.environ.get(key, default))


def get_setting_int(key: str, default: int = 0) -> int:
    val = get_setting(key, default)
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def set_setting(key: str, value: str, category: str = 'GENERAL', description: str = '', is_secret: bool = False):
    from common.models import SystemSetting
    obj, _ = SystemSetting.objects.update_or_create(
        key=key,
        defaults={
            'value': str(value),
            'category': category,
            'description': description,
            'is_secret': is_secret
        }
    )
    return obj


def seed_default_settings():
    """Seed initial defaults from .env or DEFAULT_SETTINGS if not already present."""
    from common.models import SystemSetting
    for key, info in DEFAULT_SETTINGS.items():
        env_val = os.environ.get(key, getattr(settings, key, info['value']))
        SystemSetting.objects.get_or_create(
            key=key,
            defaults={
                'value': str(env_val),
                'category': info['category'],
                'description': info['description'],
                'is_secret': info['is_secret']
            }
        )
