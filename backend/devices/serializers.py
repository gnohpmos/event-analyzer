from rest_framework import serializers
from devices.models import Device, SourceDeviceMapping


class SourceDeviceMappingSerializer(serializers.ModelSerializer):
    source_name = serializers.CharField(source='source.name', read_only=True)

    class Meta:
        model = SourceDeviceMapping
        fields = ['id', 'source', 'source_name', 'source_device_id', 'metadata', 'created_at']


class DeviceSerializer(serializers.ModelSerializer):
    source_mappings = SourceDeviceMappingSerializer(many=True, read_only=True)
    active_incidents_count = serializers.SerializerMethodField()
    total_incidents_count = serializers.SerializerMethodField()

    class Meta:
        model = Device
        fields = [
            'id', 'name', 'management_ip', 'device_type', 'enabled',
            'metadata',
            'sys_name', 'province_code', 'province',
            'hardware_model', 'serial_number',
            'os_family', 'os_version', 'rca_strategy',
            'last_snmp_synced_at',
            'active_incidents_count', 'total_incidents_count',
            'source_mappings', 'created_at', 'updated_at'
        ]

    def get_active_incidents_count(self, obj):
        from common.constants import IncidentStatus
        return obj.incidents.filter(status__in=IncidentStatus.ACTIVE_STATUSES).count()

    def get_total_incidents_count(self, obj):
        return obj.incidents.count()
