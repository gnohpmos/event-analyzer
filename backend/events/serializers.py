from rest_framework import serializers
from events.models import NetworkEvent, EventSource


class EventSourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventSource
        fields = ['id', 'name', 'source_type', 'enabled', 'description', 'created_at']


class NetworkEventSerializer(serializers.ModelSerializer):
    source_name = serializers.CharField(source='source.name', read_only=True)
    device_name = serializers.CharField(source='device.name', read_only=True)
    device_ip = serializers.CharField(source='device.management_ip', read_only=True)

    class Meta:
        model = NetworkEvent
        fields = [
            'id', 'source', 'source_name', 'source_event_id',
            'device', 'device_name', 'device_ip',
            'event_type', 'event_status', 'severity',
            'event_time', 'received_time', 'message',
            'metadata', 'idempotency_key', 'created_at'
        ]
