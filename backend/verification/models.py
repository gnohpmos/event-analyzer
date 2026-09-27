from django.db import models
from common.constants import VerificationType, VerificationStatus


class Verification(models.Model):
    """
    Records verification attempts for incidents.
    SNMP sysUpTime is the first verification type.
    Designed to support future verification types (PING, SSH, API, etc.).
    """
    incident = models.ForeignKey(
        'incidents.Incident', on_delete=models.CASCADE, related_name='verifications'
    )
    device = models.ForeignKey(
        'devices.Device', on_delete=models.PROTECT, related_name='verifications'
    )

    verification_type = models.CharField(
        max_length=50, choices=VerificationType.CHOICES,
        default=VerificationType.SNMP_SYSUPTIME
    )
    status = models.CharField(
        max_length=20, choices=VerificationStatus.CHOICES,
        default=VerificationStatus.PENDING
    )

    check_time = models.DateTimeField(blank=True, null=True,
                                       help_text='When the check was performed')

    result = models.JSONField(
        default=dict, blank=True, null=True,
        help_text='Structured verification result'
    )
    evidence = models.JSONField(
        default=dict, blank=True, null=True,
        help_text='Evidence data (e.g., router_uptime_seconds, estimated_boot_time)'
    )
    error_message = models.TextField(blank=True, null=True)

    attempt_number = models.IntegerField(default=1)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return (f"[{self.verification_type}] {self.incident.incident_number} "
                f"attempt #{self.attempt_number} — {self.status}")
