from django.contrib import admin
from django.utils.html import format_html
from .models import EventSource, NetworkEvent


@admin.register(EventSource)
class EventSourceAdmin(admin.ModelAdmin):
    list_display = ('name', 'source_type', 'enabled', 'description', 'created_at')
    list_filter = ('source_type', 'enabled')
    search_fields = ('name', 'description')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(NetworkEvent)
class NetworkEventAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'source', 'device', 'event_type', 'status_badge',
        'severity', 'event_time', 'idempotency_key_short'
    )
    list_filter = ('event_status', 'severity', 'source', 'event_type', 'event_time')
    search_fields = (
        'device__name', 'device__management_ip', 'source_event_id',
        'idempotency_key', 'message'
    )
    readonly_fields = ('idempotency_key', 'received_time', 'created_at')

    fieldsets = (
        ('Event Identification', {
            'fields': ('source', 'source_event_id', 'device', 'idempotency_key')
        }),
        ('Classification & Status', {
            'fields': ('event_type', 'event_status', 'severity', 'message')
        }),
        ('Timestamps', {
            'fields': ('event_time', 'received_time', 'created_at')
        }),
        ('Payload & Metadata', {
            'fields': ('metadata', 'raw_payload'),
            'classes': ('collapse',)
        }),
    )

    def status_badge(self, obj):
        colors = {
            'DOWN': '#ef4444',
            'UP': '#10b981',
            'WARNING': '#f59e0b',
        }
        color = colors.get(obj.event_status, '#64748b')
        return format_html(
            '<span style="background-color: {}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px;">{}</span>',
            color, obj.event_status
        )
    status_badge.short_description = 'Event Status'

    def idempotency_key_short(self, obj):
        return obj.idempotency_key[:12] + '...' if obj.idempotency_key else '-'
    idempotency_key_short.short_description = 'Idempotency Key'
