"""
PRTG HTTP Notification webhook endpoint.
Receives events from PRTG, normalizes, stores, and dispatches to Core Engine.
"""
import json
import logging
from urllib.parse import parse_qs

from django.conf import settings
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

import re
from common.constants import SourceType, EventType, EventStatus, Severity
from integrations.base.adapter import NormalizedEventData
from integrations.prtg.adapter import PRTGAdapter, parse_prtg_status
from events.services import get_or_create_event_source, store_event
from devices.services import get_or_create_device
from events.engine import dispatch_event

logger = logging.getLogger(__name__)

# Singleton adapter instance
prtg_adapter = PRTGAdapter()


def _parse_request_payload(request) -> dict:
    """Parse incoming payload from various content types."""
    raw_body = request.body.decode('utf-8', errors='replace')
    content_type = request.content_type or ''

    if 'application/json' in content_type:
        try:
            return json.loads(raw_body)
        except json.JSONDecodeError:
            return {"raw": raw_body}

    # Form-urlencoded or raw text
    if request.POST:
        return request.POST.dict()

    # Try JSON without header
    try:
        return json.loads(raw_body)
    except Exception:
        pass

    # Parse as query string
    parsed = parse_qs(raw_body)
    if parsed:
        return {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}

    return {"raw": raw_body}


def _extract_token(request, payload: dict) -> str:
    """Extract authentication token from header, query string, or payload."""
    auth_header = request.headers.get('Authorization', '')
    bearer_token = auth_header[7:].strip() if auth_header.startswith('Bearer ') else ''

    return (
        request.headers.get('X-PRTG-Token') or
        bearer_token or
        request.GET.get('token') or
        payload.get('token', '')
    )


@csrf_exempt
@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def prtg_event_webhook(request):
    """
    PRTG Event Ingestion Endpoint.

    Flow:
    1. Parse payload (JSON or form-data)
    2. Authenticate (X-PRTG-Token)
    3. Validate payload
    4. Normalize → NormalizedEventData
    5. Get/Create Device
    6. Store Event (with idempotency)
    7. Dispatch to Core Event Engine
    8. Return response to PRTG immediately
    """
    # GET = endpoint status check
    if request.method == 'GET':
        return Response({
            "status": "ready",
            "message": "PRTG webhook endpoint is active",
            "source": "PRTG",
        })

    received_time = timezone.now()
    client_ip = request.META.get('HTTP_X_FORWARDED_FOR',
                                  request.META.get('REMOTE_ADDR', 'unknown'))

    # 1. Parse payload
    payload = _parse_request_payload(request)

    # Log received event
    logger.info(f"SOURCE_EVENT_RECEIVED: source=PRTG ip={client_ip}")
    print(f"\n{'='*60}", flush=True)
    print(f"🔔 [PRTG WEBHOOK RECEIVED]", flush=True)
    print(f"Timestamp:    {received_time.isoformat()}", flush=True)
    print(f"Client IP:    {client_ip}", flush=True)
    print(f"Content-Type: {request.content_type}", flush=True)
    print(f"Payload:", flush=True)
    # Don't log token
    safe_payload = {k: v for k, v in payload.items() if k != 'token'}
    print(json.dumps(safe_payload, indent=2, ensure_ascii=False), flush=True)

    # 2. Authenticate
    token = _extract_token(request, payload)
    if not prtg_adapter.authenticate(token):
        logger.warning(f"SOURCE_EVENT_REJECTED: source=PRTG reason=invalid_token ip={client_ip}")
        print(f"❌ AUTH FAILED", flush=True)
        print(f"{'='*60}\n", flush=True)
        return Response(
            {"status": "error", "message": "Invalid or missing integration token"},
            status=status.HTTP_401_UNAUTHORIZED
        )

    # Check if PRTG is enabled
    if not getattr(settings, 'PRTG_ENABLED', True):
        return Response(
            {"status": "error", "message": "PRTG integration is disabled"},
            status=status.HTTP_403_FORBIDDEN
        )

    # 3. Validate
    is_valid, error_msg = prtg_adapter.validate_payload(payload)
    if not is_valid:
        logger.warning(f"SOURCE_EVENT_REJECTED: source=PRTG reason={error_msg}")
        print(f"❌ VALIDATION FAILED: {error_msg}", flush=True)
        print(f"{'='*60}\n", flush=True)
        return Response(
            {"status": "error", "message": f"Invalid payload: {error_msg}"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # 4. Normalize
    normalized = prtg_adapter.normalize(payload, received_time)
    logger.info(f"EVENT_NORMALIZED: source=PRTG type={normalized.event_type}/{normalized.event_status} "
                f"device={normalized.device_name}")

    # 5. Get/Create EventSource & Device
    source = get_or_create_event_source('PRTG', SourceType.PRTG)
    device = get_or_create_device(normalized, source)

    # 6. Store Event (idempotency check)
    event, is_new = store_event(normalized, source, device)
    if not is_new:
        print(f"⚠️  DUPLICATE EVENT (idempotency key match)", flush=True)
        print(f"{'='*60}\n", flush=True)
        return Response({
            "status": "success",
            "message": "Duplicate event — already processed",
            "event_id": event.id,
        })

    # 7. Dispatch to Core Engine
    result = dispatch_event(event, device)

    print(f"✅ PROCESSED: {result.get('action', 'UNKNOWN')}", flush=True)
    if 'incident_number' in result:
        print(f"   Incident: {result['incident_number']}", flush=True)
    print(f"{'='*60}\n", flush=True)

    # 8. Return response
    return Response({
        "status": "success",
        "message": "Event received and processed",
        "source": "PRTG",
        "event_id": event.id,
        "result": result,
        "received_at": received_time.isoformat(),
    })


# Re-export for backward compatibility
from integrations.prtg.adapter import extract_interface_name


@csrf_exempt
@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def prtg_link_event_webhook(request):
    """
    Dedicated PRTG Link/Interface Event Webhook Endpoint.
    Receives Interface/Link UP & DOWN events from PRTG SNMP Traffic / Interface sensors.

    Endpoints:
      POST /api/v1/integrations/prtg/link-events/
      POST /api/v1/integrations/prtg/links/
    """
    if request.method == 'GET':
        return Response({
            "status": "ready",
            "message": "PRTG Link/Interface webhook endpoint is active and ready for testing",
            "source": "PRTG",
            "event_type": "LINK_STATUS",
            "endpoints": [
                "/api/v1/integrations/prtg/link-events/",
                "/api/v1/integrations/prtg/links/"
            ],
            "required_fields": ["status", "device (or host)", "sensor (or interface)"],
            "optional_fields": ["sensor_id", "device_id", "message", "datetime", "lastvalue", "tags"],
            "example_prtg_payload": {
                "device": "%device",
                "host": "%host",
                "device_id": "%deviceid",
                "sensor": "%sensor",
                "sensor_id": "%sensorid",
                "status": "%status",
                "message": "%message",
                "datetime": "%datetime",
                "lastvalue": "%lastvalue",
                "tags": "%tags",
                "token": getattr(settings, 'PRTG_API_TOKEN', 'prtg-secure-webhook-token-2026')
            }
        })

    received_time = timezone.now()
    client_ip = request.META.get('HTTP_X_FORWARDED_FOR',
                                  request.META.get('REMOTE_ADDR', 'unknown'))

    # 1. Parse payload
    payload = _parse_request_payload(request)

    # 2. Authenticate
    token = _extract_token(request, payload)
    if not prtg_adapter.authenticate(token):
        logger.warning(f"LINK_EVENT_REJECTED: reason=invalid_token ip={client_ip}")
        print(f"❌ [PRTG LINK WEBHOOK] AUTH FAILED (invalid token from {client_ip})", flush=True)
        return Response(
            {"status": "error", "message": "Invalid or missing integration token"},
            status=status.HTTP_401_UNAUTHORIZED
        )

    # Check if PRTG is enabled
    if not getattr(settings, 'PRTG_ENABLED', True):
        return Response(
            {"status": "error", "message": "PRTG integration is disabled"},
            status=status.HTTP_403_FORBIDDEN
        )

    # 3. Validate
    host = payload.get('host', '').strip()
    device_name_raw = payload.get('device', '').strip()
    raw_status = payload.get('status', '').strip()
    sensor_name = payload.get('sensor', '').strip()
    explicit_interface = payload.get('interface', '').strip()

    if not host and not device_name_raw:
        return Response(
            {"status": "error", "message": "Missing required field: 'host' or 'device'"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if not raw_status:
        return Response(
            {"status": "error", "message": "Missing required field: 'status'"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if not sensor_name and not explicit_interface:
        return Response(
            {"status": "error", "message": "Missing required field: 'sensor' or 'interface' to identify link/port"},
            status=status.HTTP_400_BAD_REQUEST
        )

    event_status = parse_prtg_status(raw_status)
    if not event_status:
        return Response(
            {"status": "error", "message": f"Unrecognized status value: '{raw_status}'"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # 4. Normalize using PRTGAdapter
    normalized = prtg_adapter.normalize(payload, received_time, default_event_type=EventType.LINK_STATUS)
    interface_name = normalized.metadata.get('interface_name', '')
    severity = normalized.severity
    sensor_id = payload.get('sensor_id', '').strip()
    last_value = payload.get('lastvalue', '').strip()
    msg = payload.get('message', '').strip()

    # Console logging for real-time verification
    print(f"\n{'='*60}", flush=True)
    print(f"🔗 [PRTG LINK WEBHOOK RECEIVED]", flush=True)
    print(f"Timestamp:    {received_time.isoformat()}", flush=True)
    print(f"Client IP:    {client_ip}", flush=True)
    print(f"Device:       {normalized.device_name} ({normalized.device_ip})", flush=True)
    print(f"Interface:    {interface_name} (Raw Sensor: '{sensor_name}')", flush=True)
    print(f"Link Status:  {event_status} (Raw PRTG Status: '{raw_status}')", flush=True)
    print(f"Severity:     {severity}", flush=True)
    if msg:
        print(f"Message:      {msg}", flush=True)
    if last_value:
        print(f"Last Value:   {last_value}", flush=True)
    print(f"{'='*60}\n", flush=True)

    # 5. Store event into Database (Events Audit)
    source = get_or_create_event_source('PRTG', SourceType.PRTG)
    device = get_or_create_device(normalized, source)
    event, is_new = store_event(normalized, source, device)

    # 6. Dispatch to Core Engine
    dispatch_result = dispatch_event(event, device)

    return Response({
        "status": "success",
        "message": "PRTG Link event received and processed successfully",
        "event_id": event.id,
        "is_new": is_new,
        "event_type": EventType.LINK_STATUS,
        "dispatch_result": dispatch_result,
        "link_details": {
            "device_name": device.name,
            "device_ip": device.management_ip,
            "interface_name": interface_name,
            "link_description": normalized.metadata.get('link_description', ''),
            "sensor_name": sensor_name,
            "sensor_id": sensor_id,
            "event_status": event_status,
            "severity": severity,
            "event_time": normalized.event_time.isoformat(),
            "last_value": last_value,
            "message": msg,
        },
        "received_at": received_time.isoformat(),
    })
