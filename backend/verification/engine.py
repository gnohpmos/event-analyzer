"""
Verification Engine — Orchestrates device verification checks.
Supports extensible verification types (SNMP_SYSUPTIME, etc.).
"""
from dataclasses import dataclass
from datetime import timedelta
import logging
from typing import Optional

from django.conf import settings
from django.utils import timezone

from common.constants import VerificationType, VerificationStatus
from devices.models import Device
from verification.models import Verification
from verification.snmp.snmp_v2 import SNMPv2Client
from verification.ssh.xr_ssh import get_xr_reboot_history

logger = logging.getLogger(__name__)


@dataclass
class EngineVerificationResult:
    status: str
    evidence: dict
    result: dict
    error_message: Optional[str] = None


class VerificationEngine:
    """Orchestrates verification strategies for incidents."""

    def __init__(self):
        self.snmp_v2_client = SNMPv2Client()

    def verify_device(
        self,
        device: Device,
        verification_type: str = VerificationType.SNMP_SYSUPTIME,
        timeout: int = 5,
        retries: int = 1
    ) -> EngineVerificationResult:
        """Execute verification check for a given device."""
        if verification_type == VerificationType.SNMP_SYSUPTIME:
            return self._verify_snmp_sysuptime(device, timeout=timeout, retries=retries)
        else:
            return EngineVerificationResult(
                status=VerificationStatus.FAILED,
                evidence={},
                result={},
                error_message=f"Unsupported verification type: {verification_type}"
            )

    def _verify_snmp_sysuptime(
        self,
        device: Device,
        timeout: int = 5,
        retries: int = 1
    ) -> EngineVerificationResult:
        """Run SNMP sysUpTime query and compute estimated boot time."""
        check_time = timezone.now()
        host = device.management_ip

        # Support per-device community override from device metadata, fallback to default in SNMPv2Client
        community = None
        if device.metadata and isinstance(device.metadata, dict):
            community = device.metadata.get('snmp_community')

        snmp_res = self.snmp_v2_client.get_sysuptime(
            host=host,
            community=community,
            timeout=timeout,
            retries=retries
        )

        if not snmp_res.success:
            err_msg = snmp_res.error_message or "SNMP query failed"
            status_val = VerificationStatus.TIMEOUT if "timeout" in err_msg.lower() else VerificationStatus.FAILED

            return EngineVerificationResult(
                status=status_val,
                evidence={},
                result={"error": err_msg},
                error_message=err_msg
            )

        # Compute estimated boot time
        uptime_seconds = snmp_res.router_uptime_seconds
        estimated_boot_time = check_time - timedelta(seconds=uptime_seconds)

        # Retrieve Reload Reason: SNMP whyReload (Classic/XE) or SSH show reboot-history (IOS-XR)
        reload_reason = None
        reload_method = "NONE"
        reload_category = "UNKNOWN"

        reboot_threshold = getattr(settings, 'ROUTER_REBOOT_THRESHOLD_SECONDS', 3600)
        if uptime_seconds < reboot_threshold:
            # Check strategy preference (IOS-XR prioritizes SSH show reboot-history)
            is_xr = (
                getattr(device, 'rca_strategy', '') == 'SSH_REBOOT_HISTORY'
                or getattr(device, 'os_family', '') == 'IOS-XR'
            )

            if is_xr:
                meta = device.metadata if isinstance(device.metadata, dict) else {}
                ssh_user = meta.get('ssh_username')
                ssh_pwd = meta.get('ssh_password')
                ssh_port = int(meta.get('ssh_port', 22))

                ssh_res = get_xr_reboot_history(
                    host=host,
                    username=ssh_user,
                    password=ssh_pwd,
                    port=ssh_port,
                    timeout=5
                )
                if ssh_res.get("success"):
                    reload_reason = ssh_res.get("parsed_reason")
                    reload_category = ssh_res.get("category", "UNKNOWN")
                    reload_method = "SSH_REBOOT_HISTORY"
                elif snmp_res.why_reload:
                    reload_reason = snmp_res.why_reload
                    reload_method = "SNMP_WHY_RELOAD"
                    r_lower = reload_reason.lower()
                    if "power" in r_lower:
                        reload_category = "POWER_OUTAGE"
                    elif "reload" in r_lower:
                        reload_category = "MANUAL_RELOAD"
                    else:
                        reload_category = "OTHER"
                else:
                    reload_reason = "Reload detected via sysUpTime (Reason N/A via SNMP/SSH)"
                    reload_method = "SYSUPTIME_ONLY"
            else:
                # Classic IOS or IOS-XE prefers SNMP whyReload
                if snmp_res.why_reload:
                    reload_reason = snmp_res.why_reload
                    reload_method = "SNMP_WHY_RELOAD"
                    r_lower = reload_reason.lower()
                    if "power" in r_lower:
                        reload_category = "POWER_OUTAGE"
                    elif "reload" in r_lower:
                        reload_category = "MANUAL_RELOAD"
                    else:
                        reload_category = "OTHER"
                else:
                    # Fallback to SSH if whyReload was absent
                    meta = device.metadata if isinstance(device.metadata, dict) else {}
                    ssh_user = meta.get('ssh_username')
                    ssh_pwd = meta.get('ssh_password')
                    ssh_port = int(meta.get('ssh_port', 22))

                    ssh_res = get_xr_reboot_history(
                        host=host,
                        username=ssh_user,
                        password=ssh_pwd,
                        port=ssh_port,
                        timeout=5
                    )
                    if ssh_res.get("success"):
                        reload_reason = ssh_res.get("parsed_reason")
                        reload_category = ssh_res.get("category", "UNKNOWN")
                        reload_method = "SSH_REBOOT_HISTORY"
                    else:
                        reload_reason = "Reload detected via sysUpTime (Reason N/A via SNMP/SSH)"
                        reload_method = "SYSUPTIME_ONLY"

        evidence = {
            "raw_sysuptime": snmp_res.raw_sysuptime,
            "router_uptime_seconds": uptime_seconds,
            "reload_reason": reload_reason,
            "reload_method": reload_method,
            "reload_category": reload_category,
            "snmp_checked_at": check_time.isoformat(),
            "estimated_boot_time": estimated_boot_time.isoformat(),
            "snmp_version": snmp_res.snmp_version,
        }

        result = {
            "status": "SUCCESS",
            "message": f"sysUpTime retrieved successfully: {uptime_seconds:.2f}s",
            "host": host,
            "reload_reason": reload_reason,
            "reload_method": reload_method,
        }

        return EngineVerificationResult(
            status=VerificationStatus.SUCCESS,
            evidence=evidence,
            result=result,
            error_message=None
        )
