from django.db import models
from common.constants import SourceType


class EventSource(models.Model):
    """
    Represents an external event source (e.g., PRTG, NMS, Syslog).
    Each source has its own adapter and configuration.
    """
    name = models.CharField(max_length=100, unique=True)
    source_type = models.CharField(max_length=50, choices=SourceType.CHOICES)
    enabled = models.BooleanField(default=True)
    config = models.JSONField(default=dict, blank=True, help_text='Source-specific configuration')
    description = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.source_type})"


class NetworkEvent(models.Model):
    """
    Normalized event from any source. Core Engine processes only this model.
    Raw source-specific data is stored in metadata and raw_payload fields.
    """
    source = models.ForeignKey(
        EventSource, on_delete=models.PROTECT, related_name='events'
    )
    source_event_id = models.CharField(max_length=255, blank=True, null=True,
                                        help_text='Source-specific event identifier')
    device = models.ForeignKey(
        'devices.Device', on_delete=models.PROTECT, related_name='events'
    )

    event_type = models.CharField(max_length=50, db_index=True)
    event_status = models.CharField(max_length=20, db_index=True)
    severity = models.CharField(max_length=20, default='CRITICAL')

    event_time = models.DateTimeField(help_text='Timestamp from source (timezone-aware)')
    received_time = models.DateTimeField(help_text='Timestamp when system received event')

    message = models.TextField(blank=True, default='')

    metadata = models.JSONField(default=dict, blank=True,
                                 help_text='Source-specific metadata (e.g., prtg_device_id)')
    raw_payload = models.JSONField(default=dict, blank=True,
                                    help_text='Original payload for audit (sanitized)')

    idempotency_key = models.CharField(max_length=64, unique=True, db_index=True,
                                        help_text='SHA-256 hash for duplicate detection')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-event_time']
        indexes = [
            models.Index(fields=['source', 'event_type', 'event_status']),
            models.Index(fields=['device', 'event_type', 'event_status']),
            models.Index(fields=['-created_at']),
        ]

    def __str__(self):
        return f"[{self.source.name}] {self.event_type}/{self.event_status} - {self.device.name} @ {self.event_time}"
