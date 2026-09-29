from django.db import models
from django.utils import timezone
from common.constants import (
    IncidentStatus, IncidentType, Classification as ClassificationConst,
    Confidence, TimelineEventType, RelationshipType
)


class Incident(models.Model):
    """
    Tracks a device or link incident lifecycle from DOWN to RECOVERED.
    Not tied to any specific source — works with normalized events only.
    """
    incident_number = models.CharField(max_length=30, unique=True, db_index=True)

    incident_type = models.CharField(
        max_length=20, choices=IncidentType.CHOICES,
        default=IncidentType.DEVICE, db_index=True
    )

    primary_device = models.ForeignKey(
        'devices.Device', on_delete=models.PROTECT, related_name='incidents'
    )

    interface_name = models.CharField(
        max_length=150, blank=True, default='', db_index=True,
        help_text='Interface or port name if incident_type is LINK'
    )
    link_description = models.CharField(
        max_length=300, blank=True, default='',
        help_text='Link description or circuit info extracted from PRTG sensor or ifAlias'
    )
    prtg_sensor_id = models.CharField(
        max_length=50, blank=True, default='', db_index=True,
        help_text='PRTG sensor ID if from PRTG'
    )
    ticket_id_tss = models.CharField(
        max_length=50, blank=True, default='', db_index=True,
        help_text='Trouble Ticket ID from TSS/TTS (e.g. SD26094869)'
    )
    circuit_id = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Circuit ID / NTID (e.g. TBB145020)'
    )
    remote_device = models.CharField(
        max_length=150, blank=True, default='',
        help_text='Remote endpoint hostname or IP'
    )
    remote_interface = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Remote endpoint interface name'
    )
    site_name = models.CharField(
        max_length=150, blank=True, default='',
        help_text='Site / Station name'
    )
    tts_status = models.CharField(
        max_length=50, blank=True, default='',
        help_text='Trouble Ticket status in ITSM/TTS (e.g. Work In Progress, Resolved, Closed)'
    )
    repair_team = models.CharField(
        max_length=200, blank=True, default='',
        help_text='Responsible repair team from TTS'
    )
    response_department = models.CharField(
        max_length=200, blank=True, default='',
        help_text='Responsible department or area from TTS'
    )
    actual_cause = models.TextField(
        blank=True, default='',
        help_text='Actual root cause recorded by repair team in TTS'
    )
    resolution = models.TextField(
        blank=True, default='',
        help_text='Resolution action taken by repair team in TTS'
    )
    source_gps = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Source location GPS coordinates (lat, lon)'
    )
    dest_gps = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Destination location GPS coordinates (lat, lon)'
    )

    status = models.CharField(
        max_length=30, choices=IncidentStatus.CHOICES,
        default=IncidentStatus.DOWN, db_index=True
    )
    classification = models.CharField(
        max_length=50, choices=ClassificationConst.CHOICES,
        blank=True, null=True
    )
    confidence = models.CharField(
        max_length=20, choices=Confidence.CHOICES,
        blank=True, null=True
    )

    flap_count = models.PositiveIntegerField(
        default=0,
        help_text='Number of times link or device flapped during this incident'
    )
    soak_until = models.DateTimeField(
        null=True, blank=True,
        help_text='Timestamp when continuous UP hold-down soak period completes'
    )
    net_downtime_seconds = models.FloatField(
        default=0.0,
        help_text='Accumulated actual downtime across all flap cycles in seconds'
    )
    last_down_time = models.DateTimeField(
        null=True, blank=True,
        help_text='Timestamp of the most recent DOWN state transition'
    )
    last_up_time = models.DateTimeField(
        null=True, blank=True,
        help_text='Timestamp of the most recent UP state transition'
    )

    down_time = models.DateTimeField(help_text='When device or link first went down')
    up_time = models.DateTimeField(blank=True, null=True,
                                    help_text='When device or link came back up permanently')
    last_seen = models.DateTimeField(help_text='Last event timestamp for this incident')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['primary_device', 'status']),
            models.Index(fields=['incident_type', 'status']),
            models.Index(fields=['primary_device', 'interface_name', 'status']),
            models.Index(fields=['-down_time']),
        ]

    def __str__(self):
        return f"{self.incident_number} [{self.status}] {self.primary_device.name}"

    @property
    def is_active(self):
        return self.status in IncidentStatus.ACTIVE_STATUSES

    @property
    def device_name(self):
        return self.primary_device.name if self.primary_device else ''

    @property
    def device_ip(self):
        return self.primary_device.management_ip if self.primary_device else ''

    @property
    def device_type(self):
        return self.primary_device.device_type if self.primary_device else ''

    @property
    def downtime_seconds(self):
        if self.net_downtime_seconds and self.net_downtime_seconds > 0:
            return round(self.net_downtime_seconds, 1)
        if self.up_time and self.down_time:
            return (self.up_time - self.down_time).total_seconds()
        return None

    def add_timeline_entry(self, event_type: str, source: str = '', description: str = '', data: dict = None, timestamp=None):
        """Helper to append an entry to the incident timeline."""
        ts = timestamp or timezone.now()
        return EventTimeline.objects.create(
            incident=self,
            event_type=event_type,
            source=source,
            description=description,
            data=data or {},
            timestamp=ts
        )

    def link_event(self, event, relationship_type=RelationshipType.PRIMARY):
        """Helper to link a NetworkEvent to this incident."""
        return IncidentEvent.objects.create(
            incident=self,
            event=event,
            relationship_type=relationship_type
        )


class IncidentEvent(models.Model):
    """
    Links NetworkEvents to Incidents. Supports multi-source events per incident.
    """
    incident = models.ForeignKey(
        Incident, on_delete=models.CASCADE, related_name='incident_events'
    )
    event = models.ForeignKey(
        'events.NetworkEvent', on_delete=models.CASCADE, related_name='incident_links'
    )
    relationship_type = models.CharField(
        max_length=20, choices=RelationshipType.CHOICES,
        default=RelationshipType.PRIMARY
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.incident.incident_number} ← {self.event} ({self.relationship_type})"


class EventTimeline(models.Model):
    """
    Chronological record of everything that happened during an incident.
    """
    incident = models.ForeignKey(
        Incident, on_delete=models.CASCADE, related_name='timeline',
        null=True, blank=True
    )
    event_type = models.CharField(max_length=50, choices=TimelineEventType.CHOICES)
    source = models.CharField(max_length=100, blank=True, default='',
                               help_text='Which source generated this event')
    description = models.TextField(blank=True, default='')
    data = models.JSONField(default=dict, blank=True,
                             help_text='Additional structured data for this timeline entry')

    timestamp = models.DateTimeField(help_text='When this event occurred')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        inc_str = self.incident.incident_number if self.incident else "NO_INCIDENT"
        return f"{inc_str} | {self.timestamp} | {self.event_type}"
