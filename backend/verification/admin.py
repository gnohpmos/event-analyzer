from django.contrib import admin
from django.utils.html import format_html
from .models import Verification


@admin.register(Verification)
class VerificationAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'incident', 'device', 'verification_type',
        'status_badge', 'attempt_number', 'check_time', 'created_at'
    )
    list_filter = ('status', 'verification_type', 'check_time')
    search_fields = (
        'incident__incident_number', 'device__name',
        'device__management_ip', 'error_message'
    )
    readonly_fields = ('created_at',)

    fieldsets = (
        ('Verification Target', {
            'fields': ('incident', 'device', 'verification_type', 'attempt_number')
        }),
        ('Status & Timing', {
            'fields': ('status', 'check_time', 'created_at')
        }),
        ('Results & Evidence', {
            'fields': ('evidence', 'result', 'error_message')
        }),
    )

    def status_badge(self, obj):
        colors = {
            'SUCCESS': '#10b981',
            'FAILED': '#ef4444',
            'TIMEOUT': '#f97316',
            'PENDING': '#f59e0b',
        }
        color = colors.get(obj.status, '#64748b')
        return format_html(
            '<span style="background-color: {}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px;">{}</span>',
            color, obj.status
        )
    status_badge.short_description = 'Status'
