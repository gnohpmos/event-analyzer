"""
PRTG Source Adapter — converts PRTG HTTP Notification payloads
into NormalizedEventData for the Core Event Engine.

This is the ONLY place where PRTG-specific field names exist.
"""
import hashlib
import logging
import re
from datetime import datetime
from typing import Optional

from django.conf import settings
from django.utils import timezone

from common.constants import EventType, EventStatus, Severity
from integrations.base.adapter import BaseSourceAdapter, NormalizedEventData

logger = logging.getLogger(__name__)


def extract_interface_name(sensor_name: str, payload_interface: str = '') -> str:
    """
    Extract clean interface/port name from PRTG sensor title or interface field.
    Handles all PRTG conventions:
      - '(HundredGigE0/1/0/0) TBB0000726 : MPLS 100GE...' -> 'HundredGigE0/1/0/0'
      - '(TenGigE0/0/0/27) TBB_______ : MPLS 10GE...' -> 'TenGigE0/0/0/27'
      - '(Vlan56) Vlan56 (SNMP Traffic)' -> 'Vlan56'
      - 'GigabitEthernet0/0/1 (SNMP Traffic)' -> 'GigabitEthernet0/0/1'
      - 'Traffic: GigabitEthernet0/1' -> 'GigabitEthernet0/1'
      - 'Bundle-Ether1' -> 'Bundle-Ether1'
    """
    if payload_interface and payload_interface.strip():
        return payload_interface.strip()

    if not sensor_name:
        return 'Unknown-Interface'

    s = sensor_name.strip()

    # Rule 1: First check if leading token is in parentheses like (HundredGigE0/1/0/0) or (Vlan56)
    m = re.match(r'^\(([A-Za-z0-9_\/\.\-]+)\)', s)
    if m:
        candidate = m.group(1).strip()
        # Interface names have digits, slashes, or common network port prefixes
        if (any(c.isdigit() for c in candidate) or '/' in candidate or
                candidate.lower().startswith(('eth', 'ge', 'xe', 'et', 'lo', 'vl', 'po', 'bu', 'hu', 'te', 'fa', 'gi'))):
            return candidate

    # Strip (SNMP Traffic) or (Traffic) at the end
    s = re.sub(r'\s*\((?:SNMP\s+)?Traffic\)\s*$', '', s, flags=re.IGNORECASE)
    # Remove prefix like 'Traffic:', 'Traffic (', 'Interface '
    s = re.sub(r'^(?:Traffic\s*[:\-\(\[]\s*|Interface\s*[:\-\(\[]?\s*)', '', s, flags=re.IGNORECASE)
    # Remove suffix like ' Traffic', ')'
    s = re.sub(r'[\)\]]$', '', s)
    s = re.sub(r'\s+Traffic$', '', s, flags=re.IGNORECASE)

    # If pattern like '(Vlan56) Vlan56' where alias equals name
    m = re.match(r'^\(([^)]+)\)\s*(.*)$', s)
    if m:
        alias, name = m.group(1).strip(), m.group(2).strip()
        if alias.lower() == name.lower() or not name:
            s = alias
        elif alias.lower() in name.lower():
            s = name

    # If there is a trailing description like ' - Uplink to BKK' or ' (Uplink)'
    parts = re.split(r'\s+[\-\–]\s+|\s+to\s+', s, maxsplit=1, flags=re.IGNORECASE)
    if parts and parts[0].strip():
        s = parts[0].strip()

    return s.strip() or sensor_name.strip()


def extract_link_description(sensor_name: str, payload_description: str = '') -> str:
    """
    Extract link description / circuit info from PRTG sensor title.
    Examples:
      - '(HundredGigE0/1/0/0) TBB0000726 : MPLS 100GE...' -> 'TBB0000726 : MPLS 100GE...'
      - '(TenGigE0/0/0/27) TBB_______ : MPLS 10GE...' -> 'TBB_______ : MPLS 10GE...'
    """
    if payload_description and payload_description.strip():
        return payload_description.strip()

    if not sensor_name:
        return ''

    s = sensor_name.strip()
    # Strip trailing (SNMP Traffic) or (Traffic)
    s = re.sub(r'\s*\((?:SNMP\s+)?Traffic\)\s*$', '', s, flags=re.IGNORECASE)

    # Check for leading token in parentheses like (TenGigE0/0/0/31)
    m = re.match(r'^\(([A-Za-z0-9_\/\.\-]+)\)\s*(.*)$', s)
    if m:
        if_name = m.group(1).strip()
        rest = m.group(2).strip()
        # Clean trailing separators like '|' or '-'
        rest = re.sub(r'[\s\|\-]+$', '', rest).strip()
        if rest and rest.lower() != if_name.lower():
            return re.sub(r'\s+', ' ', rest).strip()
        return ''

    return ''


# PRTG status value mapping (case-insensitive prefixes/patterns)
def parse_prtg_status(raw_status: str) -> Optional[str]:
    """
    Parse PRTG status string into EventStatus.DOWN or EventStatus.UP.
    Real PRTG status examples:
      - "Down" -> DOWN
      - "Down (Partial)" -> DOWN
      - "Down (Acknowledged)" -> DOWN
      - "Warning" -> DOWN
      - "Up" -> UP
      - "Down ended (now: Up)" -> UP
      - "Warning ended (now: Up)" -> UP
      - "Down ended" -> UP
    """
    if not raw_status:
        return None
    s = raw_status.strip().lower()

    # Recovery patterns
    if 'now: up' in s or s == 'up' or 'ended' in s:
        return EventStatus.UP

    # Down / Warning patterns
    if 'down' in s or 'warning' in s:
        return EventStatus.DOWN

    return None


class PRTGAdapter(BaseSourceAdapter):
    """
    Adapter for PRTG Network Monitor HTTP Notification.
    Accepts both form-urlencoded and JSON payloads.
    """

    def get_source_name(self) -> str:
        return 'PRTG'

    def authenticate(self, token: Optional[str]) -> bool:
        expected = getattr(settings, 'PRTG_API_TOKEN', '')
        if not expected:
            return True  # No token configured = allow all
        return token == expected

    def validate_payload(self, raw_payload: dict) -> tuple[bool, str]:
        """Validate required fields exist in PRTG payload."""
        # Must have at least host/device and status
        host = raw_payload.get('host', '').strip()
        device = raw_payload.get('device', '').strip()
        status = raw_payload.get('status', '').strip()

        if not host and not device:
            return False, "Missing required field: 'host' or 'device'"

        if not status:
            return False, "Missing required field: 'status'"

        # Check status is a recognized value
        parsed_status = parse_prtg_status(status)
        if not parsed_status:
            return False, f"Unrecognized status value: '{status}'"

        return True, ''

    def normalize(self, raw_payload: dict, received_time: datetime, default_event_type: Optional[str] = None) -> NormalizedEventData:
        """
        Map PRTG fields → NormalizedEventData.
        Automatically detects whether event is LINK_STATUS or DEVICE_REACHABILITY.
        PRTG-specific IDs go into metadata, NOT into core fields.
        """
        # Parse status
        raw_status = raw_payload.get('status', '').strip()
        event_status = parse_prtg_status(raw_status) or EventStatus.DOWN

        # Parse event time from PRTG datetime format
        event_time = self._parse_prtg_datetime(raw_payload.get('datetime', ''))
        if event_time is None:
            event_time = received_time

        # Device identification
        device_name = raw_payload.get('device', '').strip()
        device_ip = (raw_payload.get('host') or raw_payload.get('ip') or '').strip()
        if not device_name:
            device_name = device_ip

        # Severity based on status
        severity = Severity.CRITICAL if event_status == EventStatus.DOWN else Severity.INFO

        # Auto-detect event_type: LINK_STATUS vs DEVICE_REACHABILITY
        explicit_category = (raw_payload.get('event_category') or '').upper()
        sensor_str = raw_payload.get('sensor', '').strip()
        tags_str = raw_payload.get('tags', '').strip()
        explicit_interface = raw_payload.get('interface', '').strip()

        is_link = False
        if default_event_type == EventType.LINK_STATUS or explicit_category == 'LINK':
            is_link = True
        elif explicit_interface:
            is_link = True
        elif 'snmptraffic' in tags_str.lower() or '(traffic)' in sensor_str.lower() or '(snmp traffic)' in sensor_str.lower():
            is_link = True
        elif re.match(r'^\(([A-Za-z0-9_\/\.\-]+)\)', sensor_str):
            is_link = True

        event_type = EventType.LINK_STATUS if is_link else EventType.DEVICE_REACHABILITY

        # Extract metadata
        metadata = {}
        for key in ('device_id', 'sensor_id', 'sensor', 'tags', 'lastvalue'):
            val = raw_payload.get(key, '')
            if val:
                metadata[f'prtg_{key}'] = str(val).strip()

        interface_name = ''
        link_description = ''
        if is_link:
            interface_name = extract_interface_name(sensor_str, explicit_interface)
            link_description = extract_link_description(sensor_str, raw_payload.get('description', ''))
            metadata['interface_name'] = interface_name
            if link_description:
                metadata['link_description'] = link_description
            if 'prtg_sensor_id' in metadata:
                metadata['sensor_id'] = metadata['prtg_sensor_id']

        # Build sanitized raw payload for audit (remove token)
        audit_payload = {k: v for k, v in raw_payload.items() if k != 'token'}

        # Generate source_event_id
        source_event_id = None
        device_id = raw_payload.get('device_id', '').strip()
        sensor_id = raw_payload.get('sensor_id', '').strip()
        if device_id and sensor_id:
            prefix = 'prtg-link' if is_link else 'prtg'
            source_event_id = f"{prefix}-{device_id}-{sensor_id}-{event_status}"
        elif sensor_id and is_link:
            source_event_id = f"prtg-link-{sensor_id}-{event_status}"

        # Human-readable message
        raw_msg = raw_payload.get('message', '').strip()
        if is_link:
            msg = f"[LINK {event_status}] {interface_name}: {raw_msg}" if raw_msg else f"[LINK {event_status}] {interface_name}"
        else:
            msg = raw_msg

        return NormalizedEventData(
            source=self.get_source_name(),
            source_event_id=source_event_id,
            event_type=event_type,
            event_status=event_status,
            severity=severity,
            device_name=device_name,
            device_ip=device_ip,
            event_time=event_time,
            received_time=received_time,
            message=msg,
            metadata=metadata,
            raw_payload=audit_payload,
        )

    def _parse_prtg_datetime(self, datetime_str: str) -> Optional[datetime]:
        """
        Parse PRTG datetime formats into timezone-aware datetime.
        PRTG sends various formats depending on locale settings:
          - "9/25/2026 9:45:08 PM"  (US format, from real PRTG)
          - "2026-09-25T20:01:10+07:00" (ISO format)
          - "25/09/2026 21:45:08" (EU format)
        """
        if not datetime_str or not datetime_str.strip():
            return None

        datetime_str = datetime_str.strip()
        tz = timezone.get_current_timezone()

        # Try ISO 8601 first
        try:
            dt = datetime.fromisoformat(datetime_str)
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, tz)
            return dt
        except (ValueError, TypeError):
            pass

        # US format: "M/D/YYYY h:mm:ss AM/PM" (as seen from real PRTG)
        us_formats = [
            '%m/%d/%Y %I:%M:%S %p',
            '%m/%d/%Y %I:%M %p',
            '%m/%d/%Y %H:%M:%S',
        ]
        for fmt in us_formats:
            try:
                dt = datetime.strptime(datetime_str, fmt)
                return timezone.make_aware(dt, tz)
            except (ValueError, TypeError):
                continue

        # EU format: "D/M/YYYY H:M:S"
        eu_formats = [
            '%d/%m/%Y %H:%M:%S',
            '%d/%m/%Y %H:%M',
        ]
        for fmt in eu_formats:
            try:
                dt = datetime.strptime(datetime_str, fmt)
                return timezone.make_aware(dt, tz)
            except (ValueError, TypeError):
                continue

        logger.warning(f"Could not parse PRTG datetime: '{datetime_str}'")
        return None


def generate_idempotency_key(normalized: NormalizedEventData) -> str:
    """
    Generate SHA-256 idempotency key from normalized event data.
    Source-agnostic — works for any source adapter.
    """
    components = [
        normalized.source,
        normalized.source_event_id or '',
        normalized.event_type,
        normalized.event_status,
        normalized.device_ip,
        normalized.event_time.isoformat() if normalized.event_time else '',
    ]
    raw = '|'.join(components)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()
