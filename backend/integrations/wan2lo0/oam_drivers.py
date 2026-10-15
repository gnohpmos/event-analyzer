"""
MPLS OAM CLI Drivers & OS Adapters for Unified / Seamless MPLS (BGP-LU).
Provides specialized command generation, execution pipelines with fallback,
and output normalization across:
1. Cisco IOS-XR (ASR9001, ASR9901, ASR9010, NCS540, 8808)
2. Cisco IOS-XE (ASR920, ASR1001-X, ISR4000, Catalyst 8000)
3. Cisco Classic IOS (Cisco 7600, 7609 SUP720/RSP720, ME3600X, Catalyst 6500)
"""
import abc
import ipaddress
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

IP_REGEX = re.compile(r'\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b')
RTT_REGEX = re.compile(r'([0-9]+(?:\.[0-9]+)?)\s*(?:ms|msec|sec)', re.IGNORECASE)


def validate_ipv4(ip_str: str) -> str:
    """Validate and return normalized IPv4 address string."""
    cleaned = (ip_str or '').strip()
    return str(ipaddress.IPv4Address(cleaned))


def sanitize_input(value: str) -> str:
    """Sanitize CLI arguments to prevent command injection."""
    return re.sub(r'[^A-Za-z0-9/\.\-_:\s]', '', (value or '').strip())


class BaseOAMDriver(abc.ABC):
    """Abstract Base Class for OS-specific BGP-LU and MPLS OAM drivers."""

    os_family: str = "generic"

    @abc.abstractmethod
    def get_bgp_lu_commands(self, target_ip: str) -> List[str]:
        """Return candidate BGP-LU route lookup commands in preference order."""
        pass

    @abc.abstractmethod
    def parse_bgp_output(self, output: str, target_ip: str) -> Dict[str, Any]:
        """Parse BGP-LU CLI output into normalized Next-Hop, Labels, and Path status."""
        pass

    @abc.abstractmethod
    def get_lsp_trace_commands(self, target_ip: str, source_ip: Optional[str] = None) -> List[str]:
        """Return candidate MPLS LSP Traceroute commands with source IP."""
        pass

    def get_ip_route_commands(self, target_ip: str) -> List[str]:
        """Return fallback IP routing table lookup commands."""
        return [f"show ip route {target_ip}"]

    def parse_ip_route_output(self, output: str, target_ip: str) -> Dict[str, Any]:
        """Parse standard IP route output to identify Next-Hop router."""
        if not output:
            return {'found': False, 'next_hop': None, 'protocol': 'unknown'}
        # Check for 'Routing entry for ...' or 'Known via "..."'
        if '% Network not in table' in output or '% Subnet not in table' in output:
            return {'found': False, 'next_hop': None, 'protocol': 'none'}

        # Look for next hop e.g. "Known via ... Routing via 10.x.x.x" or "* 10.x.x.x"
        m_nh = re.search(r'(?:via|directly connected via)\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})', output, re.IGNORECASE)
        if not m_nh:
            m_nh = re.search(r'\*\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})', output)

        nh = m_nh.group(1) if m_nh else None
        return {
            'found': nh is not None,
            'next_hop': nh,
            'protocol': 'ip_route',
            'raw': output[:400],
        }

    def parse_lsp_trace_output(self, output: str) -> List[Dict[str, Any]]:
        """
        Normalize LSP Traceroute output across Cisco IOS-XR / IOS-XE / Classic IOS.
        Extracts Hop number, Hop IP, Return Code, Label Stack, and RTT (ms).
        """
        hops: List[Dict[str, Any]] = []
        if not output:
            return hops

        for line in output.splitlines():
            line_str = line.strip()
            if not line_str:
                continue

            # Skip header or instructions
            lower = line_str.lower()
            if any(tok in lower for tok in ('tracing', 'type escape', 'codes:', 'sh mpls', 'traceroute mpls')):
                continue

            # Standard Cisco LSP Trace Hop pattern:
            # e.g.:
            #   0 10.128.128.254 MRU 9200 [Labels: 25505 Exp: 0]
            # L 1 10.128.128.253 MRU 9200 [Labels: 96 Exp: 0] 6 ms
            # L 2 10.128.128.30 MRU 9200 [Labels: implicit-null Exp: 0] 4 ms
            # ! 3 10.128.128.14 5 ms
            # 0 10.5.0.59 MRU 1500 [Labels: 4631/25649 Exp: 0/0]
            # 1 10.5.0.60 1 ms MRU 1500 [Labels: implicit-null/25649 Exp: 0/0] 1 ms
            # 2 10.5.140.44 2 ms
            m = re.match(
                r'^\s*([!LRDPFmNUxBQ\?]?)\s*(\d+)\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})(.*)$',
                line_str,
            )
            if not m:
                continue

            code = m.group(1).strip()
            hop_num = int(m.group(2))
            ip = m.group(3).strip()
            rest = m.group(4) or ''

            # Extract labels if present: [Labels: 4631/25649 Exp: 0/0]
            labels: List[Any] = []
            m_labels = re.search(r'\[Labels:\s*([^\]]+?)(?:\s+Exp:[^\]]+)?\]', rest, re.IGNORECASE)
            if m_labels:
                lbl_text = m_labels.group(1).strip()
                for lbl in lbl_text.split('/'):
                    lbl_clean = lbl.strip()
                    if lbl_clean.isdigit():
                        labels.append(int(lbl_clean))
                    elif lbl_clean:
                        labels.append(lbl_clean)

            # Extract RTT
            rtt_matches = RTT_REGEX.findall(rest)
            rtt_ms: Optional[float] = None
            if rtt_matches:
                try:
                    vals = [float(x) for x in rtt_matches]
                    rtt_ms = round(sum(vals) / len(vals), 2)
                except Exception:
                    pass

            status = 'ok'
            if code == '!':
                status = 'success'
            elif code in ('F', 'f'):
                status = 'no_fec_mapping'
            elif code in ('m', 'M'):
                status = 'unsupported_tlv'
            elif code == '.':
                status = 'timeout'
            elif code == 'L':
                status = 'labeled'

            hops.append({
                'hop': hop_num,
                'ip': ip,
                'code': code or '!',
                'status': status,
                'labels': labels,
                'rtt_ms': rtt_ms,
                'raw': line_str,
            })

        return hops


class CiscoXROAMDriver(BaseOAMDriver):
    """Driver for Cisco IOS-XR (ASR9K, ASR9901, NCS540, 8808)."""

    os_family = "ios_xr"

    def get_bgp_lu_commands(self, target_ip: str) -> List[str]:
        target = validate_ipv4(target_ip)
        return [
            f"show bgp ipv4 labeled-unicast {target}/32",
            f"show bgp ipv4 labeled-unicast {target}",
            f"show route {target}/32",
        ]

    def parse_bgp_output(self, output: str, target_ip: str) -> Dict[str, Any]:
        """
        Parse Cisco IOS-XR `show bgp ipv4 labeled-unicast` output.
        Extracts paths, Best Next-Hop, Received Label, and Local Label.
        """
        result: Dict[str, Any] = {
            'found': False,
            'target_ip': target_ip,
            'best_next_hop': None,
            'best_label': None,
            'local_label': None,
            'paths': [],
            'raw_sample': output[:500] if output else '',
        }
        if not output or 'Network not in table' in output:
            return result

        # Check for Local Label (on ABR nodes where local label is advertised to peers)
        m_local = re.search(r'Local\s+Label:\s+(\d+)', output, re.IGNORECASE)
        if m_local:
            result['local_label'] = int(m_local.group(1))

        # Look for paths blocks
        # Format:
        #   10.5.140.44 (metric 20) from 10.5.0.251 (10.5.0.251)
        #     Received Label 25649
        #     Origin IGP, ..., valid, internal, best, ...
        # Or:
        #   Local, (Received from a RR-client), (received & used)
        #     10.5.140.111 (metric 215) from 10.5.140.111 (10.5.140.111)
        #       Received Label 3
        #       Origin IGP, ..., best, ...
        lines = output.splitlines()
        current_path: Optional[Dict[str, Any]] = None

        for idx, line in enumerate(lines):
            line_str = line.strip()
            # Next hop line
            m_nh = re.search(
                r'^(?:(?:\w+,\s*)*)?([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\s*(?:\(metric\s+(\d+)\))?\s+from\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})',
                line_str,
            )
            if m_nh:
                if current_path and current_path.get('next_hop'):
                    result['paths'].append(current_path)

                nh_ip = m_nh.group(1)
                metric_val = int(m_nh.group(2)) if m_nh.group(2) else 0
                peer_ip = m_nh.group(3)
                current_path = {
                    'next_hop': nh_ip,
                    'metric': metric_val,
                    'from_peer': peer_ip,
                    'label': None,
                    'is_best': False,
                }
                continue

            if current_path:
                m_rx_lbl = re.search(r'Received\s+Label\s+(\d+|implicit-null|imp-null)', line_str, re.IGNORECASE)
                if m_rx_lbl:
                    lbl = m_rx_lbl.group(1)
                    current_path['label'] = int(lbl) if lbl.isdigit() else lbl

                if 'best' in line_str.lower():
                    current_path['is_best'] = True

        if current_path and current_path.get('next_hop'):
            result['paths'].append(current_path)

        # Select best path
        if result['paths']:
            result['found'] = True
            best_candidate = next((p for p in result['paths'] if p.get('is_best')), result['paths'][0])
            result['best_next_hop'] = best_candidate['next_hop']
            result['best_label'] = best_candidate['label']

        return result

    def get_lsp_trace_commands(self, target_ip: str, source_ip: Optional[str] = None) -> List[str]:
        target = validate_ipv4(target_ip)
        if source_ip:
            src = validate_ipv4(source_ip)
            return [
                f"traceroute mpls ipv4 {target}/32 source {src}",
                f"traceroute mpls ipv4 {target} source {src}",
                f"traceroute mpls ipv4 {target}/32",
                f"traceroute mpls ipv4 {target}",
            ]
        return [
            f"traceroute mpls ipv4 {target}/32",
            f"traceroute mpls ipv4 {target}",
        ]


class CiscoXEOAMDriver(BaseOAMDriver):
    """Driver for Cisco IOS-XE (ASR920, ASR1001-X, ISR4000, Catalyst 8000)."""

    os_family = "ios_xe"

    def get_bgp_lu_commands(self, target_ip: str) -> List[str]:
        target = validate_ipv4(target_ip)
        return [
            f"show ip bgp {target}",
            f"show ip bgp labels {target}",
            f"show bgp ipv4 unicast {target}",
        ]

    def parse_bgp_output(self, output: str, target_ip: str) -> Dict[str, Any]:
        """
        Parse Cisco IOS-XE `show ip bgp <target>` output.
        Handles `mpls labels in/out nolabel/<label>` and best path markers.
        """
        result: Dict[str, Any] = {
            'found': False,
            'target_ip': target_ip,
            'best_next_hop': None,
            'best_label': None,
            'local_label': None,
            'paths': [],
            'raw_sample': output[:500] if output else '',
        }
        if not output or 'Network not in table' in output:
            return result

        lines = output.splitlines()
        current_path: Optional[Dict[str, Any]] = None

        for line in lines:
            line_str = line.strip()
            # Next hop line on IOS-XE:
            # 10.5.170.55 (metric 200) from 10.5.170.55 (10.5.170.55)
            # or:
            # 10.5.0.59 (metric 1325) from 10.5.170.252 (10.5.170.252)
            m_nh = re.search(
                r'^(?:(?:\w+,\s*)*)?([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\s*(?:\(metric\s+(\d+)\))?\s+from\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})',
                line_str,
            )
            if m_nh:
                if current_path and current_path.get('next_hop'):
                    result['paths'].append(current_path)

                nh_ip = m_nh.group(1)
                metric_val = int(m_nh.group(2)) if m_nh.group(2) else 0
                peer_ip = m_nh.group(3)
                current_path = {
                    'next_hop': nh_ip,
                    'metric': metric_val,
                    'from_peer': peer_ip,
                    'label': None,
                    'is_best': False,
                }
                continue

            if current_path:
                # IOS-XE MPLS labels line:
                # mpls labels in/out nolabel/33051
                # or: mpls labels in/out nolabel/imp-null
                m_lbl = re.search(r'mpls\s+labels\s+in/out\s+(\S+)/(\S+)', line_str, re.IGNORECASE)
                if m_lbl:
                    in_lbl = m_lbl.group(1).strip()
                    out_lbl = m_lbl.group(2).strip()
                    if out_lbl and out_lbl.lower() not in ('none', 'nolabel'):
                        current_path['label'] = int(out_lbl) if out_lbl.isdigit() else out_lbl
                    if in_lbl and in_lbl.lower() not in ('none', 'nolabel'):
                        result['local_label'] = int(in_lbl) if in_lbl.isdigit() else in_lbl

                # Check best indicator
                if 'best' in line_str.lower():
                    current_path['is_best'] = True

        if current_path and current_path.get('next_hop'):
            result['paths'].append(current_path)

        if result['paths']:
            result['found'] = True
            best_candidate = next((p for p in result['paths'] if p.get('is_best')), result['paths'][0])
            result['best_next_hop'] = best_candidate['next_hop']
            result['best_label'] = best_candidate['label']

        return result

    def get_lsp_trace_commands(self, target_ip: str, source_ip: Optional[str] = None) -> List[str]:
        target = validate_ipv4(target_ip)
        if source_ip:
            src = validate_ipv4(source_ip)
            return [
                f"traceroute mpls ipv4 {target} 255.255.255.255 source {src}",
                f"traceroute mpls ipv4 {target}/32 source {src}",
                f"traceroute mpls ipv4 {target} 255.255.255.255",
                f"traceroute mpls ipv4 {target}/32",
                f"traceroute mpls ipv4 {target}",
            ]
        return [
            f"traceroute mpls ipv4 {target} 255.255.255.255",
            f"traceroute mpls ipv4 {target}/32",
            f"traceroute mpls ipv4 {target}",
        ]


class CiscoClassicIOSDriver(BaseOAMDriver):
    """Driver for Cisco Classic IOS (Cisco 7600, 7609 SUP720, ME3600X, 6500)."""

    os_family = "classic_ios"

    def get_bgp_lu_commands(self, target_ip: str) -> List[str]:
        target = validate_ipv4(target_ip)
        return [
            f"show ip bgp {target}",
            f"show ip route {target}",
        ]

    def parse_bgp_output(self, output: str, target_ip: str) -> Dict[str, Any]:
        """
        Parse Classic IOS `show ip bgp <target>` output.
        Similar format to IOS-XE with `mpls labels in/out nolabel/<label>`.
        """
        result: Dict[str, Any] = {
            'found': False,
            'target_ip': target_ip,
            'best_next_hop': None,
            'best_label': None,
            'local_label': None,
            'paths': [],
            'raw_sample': output[:500] if output else '',
        }
        if not output or 'Network not in table' in output:
            return result

        lines = output.splitlines()
        current_path: Optional[Dict[str, Any]] = None

        for line in lines:
            line_str = line.strip()
            # Look for next-hop line
            m_nh = re.search(
                r'^(?:(?:\w+,\s*)*)?([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\s*(?:\(metric\s+(\d+)\))?\s+from\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})',
                line_str,
            )
            if m_nh:
                if current_path and current_path.get('next_hop'):
                    result['paths'].append(current_path)

                nh_ip = m_nh.group(1)
                metric_val = int(m_nh.group(2)) if m_nh.group(2) else 0
                peer_ip = m_nh.group(3)
                current_path = {
                    'next_hop': nh_ip,
                    'metric': metric_val,
                    'from_peer': peer_ip,
                    'label': None,
                    'is_best': False,
                }
                continue

            if current_path:
                m_lbl = re.search(r'mpls\s+labels\s+in/out\s+(\S+)/(\S+)', line_str, re.IGNORECASE)
                if m_lbl:
                    in_lbl = m_lbl.group(1).strip()
                    out_lbl = m_lbl.group(2).strip()
                    if out_lbl and out_lbl.lower() not in ('none', 'nolabel'):
                        current_path['label'] = int(out_lbl) if out_lbl.isdigit() else out_lbl
                    if in_lbl and in_lbl.lower() not in ('none', 'nolabel'):
                        result['local_label'] = int(in_lbl) if in_lbl.isdigit() else in_lbl

                if 'best' in line_str.lower():
                    current_path['is_best'] = True

        if current_path and current_path.get('next_hop'):
            result['paths'].append(current_path)

        if result['paths']:
            result['found'] = True
            best_candidate = next((p for p in result['paths'] if p.get('is_best')), result['paths'][0])
            result['best_next_hop'] = best_candidate['next_hop']
            result['best_label'] = best_candidate['label']

        return result

    def get_lsp_trace_commands(self, target_ip: str, source_ip: Optional[str] = None) -> List[str]:
        target = validate_ipv4(target_ip)
        # Classic IOS requires subnet mask 255.255.255.255, NOT CIDR /32
        if source_ip:
            src = validate_ipv4(source_ip)
            return [
                f"traceroute mpls ipv4 {target} 255.255.255.255 source {src}",
                f"traceroute mpls ipv4 {target} 255.255.255.255",
                f"traceroute mpls ipv4 {target}",
            ]
        return [
            f"traceroute mpls ipv4 {target} 255.255.255.255",
            f"traceroute mpls ipv4 {target}",
        ]


def detect_router_os(model: str = '', hostname: str = '') -> str:
    """
    Classify router model or hostname into one of: 'ios_xr', 'ios_xe', 'classic_ios'.
    Matches hardware models commonly deployed in MPLS Core/Aggregation/Access.
    """
    m = (model or '').upper()
    h = (hostname or '').upper()
    combo = f"{m} {h}"

    # 1. Classic IOS check (must precede IOS-XR so CISCO7206VXR does not match 'XR')
    classic_keywords = (
        '7206', '7200', '7609', '7606', '7604', '7600',
        '6509', '6500', 'ME3600', 'ME-3600', 'ME3800', 'ME-3800',
        '36CX', 'CLASSIC'
    )
    if any(k in combo for k in classic_keywords):
        return 'classic_ios'

    # 2. IOS-XE check (must precede IOS-XR so ASR-920 is not captured by ASR-9)
    xe_keywords = (
        '920', 'ASR920', 'ASR-920', 'A920',
        '1001', '1002', '1004', 'ASR1K', 'ASR-1K', 'ASR1001',
        'ISR4', 'CAT8', 'C8', 'IOS-XE', 'IOSXE'
    )
    if any(k in combo for k in xe_keywords):
        return 'ios_xe'

    # 3. IOS-XR check: ASR9K (9001, 9901, 9902, 9010, etc.), NCS540, NCS5500, NCS5000, 8808, 8000
    xr_keywords = (
        '9001', '9901', '9902', '9903', '9010', '9006', '9904', '9906', '9910', '9922',
        'ASR9K', 'ASR-9K', 'ASR90', 'ASR99', 'ASR-90', 'ASR-99',
        'NCS', 'N540', 'N-540', '5501', '5001',
        '8808', '8000', 'IOS-XR', 'IOSXR'
    )
    if any(k in combo for k in xr_keywords):
        return 'ios_xr'
    if re.search(r'\bXR\b', combo):
        return 'ios_xr'

    # 4. Fallback heuristics: Assume IOS-XR if PE/CORE, else IOS-XE
    if 'PE' in combo or 'CORE' in combo:
        return 'ios_xr'
    return 'ios_xe'


def get_oam_driver(model_or_os: str = '', hostname: str = '') -> BaseOAMDriver:
    """Factory to instantiate the appropriate OS-aware OAM driver."""
    os_name = detect_router_os(model=model_or_os, hostname=hostname)
    if os_name == 'ios_xr':
        return CiscoXROAMDriver()
    elif os_name == 'classic_ios':
        return CiscoClassicIOSDriver()
    else:
        return CiscoXEOAMDriver()


def execute_with_fallback(
    ch,
    candidate_commands: List[str],
    wait_sec: float = 0.8,
    max_timeout: float = 12.0,
    error_patterns: Optional[List[str]] = None,
) -> Tuple[str, str]:
    """
    Execute commands from a prioritized list over an existing Paramiko interactive channel.
    Automatically moves to the next candidate command if a syntax error or invalid input is detected.
    Returns: (output_text, used_command)
    """
    if error_patterns is None:
        error_patterns = [
            'invalid input',
            'incomplete command',
            'ambiguous command',
            'syntax error',
            'unrecognized command',
            'invalid source',
            'is an invalid source address',
            'translating "',
            'bad mask',
            'unknown keyword',
        ]

    for cmd in candidate_commands:
        while ch.recv_ready():
            ch.recv(65535)

        ch.send(cmd + "\n")
        time.sleep(wait_sec)

        buf = ""
        deadline = time.time() + max_timeout
        while time.time() < deadline:
            while ch.recv_ready():
                buf += ch.recv(65535).decode('utf-8', errors='ignore')

            # Check if router prompt returned
            lines = [ln.strip() for ln in buf.splitlines() if ln.strip()]
            if len(lines) >= 2 and (lines[-1].endswith('#') or lines[-1].endswith('>')):
                break
            time.sleep(0.2)

        low = buf.lower()
        has_error = any(pat in low for pat in error_patterns)
        if not has_error:
            return buf, cmd
        logger.info(f"OAM_FALLBACK_TRIGGERED: cmd='{cmd}' returned syntax error. Trying next...")

    # If all candidate commands had error patterns, return the last output
    return buf, candidate_commands[-1] if candidate_commands else ""
