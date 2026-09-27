from django.contrib import admin
from django.utils.html import format_html
from .models import Device, SourceDeviceMapping


class SourceDeviceMappingInline(admin.TabularInline):
    model = SourceDeviceMapping
    extra = 0
    fields = ('source', 'source_device_id', 'metadata', 'created_at')
    readonly_fields = ('created_at',)
    can_delete = True


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ('name', 'management_ip', 'device_type', 'enabled', 'has_snmp_override', 'created_at')
    list_filter = ('enabled', 'device_type', 'created_at')
    search_fields = ('name', 'management_ip', 'device_type')
    readonly_fields = ('created_at', 'updated_at')
    inlines = [SourceDeviceMappingInline]

    fieldsets = (
        ('Device Details', {
            'fields': ('name', 'management_ip', 'device_type', 'enabled')
        }),
        ('Metadata & Custom Credentials', {
            'fields': ('metadata',),
            'description': 'Store JSON metadata here. To override SNMP community for this specific device, set: {"snmp_community": "your-community"}'
        }),
        ('Audit Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )

    def has_snmp_override(self, obj):
        if obj.metadata and isinstance(obj.metadata, dict) and obj.metadata.get('snmp_community'):
            return format_html('<span style="color: #10b981; font-weight: bold;">Override: {}</span>', obj.metadata['snmp_community'])
        return format_html('<span style="color: #94a3b8;">Default (.env / DB)</span>')
    has_snmp_override.short_description = 'SNMP Community'


@admin.register(SourceDeviceMapping)
class SourceDeviceMappingAdmin(admin.ModelAdmin):
    list_display = ('source', 'source_device_id', 'device', 'created_at')
    list_filter = ('source',)
    search_fields = ('source_device_id', 'device__name', 'device__management_ip')
    readonly_fields = ('created_at',)
