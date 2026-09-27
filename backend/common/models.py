from django.db import models


class SystemSetting(models.Model):
    """
    Dynamic system configuration stored in database.
    Allows runtime reconfiguration of SNMP community strings, timeouts, retries,
    reboot thresholds, etc. without restarting containers or modifying .env files.
    """
    CATEGORY_CHOICES = [
        ('SNMP', 'SNMP Verification Settings'),
        ('SSH', 'SSH Automation Settings'),
        ('THRESHOLD', 'Business Logic Thresholds'),
        ('INTEGRATION', 'Integration Settings'),
        ('GENERAL', 'General System Settings'),
    ]

    key = models.CharField(
        max_length=100, 
        unique=True, 
        db_index=True,
        help_text="Unique configuration key, e.g. SNMP_COMMUNITY"
    )
    value = models.TextField(help_text="Configuration value")
    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, default='GENERAL')
    description = models.TextField(blank=True, help_text="Human-readable description of what this setting controls")
    is_secret = models.BooleanField(default=False, help_text="If True, masks value in UI")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'system_settings'
        verbose_name = 'System Setting'
        verbose_name_plural = 'System Settings'
        ordering = ['category', 'key']

    def __str__(self):
        val_display = '********' if self.is_secret else self.value
        return f"[{self.category}] {self.key} = {val_display}"
