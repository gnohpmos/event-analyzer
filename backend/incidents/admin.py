from django.contrib import admin
from django.utils.html import format_html
from .models import Incident, IncidentEvent, EventTimeline
from verification.models import Verification


class IncidentEventInline(admin.TabularInline):
    model = IncidentEvent
    extra = 0
    readonly_fields = ('created_at',)
    fields = ('event', 'relationship_type', 'created_at')
    can_delete = True


class EventTimelineInline(admin.TabularInline):
    model = EventTimeline
    extra = 1
    readonly_fields = ('created_at',)
    fields = ('timestamp', 'event_type', 'source', 'description', 'data', 'created_at')
    can_delete = True


class VerificationInline(admin.TabularInline):
    model = Verification
    extra = 0
    readonly_fields = ('created_at', 'check_time', 'status', 'verification_type', 'attempt_number', 'result', 'evidence', 'error_message')
    fields = ('attempt_number', 'verification_type', 'status', 'check_time', 'evidence', 'error_message')
    can_delete = True


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = (
        'incident_number', 'primary_device', 'status_badge',
        'classification_display', 'confidence', 'down_time', 'up_time', 'created_at'
    )
    list_filter = ('status', 'classification', 'confidence', 'created_at')
    search_fields = (
        'incident_number', 'primary_device__name', 'primary_device__management_ip'
    )
    readonly_fields = ('created_at', 'updated_at')
    inlines = [EventTimelineInline, IncidentEventInline, VerificationInline]
    actions = ['mark_as_recovered', 'mark_as_manual_review']

    fieldsets = (
        ('Incident Identification', {
            'fields': ('incident_number', 'primary_device', 'status')
        }),
        ('Classification & RCA', {
            'fields': ('classification', 'confidence')
        }),
        ('Timing Information', {
            'fields': ('down_time', 'up_time', 'last_seen', 'created_at', 'updated_at')
        }),
    )

    def status_badge(self, obj):
        colors = {
            'DOWN': '#ef4444',
            'RECOVERY_CHECK': '#f59e0b',
            'RECOVERED': '#10b981',
            'MANUAL_REVIEW_REQUIRED': '#f97316',
            'RESOLVED': '#3b82f6',
            'CLOSED': '#64748b',
        }
        color = colors.get(obj.status, '#64748b')
        return format_html(
            '<span style="background-color: {}; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">{}</span>',
            color, obj.status
        )
    status_badge.short_description = 'Status'

    def classification_display(self, obj):
        if not obj.classification:
            return '-'
        return obj.classification
    classification_display.short_description = 'Classification'

    @admin.action(description="Mark selected incidents as RECOVERED")
    def mark_as_recovered(self, request, queryset):
        count = queryset.update(status='RECOVERED')
        self.message_user(request, f"{count} incident(s) marked as RECOVERED.")

    @admin.action(description="Mark selected incidents as MANUAL_REVIEW_REQUIRED")
    def mark_as_manual_review(self, request, queryset):
        count = queryset.update(status='MANUAL_REVIEW_REQUIRED')
        self.message_user(request, f"{count} incident(s) marked as MANUAL_REVIEW_REQUIRED.")


@admin.register(EventTimeline)
class EventTimelineAdmin(admin.ModelAdmin):
    list_display = ('incident', 'timestamp', 'event_type', 'source', 'description')
    list_filter = ('event_type', 'source', 'timestamp')
    search_fields = ('incident__incident_number', 'description', 'source')
    readonly_fields = ('created_at',)
