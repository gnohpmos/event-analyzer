"""
SSH Collector for Cisco IOS-XR Chassis Inventory (Model & Serial Number).
Handles both Classic 32-bit (admin show/sh inventory chassis) and 64-bit (show/sh inventory chassis).
Supports interactive shell for routers with strict TACACS authorization or large banners.
"""
import logging
import re
import time
from typing import Optional, Dict, Any
from common.settings_helper import get_setting
from common.ssh_client import ManagedSSHClient

logger = logging.getLogger(__name__)


def parse_chassis_inventory(raw_output: str) -> Dict[str, Optional[str]]:
    """
    Parses 'show inventory chassis', 'admin show inventory chassis', or 'admin show inventory' output.
    Returns:
        dict: {'model': str, 'serial': str, 'descr': str, 'vid': str}
    """
    result = {
        'model': None,
        'serial': None,
        'descr': None,
        'vid': None,
    }

    # Extract PID / Model: e.g. PID: ASR-9001, PID: N540-12Z20G-SYS-D, PID: ASR-9010-DC-V2
    pid_match = re.search(r'PID:\s*([A-Za-z0-9\-_]+)', raw_output, re.IGNORECASE)
    if pid_match:
        val = pid_match.group(1).strip()
        if val and val.lower() not in ('none', 'unspecified', 'n/a'):
            result['model'] = val

    # Extract SN / Serial Number: e.g. SN: FOC1835N6ED, SN: FOC2744N545, SN: FOX2233PC6E
    sn_match = re.search(r'SN:\s*([A-Za-z0-9]+)', raw_output, re.IGNORECASE)
    if sn_match:
        val = sn_match.group(1).strip()
        if val and val.lower() not in ('none', 'unspecified', 'n/a'):
            result['serial'] = val

    # Extract DESCR
    descr_match = re.search(r'DESCR:\s*"([^"]+)"', raw_output, re.IGNORECASE)
    if descr_match:
        result['descr'] = descr_match.group(1).strip()

    # Extract VID
    vid_match = re.search(r'VID:\s*([A-Za-z0-9\-_]+)', raw_output, re.IGNORECASE)
    if vid_match:
        result['vid'] = vid_match.group(1).strip()

    return result


def fetch_xr_chassis_ssh(
    host: str,
    is_32bit: bool = False,
    username: Optional[str] = None,
    password: Optional[str] = None,
    port: int = 22,
    timeout: int = 8
) -> Dict[str, Any]:
    """
    Connects to Cisco IOS-XR router via SSH to collect chassis inventory.
    Uses 'admin show inventory chassis' for 32-bit (e.g. ASR-9001 / IOS-XR < 7.0)
    and 'show inventory chassis' for 64-bit (e.g. NCS-540 / IOS-XR >= 7.0).
    Has multi-command fallback for modular routers (ASR-9010) and TACACS command authorization rules.
    """
    user = username or get_setting('SSH_USERNAME', 'aitbckcfg')
    pwd = password if password is not None else get_setting('SSH_PASSWORD', '')

    if not pwd:
        logger.warning(f"SSH_XR_INVENTORY: No SSH password configured for host={host}")
        return {'success': False, 'error': 'No SSH password configured'}

    if is_32bit:
        commands = [
            "admin show inventory chassis",
            "admin show inventory",
            "admin sh inventory chassis",
            "show inventory chassis"
        ]
    else:
        commands = [
            "show inventory chassis",
            "sh inventory chassis",
            "admin show inventory chassis",
            "admin show inventory"
        ]

    try:
        with ManagedSSHClient(host=host, username=user, password=pwd, port=port, timeout=timeout) as ssh:
            chan = ssh.open_interactive_shell(term='vt100', width=256, height=100)

            parsed = {'model': None, 'serial': None, 'descr': None, 'vid': None}
            output = ''
            used_cmd = commands[0]

            for cmd in commands:
                chan.send(cmd + '\n')
                cmd_out = ''
                start_t = time.time()
                while (time.time() - start_t) < 3.0:
                    if chan.recv_ready():
                        chunk = chan.recv(65535).decode('utf-8', errors='ignore')
                        cmd_out += chunk
                        if 'PID:' in cmd_out and 'SN:' in cmd_out:
                            break
                    time.sleep(0.2)

                res = parse_chassis_inventory(cmd_out)
                if res['model'] or res['serial']:
                    parsed = res
                    output = cmd_out
                    used_cmd = cmd
                    break

            success = bool(parsed['serial'] or parsed['model'])
            logger.info(
                f"SSH_XR_INVENTORY_RESULT: host={host} success={success} cmd='{used_cmd}' model={parsed['model']} serial={parsed['serial']}"
            )
            return {
                'success': success,
                'model': parsed['model'],
                'serial': parsed['serial'],
                'descr': parsed['descr'],
                'vid': parsed['vid'],
                'command_used': used_cmd,
                'raw_output': output[:1000]
            }

    except Exception as e:
        logger.warning(f"SSH_XR_INVENTORY_FAILED on {host}: {e}")
        return {'success': False, 'error': str(e)}
