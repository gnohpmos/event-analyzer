from rest_framework import serializers
from .models import SystemSetting


class SystemSettingSerializer(serializers.ModelSerializer):
    display_value = serializers.SerializerMethodField()

    class Meta:
        model = SystemSetting
        fields = ['id', 'key', 'value', 'display_value', 'category', 'description', 'is_secret', 'updated_at']
        read_only_fields = ['id', 'updated_at']

    def get_display_value(self, obj):
        if obj.is_secret and obj.value:
            return "••••••••"
        return obj.value


class SNMPTestRequestSerializer(serializers.Serializer):
    host = serializers.CharField(required=True, max_length=255)
    community = serializers.CharField(required=False, allow_blank=True, max_length=255)
    timeout = serializers.IntegerField(required=False, default=5, min_value=1, max_value=30)
