from django.contrib import admin
from .models import SystemSetting

admin.site.site_header = "Network Event & Incident Analyzer - Administration"
admin.site.site_title = "Event Analyzer Admin Portal"
admin.site.index_title = "System Management & Operational Control"


@admin.register(SystemSetting)
class SystemSettingAdmin(admin.ModelAdmin):
    list_display = ('key', 'category', 'display_value', 'is_secret', 'description', 'updated_at')
    list_filter = ('category', 'is_secret')
    search_fields = ('key', 'description', 'value')
    list_editable = ()
    readonly_fields = ('updated_at',)

    fieldsets = (
        ('Configuration Info', {
            'fields': ('key', 'category', 'description')
        }),
        ('Value & Security', {
            'fields': ('value', 'is_secret')
        }),
        ('Metadata', {
            'fields': ('updated_at',),
            'classes': ('collapse',)
        }),
    )

    def display_value(self, obj):
        if obj.is_secret and obj.value:
            return "•••••••• (" + obj.value[-3:] + ")" if len(obj.value) > 3 else "••••••••"
        return obj.value
    display_value.short_description = "Value"
