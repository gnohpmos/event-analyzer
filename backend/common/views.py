import logging
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny

from .models import SystemSetting
from .serializers import SystemSettingSerializer, SNMPTestRequestSerializer
from .settings_helper import get_setting, set_setting
from verification.snmp.snmp_v2 import SNMPv2Client
from incidents.models import Incident, IncidentEvent, EventTimeline
from events.models import NetworkEvent
from devices.models import Device

logger = logging.getLogger(__name__)


class SystemSettingsViewSet(viewsets.ModelViewSet):
    """
    CRUD API for dynamic system settings and developer management tools.
    Allows frontend to view, update configurations, test SNMP, and manage DEV data.
    """
    queryset = SystemSetting.objects.all().order_by('category', 'key')
    serializer_class = SystemSettingSerializer
    lookup_field = 'key'
    authentication_classes = []
    permission_classes = [AllowAny]

    @action(detail=False, methods=['post'], url_path='batch')
    def batch_update(self, request):
        """
        Batch update settings.
        Payload format:
        {
            "settings": {
                "SNMP_COMMUNITY": "my-new-community",
                "DEFAULT_SNMP_TIMEOUT": "7",
                "ROUTER_REBOOT_THRESHOLD_SECONDS": "1800"
            }
        }
        """
        updates = request.data.get('settings', {})
        if not isinstance(updates, dict):
            return Response(
                {"error": "Expected 'settings' to be a key-value object"},
                status=status.HTTP_400_BAD_REQUEST
            )

        updated_keys = []
        for key, value in updates.items():
            setting = SystemSetting.objects.filter(key=key).first()
            if setting:
                setting.value = str(value).strip()
                setting.save(update_fields=['value', 'updated_at'])
                updated_keys.append(key)
            else:
                set_setting(key=key, value=str(value).strip())
                updated_keys.append(key)

        return Response({
            "message": f"Successfully updated {len(updated_keys)} settings",
            "updated_keys": updated_keys
        }, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='test-snmp')
    def test_snmp(self, request):
        """
        Live test of SNMP sysUpTime query to a target IP.
        Useful for administrators verifying credentials.
        """
        serializer = SNMPTestRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        host = serializer.validated_data['host'].strip()
        custom_community = serializer.validated_data.get('community', '').strip() or None
        timeout = serializer.validated_data.get('timeout', 5)

        client = SNMPv2Client()
        result = client.get_sysuptime(
            host=host,
            community=custom_community,
            timeout=timeout,
            retries=1
        )

        return Response({
            "host": host,
            "community_used": "••••••••" if custom_community else "DEFAULT (" + get_setting('SNMP_COMMUNITY', 'public')[:2] + "•••)",
            "success": result.success,
            "router_uptime_seconds": result.router_uptime_seconds,
            "raw_sysuptime": result.raw_sysuptime,
            "why_reload": result.why_reload,
            "error_message": result.error_message,
            "snmp_version": result.snmp_version
        }, status=status.HTTP_200_OK if result.success else status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='test-ssh')
    def test_ssh(self, request):
        """
        Live test of SSH reboot-history query to a target IP (Cisco IOS-XR).
        """
        host = request.data.get('host', '').strip()
        username = request.data.get('username', '').strip() or None
        password = request.data.get('password', '').strip() or None
        port = int(request.data.get('port', 22))
        timeout = int(request.data.get('timeout', 5))

        if not host:
            return Response({"error": "Host IP is required"}, status=status.HTTP_400_BAD_REQUEST)

        from verification.ssh.xr_ssh import get_xr_reboot_history
        result = get_xr_reboot_history(
            host=host,
            username=username,
            password=password,
            port=port,
            timeout=timeout
        )
        return Response(result, status=status.HTTP_200_OK)

    # =========================================================================
    # DEV DATA MANAGEMENT ACTIONS (Clear Logs, Incidents, Seed & Import Devices)
    # =========================================================================

    @action(detail=False, methods=['post'], url_path='clear-events')
    def clear_events(self, request):
        """
        DEV utility: Clears all NetworkEvents and linked IncidentEvent objects.
        """
        try:
            with transaction.atomic():
                deleted_links, _ = IncidentEvent.objects.all().delete()
                deleted_events, _ = NetworkEvent.objects.all().delete()
                deleted_timelines, _ = EventTimeline.objects.filter(incident__isnull=True).delete()
            return Response({
                "status": "success",
                "message": f"Successfully cleared {deleted_events} network events and {deleted_links} incident links.",
                "deleted_events": deleted_events,
                "deleted_links": deleted_links
            }, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception("Failed to clear events")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'], url_path='clear-incidents')
    def clear_incidents(self, request):
        """
        DEV utility: Clears all Incidents, Verifications, and associated Timelines.
        """
        try:
            with transaction.atomic():
                deleted_incidents, _ = Incident.objects.all().delete()
            return Response({
                "status": "success",
                "message": f"Successfully cleared {deleted_incidents} incidents and associated verifications.",
                "deleted_incidents": deleted_incidents
            }, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception("Failed to clear incidents")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'], url_path='clear-telemetry')
    def clear_telemetry(self, request):
        """
        DEV utility: Clears all Incidents, Verification Records, Timelines, and NetworkEvents.
        Preserves registered Devices Inventory and System Settings.
        """
        try:
            with transaction.atomic():
                deleted_incidents, _ = Incident.objects.all().delete()
                deleted_links, _ = IncidentEvent.objects.all().delete()
                deleted_events, _ = NetworkEvent.objects.all().delete()
                deleted_timelines, _ = EventTimeline.objects.all().delete()
            return Response({
                "status": "success",
                "message": f"Reset complete: cleared {deleted_incidents} incidents and {deleted_events} network events.",
                "deleted_incidents": deleted_incidents,
                "deleted_events": deleted_events
            }, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception("Failed to reset telemetry")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'], url_path='import-devices')
    def import_devices(self, request):
        """
        DEV utility: Batch imports devices from a JSON array.
        Payload format:
        {
            "devices": [
                {
                    "name": "Router-Main",
                    "management_ip": "10.0.10.1",
                    "device_type": "Router",
                    "enabled": true,
                    "snmp_community": "public"
                }
            ]
        }
        """
        device_list = request.data.get('devices')
        if not isinstance(device_list, list):
            return Response(
                {"error": "Expected 'devices' to be an array of device objects"},
                status=status.HTTP_400_BAD_REQUEST
            )

        created_count = 0
        updated_count = 0
        errors = []

        with transaction.atomic():
            for idx, item in enumerate(device_list):
                if not isinstance(item, dict):
                    continue
                name = str(item.get('name', '')).strip()
                ip = str(item.get('management_ip', '')).strip()
                dtype = str(item.get('device_type', 'Router')).strip()
                enabled = bool(item.get('enabled', True))
                snmp_comm = str(item.get('snmp_community', '')).strip()

                if not ip:
                    errors.append(f"Item #{idx + 1}: Missing management_ip")
                    continue
                if not name:
                    name = ip

                metadata = item.get('metadata') if isinstance(item.get('metadata'), dict) else {}
                if snmp_comm:
                    metadata['snmp_community'] = snmp_comm

                dev, created = Device.objects.update_or_create(
                    management_ip=ip,
                    defaults={
                        'name': name,
                        'device_type': dtype,
                        'enabled': enabled,
                        'metadata': metadata
                    }
                )
                if created:
                    created_count += 1
                else:
                    updated_count += 1

        return Response({
            "status": "success",
            "message": f"Successfully processed devices: {created_count} created, {updated_count} updated.",
            "created": created_count,
            "updated": updated_count,
            "errors": errors
        }, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='seed-sample-devices')
    def seed_sample_devices(self, request):
        """
        DEV utility: Quick seeds a standard lab network device inventory.
        """
        sample_devices = [
            {"name": "Core-Router-01", "management_ip": "10.0.10.1", "device_type": "Router", "metadata": {"snmp_community": "public"}},
            {"name": "Edge-Gateway-02", "management_ip": "10.0.10.9", "device_type": "Router", "metadata": {"snmp_community": "public"}},
            {"name": "Dist-Switch-BldgA", "management_ip": "10.0.20.1", "device_type": "Distribution Switch", "metadata": {}},
            {"name": "Access-SW-Floor2", "management_ip": "10.0.30.15", "device_type": "Access Switch", "metadata": {}},
            {"name": "Corp-Firewall-HA", "management_ip": "10.0.0.1", "device_type": "Firewall", "metadata": {}},
            {"name": "NMS-Server-01", "management_ip": "10.0.50.10", "device_type": "Server", "metadata": {}},
        ]

        created_count = 0
        updated_count = 0
        with transaction.atomic():
            for item in sample_devices:
                _, created = Device.objects.update_or_create(
                    management_ip=item["management_ip"],
                    defaults={
                        "name": item["name"],
                        "device_type": item["device_type"],
                        "enabled": True,
                        "metadata": item["metadata"]
                    }
                )
                if created:
                    created_count += 1
                else:
                    updated_count += 1

        return Response({
            "status": "success",
            "message": f"Sample lab devices seeded: {created_count} added, {updated_count} updated.",
            "total_sample_devices": len(sample_devices)
        }, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='export-devices')
    def export_devices(self, request):
        """
        DEV utility: Exports all devices as a JSON list.
        """
        devices = Device.objects.all().order_by('name')
        data = [
            {
                "name": d.name,
                "management_ip": d.management_ip,
                "device_type": d.device_type,
                "enabled": d.enabled,
                "snmp_community": d.metadata.get('snmp_community', '') if d.metadata else '',
                "metadata": d.metadata
            }
            for d in devices
        ]
        return Response({
            "count": len(data),
            "devices": data
        }, status=status.HTTP_200_OK)
