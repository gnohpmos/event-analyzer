from django.db import models


class Device(models.Model):
    """
    Core device entity — source-agnostic.
    Source-specific device IDs are stored in SourceDeviceMapping.
    """
    name = models.CharField(max_length=255)
    management_ip = models.GenericIPAddressField(unique=True)
    device_type = models.CharField(max_length=100, blank=True, default='')
    enabled = models.BooleanField(default=True)
    metadata = models.JSONField(default=dict, blank=True, help_text='Device metadata including optional snmp_community override')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # SNMP Enriched Fields & Province Location
    sys_name = models.CharField(max_length=255, blank=True, default='', help_text='Hostname queried from SNMP sysName')
    province_code = models.CharField(max_length=10, blank=True, default='', help_text='2-letter province code (e.g. BK, CR, SP)')
    province = models.CharField(max_length=100, blank=True, default='', help_text='Full province name in Thai')
    hardware_model = models.CharField(max_length=150, blank=True, default='', help_text='Chassis model name from ENTITY-MIB')
    serial_number = models.CharField(max_length=150, blank=True, default='', help_text='Chassis serial number from ENTITY-MIB')
    os_family = models.CharField(max_length=50, blank=True, default='', help_text='Operating system family (IOS-XR, IOS-XE, Classic IOS)')
    os_version = models.CharField(max_length=100, blank=True, default='')
    rca_strategy = models.CharField(max_length=50, blank=True, default='AUTO', help_text='RCA verification strategy: SSH_REBOOT_HISTORY or SNMP_WHY_RELOAD')
    last_snmp_synced_at = models.DateTimeField(null=True, blank=True, help_text='Timestamp of last successful SNMP inventory sync')

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.management_ip})"


class SourceDeviceMapping(models.Model):
    """
    Maps external source device identifiers to internal Device records.
    Allows one device to be referenced by multiple sources.
    """
    source = models.ForeignKey(
        'events.EventSource', on_delete=models.CASCADE, related_name='device_mappings'
    )
    source_device_id = models.CharField(max_length=255,
                                         help_text='Device ID as known by the external source')
    device = models.ForeignKey(
        Device, on_delete=models.CASCADE, related_name='source_mappings'
    )
    metadata = models.JSONField(default=dict, blank=True,
                                 help_text='Source-specific device metadata')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['source', 'source_device_id']
        ordering = ['source', 'source_device_id']

    def __str__(self):
        return f"[{self.source.name}] {self.source_device_id} → {self.device.name}"
