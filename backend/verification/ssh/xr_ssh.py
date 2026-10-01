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
    
    # 0. Look for Cisco NCS/eXR tabular reboot history line (e.g. "1   Sep 22 2026 01:11:07   0x00000025  REBOOT_CAUSE_ADMIN")
    for line in lines:
        tab_match = re.match(r'^(?:1|\d+)\s+([A-Za-z]{3}\s+\d+\s+\d{4}\s+[\d:]+)\s+(0x[0-9a-fA-F]+)\s+(\S+)', line)
        if tab_match:
            timestamp = tab_match.group(1).strip()
            raw_cause = tab_match.group(3).strip()
            clean_cause = raw_cause.replace("REBOOT_CAUSE_", "").replace("_", " ").title()
            return {
                "found": True,
                "timestamp": timestamp,
                "reason": clean_cause,
                "category": categorize_reason(raw_cause),
                "summary_line": line
            }

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

    # 2. Look for Cisco IOS-XE explicit "Last reload reason: PowerOn" or "Last Reboot Reason: ..."
    for line in lines:
        m_last = re.search(r'last\s+(?:reload|reboot|reset)\s+reason\s*:\s*(.*)', line, re.IGNORECASE)
        if m_last:
            reason = m_last.group(1).strip()
            if reason:
                return {
                    "found": True,
                    "timestamp": "",
                    "reason": reason,
                    "category": categorize_reason(reason),
                    "summary_line": line
                }

    # 3. Look for "Reason: ..." or "reset reason: ..."
    for line in lines:
        if line.lower().startswith("reason:") or "reset reason:" in line.lower():
            parts = line.split(":", 1)
            if len(parts) > 1:
                reason = parts[1].strip()
                if reason:
                    return {
                        "found": True,
                        "timestamp": "",
                        "reason": reason,
                        "category": categorize_reason(reason),
                        "summary_line": line
                    }

    # 4. Fallback: Check for "System returned to ROM by ..." (cleanly extract cause without timestamp)
    for line in lines:
        m_rom = re.search(r'system\s+returned\s+to\s+rom\s+by\s+(.*?)(?:\s+at\s+.*)?$', line, re.IGNORECASE)
        if m_rom:
            reason = m_rom.group(1).strip()
            if reason:
                return {
                    "found": True,
                    "timestamp": "",
                    "reason": reason,
                    "category": categorize_reason(reason),
                    "summary_line": line
                }

    # 5. Fallback: Check for uptime in show version (e.g. "bk-aitc-pe-n540-1 uptime is 20 minutes")
    for line in lines:
        if "uptime is" in line.lower():
            m_up = re.search(r'uptime\s+is\s+(.*)', line, re.IGNORECASE)
            uptime_str = m_up.group(1).strip() if m_up else ""
            return {
                "found": True,
                "timestamp": "",
                "reason": f"System Restart Confirmed via CLI (Uptime: {uptime_str})",
                "category": "UNKNOWN",
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
    if any(k in r for k in ["power", "outage", "power-on", "power cycle", "brownout", "power_failure", "power_loss", "poweron"]):
        return "POWER_OUTAGE"
    elif any(k in r for k in ["user", "manual", "reload command", "admin", "cli", "reboot_cause_admin"]):
        return "MANUAL_RELOAD"
    elif any(k in r for k in ["kernel", "panic", "crash", "watchdog", "exception", "bus error", "reboot_cause_kernel"]):
        return "SOFTWARE_CRASH"
    elif any(k in r for k in ["upgrade", "install", "bootrom", "fpga", "reboot_cause_upgrade"]):
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
    Connects to Cisco IOS-XR device via SSH and runs 'show reboot history'.
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
            output = ""
            used_cmd = "show reboot history / show version"
            try:
                ch = ssh.open_interactive_shell()
                ch.send('terminal length 0\nshow reboot history\nshow version\n')
                import time
                time.sleep(2)
                while ch.recv_ready():
                    output += ch.recv(65535).decode('utf-8', errors='ignore')
            except Exception as e_sh:
                logger.warning(f"SSH_SHELL_WARN: {host} interactive shell error: {e_sh}")

            if not output:
                commands = ["show reboot history", "show reboot-history", "show version"]
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
