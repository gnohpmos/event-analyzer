from rest_framework import serializers
from incidents.models import Incident, IncidentEvent, EventTimeline
from devices.serializers import DeviceSerializer
from verification.serializers import VerificationSerializer
from events.serializers import NetworkEventSerializer


class EventTimelineSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventTimeline
        fields = [
            'id', 'incident', 'event_type', 'source',
            'description', 'data', 'timestamp', 'created_at'
        ]


class IncidentEventSerializer(serializers.ModelSerializer):
    event = NetworkEventSerializer(read_only=True)

    class Meta:
        model = IncidentEvent
        fields = ['id', 'relationship_type', 'event', 'created_at']


class IncidentListSerializer(serializers.ModelSerializer):
    device_name = serializers.CharField(source='primary_device.name', read_only=True)
    device_ip = serializers.CharField(source='primary_device.management_ip', read_only=True)
    device_type = serializers.CharField(source='primary_device.device_type', read_only=True)
    downtime_seconds = serializers.FloatField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    verifications_count = serializers.SerializerMethodField()
    events_count = serializers.SerializerMethodField()

    class Meta:
        model = Incident
        fields = [
            'id', 'incident_number', 'incident_type', 'primary_device',
            'device_name', 'device_ip', 'device_type',
            'interface_name', 'link_description', 'prtg_sensor_id',
            'ticket_id_tss', 'circuit_id', 'remote_device', 'site_name',
            'tts_status', 'repair_team',
            'status', 'classification', 'confidence',
            'flap_count', 'soak_until', 'net_downtime_seconds',
            'down_time', 'up_time', 'last_down_time', 'last_up_time', 'last_seen',
            'downtime_seconds', 'is_active',
            'verifications_count', 'events_count',
            'created_at', 'updated_at'
        ]

    def get_verifications_count(self, obj):
        return obj.verifications.count()

    def get_events_count(self, obj):
        return obj.incident_events.count()


class IncidentDetailSerializer(serializers.ModelSerializer):
    primary_device = DeviceSerializer(read_only=True)
    device_name = serializers.CharField(source='primary_device.name', read_only=True)
    device_ip = serializers.CharField(source='primary_device.management_ip', read_only=True)
    device_type = serializers.CharField(source='primary_device.device_type', read_only=True)
    timeline = EventTimelineSerializer(many=True, read_only=True)
    verifications = VerificationSerializer(many=True, read_only=True)
    incident_events = IncidentEventSerializer(many=True, read_only=True)
    downtime_seconds = serializers.FloatField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = Incident
        fields = [
            'id', 'incident_number', 'incident_type', 'primary_device',
            'device_name', 'device_ip', 'device_type',
            'interface_name', 'link_description', 'prtg_sensor_id',
            'ticket_id_tss', 'circuit_id', 'remote_device', 'remote_interface', 'site_name',
            'tts_status', 'repair_team', 'response_department', 'actual_cause', 'resolution',
            'source_gps', 'dest_gps',
            'status', 'classification', 'confidence',
            'flap_count', 'soak_until', 'net_downtime_seconds',
            'down_time', 'up_time', 'last_down_time', 'last_up_time', 'last_seen',
            'downtime_seconds', 'is_active',
            'timeline', 'verifications', 'incident_events',
            'created_at', 'updated_at'
        ]
