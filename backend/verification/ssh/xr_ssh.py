"""
SSH Client for Cisco IOS-XR Reboot History Automation.
Executes 'show reboot-history' to accurately extract root causes for restarts.
"""
import logging
import re
from typing import Optional, Dict, Any

from common.settings_helper import get_setting
from common.ssh_client import ManagedSSHClient

logger = logging.getLogger(__name__)


def parse_xr_reboot_history(raw_output: str) -> Dict[str, Any]:
    """
    Parses 'show reboot-history' or 'show version' output from Cisco IOS-XR.
    Returns structured reboot metadata.
    """
    lines = [line.strip() for line in raw_output.splitlines() if line.strip()]
    
    # 1. Look for indexed reboot history line like "1: 2026-06-17 00:53:55 UTC: User initiated reload"
    for line in lines:
        match = re.match(r'^(?:1:|\d+:)\s*(?:(\d{4}[-/]\d{2}[-/]\d{2}\s+[\d:]+(?:\s+[A-Z]+)?))?:?\s*(.*)$', line, re.IGNORECASE)
        if match:
            timestamp = match.group(1) or ""
            reason = match.group(2).strip()
            if reason:
                return {
                    "found": True,
                    "timestamp": timestamp,
                    "reason": reason,
                    "category": categorize_reason(reason),
                    "summary_line": line
                }

    # 2. Look for "Last Reboot Reason: ..." or "Reason: ..."
    for line in lines:
        if "reboot reason" in line.lower() or "reset reason" in line.lower():
            parts = line.split(":", 1)
            if len(parts) > 1:
                reason = parts[1].strip()
                return {
                    "found": True,
                    "timestamp": "",
                    "reason": reason,
                    "category": categorize_reason(reason),
                    "summary_line": line
                }

    # 3. Fallback: Check for Last reload reason in show version
    for line in lines:
        if "last reload reason" in line.lower() or "returned to rom" in line.lower():
            parts = line.split(":", 1)
            reason = parts[1].strip() if len(parts) > 1 else line
            return {
                "found": True,
                "timestamp": "",
                "reason": reason,
                "category": categorize_reason(reason),
                "summary_line": line
            }

    return {
        "found": False,
        "timestamp": "",
        "reason": "Unknown (Unable to parse output)",
        "category": "UNKNOWN",
        "summary_line": lines[0] if lines else ""
    }


def categorize_reason(reason: str) -> str:
    """Categorizes free-text reboot reason into standardized incident cause."""
    r = reason.lower()
    if any(k in r for k in ["user", "manual", "reload command", "admin", "cli"]):
        return "MANUAL_RELOAD"
    elif any(k in r for k in ["power", "outage", "power-on", "power cycle", "brownout"]):
        return "POWER_OUTAGE"
    elif any(k in r for k in ["kernel", "panic", "crash", "watchdog", "exception", "bus error"]):
        return "SOFTWARE_CRASH"
    elif any(k in r for k in ["upgrade", "install", "bootrom", "fpga"]):
        return "MAINTENANCE_UPGRADE"
    return "OTHER"


def get_xr_reboot_history(
    host: str,
    username: Optional[str] = None,
    password: Optional[str] = None,
    port: int = 22,
    timeout: int = 5
) -> Dict[str, Any]:
    """
    Connects to Cisco IOS-XR device via SSH and runs 'show reboot-history'.
    Falls back to 'show version' if needed. Uses ManagedSSHClient.
    """
    user = username or get_setting('SSH_USERNAME', 'admin')
    pwd = password if password is not None else get_setting('SSH_PASSWORD', '')

    if not pwd:
        logger.warning(f"SSH_XR_ABORT: No SSH password configured for host={host}")
        return {
            "success": False,
            "host": host,
            "error_message": "SSH Password not configured in System Settings or Device Metadata.",
            "reason": None
        }

    try:
        with ManagedSSHClient(host=host, username=user, password=pwd, port=port, timeout=timeout) as ssh:
            commands = ["show reboot-history", "admin show reboot-history", "show version"]
            output, used_cmd = ssh.execute_with_fallback(commands)

            parsed = parse_xr_reboot_history(output)
            logger.info(
                f"SSH_XR_SUCCESS: host={host} cmd='{used_cmd}' parsed_reason='{parsed['reason']}' category={parsed['category']}"
            )

            return {
                "success": True,
                "host": host,
                "raw_output": output[:1000],
                "parsed_reason": parsed["reason"],
                "timestamp": parsed["timestamp"],
                "category": parsed["category"],
                "summary_line": parsed["summary_line"],
                "error_message": None
            }

    except Exception as e:
        err = f"SSH connection error: {str(e)}"
        logger.error(f"SSH_XR_EXCEPTION: host={host} error={str(e)}")
        return {
            "success": False,
            "host": host,
            "error_message": err,
            "reason": None
        }
