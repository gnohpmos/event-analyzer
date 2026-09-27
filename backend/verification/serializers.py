from rest_framework import serializers
from verification.models import Verification


class VerificationSerializer(serializers.ModelSerializer):
    device_name = serializers.CharField(source='device.name', read_only=True)
    device_ip = serializers.CharField(source='device.management_ip', read_only=True)

    class Meta:
        model = Verification
        fields = [
            'id', 'incident', 'device', 'device_name', 'device_ip',
            'verification_type', 'status', 'check_time',
            'result', 'evidence', 'error_message', 'attempt_number',
            'created_at'
        ]
