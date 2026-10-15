"""
Live Network Traceroute Engine (Router SSH & Server Direct OS Traceroute).
Supports:
1. Router-to-Router SSH Traceroute (Cisco IOS-XR / IOS-XE / Classic IOS) with
   optional automated Bidirectional (Forward + Return) execution.
2. Server-initiated OS traceroute (`traceroute -n -w 1 -q 1 -m <max_hops> <target_ip>`).
"""
from concurrent.futures import ThreadPoolExecutor
import ipaddress
import logging
import re
import subprocess
import time
from typing import Any, Dict, List, Optional, Tuple

from common.ssh_client import ManagedSSHClient
from .service import filter_ip, extract_rtt_ms, wan2loopback_service

logger = logging.getLogger(__name__)

HOP_LINE_REGEX = re.compile(
    r'^\s*(\d+)\s+.*?([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})(.*)$'
)
TIMEOUT_HOP_REGEX = re.compile(r'^\s*(\d+)\s+(\*\s*)+$')


def validate_ipv4(ip_str: str) -> str:
    """Validate and normalize an IPv4 address string, raising ValueError if invalid."""
    cleaned = (ip_str or '').strip()
    ip_obj = ipaddress.IPv4Address(cleaned)
    return str(ip_obj)


def parse_traceroute_hops(raw_output: str, target_ip: Optional[str] = None) -> Tuple[List[Dict[str, Any]], str]:
    """
    Parse raw Cisco or Linux traceroute output into structured hops and clean hop text
    suitable for `Wan2LoopbackService.analyze_paths()`.
    """
    if not raw_output:
        return [], ''

    hops: List[Dict[str, Any]] = []
    formatted_lines: List[str] = []

    for line in raw_output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        lower = stripped.lower()
        # Skip command echo and headers
        if (
            lower.startswith('traceroute')
            or lower.startswith('tracing the route')
            or lower.startswith('type escape sequence')
            or lower.startswith('terminal length')
            or lower.startswith('source ')
        ):
            continue

        m = HOP_LINE_REGEX.match(stripped)
        if m:
            hop_num = int(m.group(1))
            hop_ip = m.group(2)
            rest = m.group(3) or ''
            # Extract RTT in ms or msec
            rtt_ms = extract_rtt_ms(rest.replace('msec', 'ms'))
            hops.append({
                'hop': hop_num,
                'ip': hop_ip,
                'rtt_ms': rtt_ms,
                'raw': stripped,
            })
            rtt_str = f" {rtt_ms} ms" if rtt_ms is not None else ""
            formatted_lines.append(f"{hop_num} {hop_ip}{rtt_str}")
            continue

        # Fallback: if a line starts with an IP or contains an IP not on a header line
        ip_cand = filter_ip(stripped)
        if ip_cand and not any(tok in lower for tok in ('tracing', 'traceroute', 'escape', 'unrecognized')):
            rtt_ms = extract_rtt_ms(stripped.replace('msec', 'ms'))
            hop_num = len(hops) + 1
            hops.append({
                'hop': hop_num,
                'ip': ip_cand,
                'rtt_ms': rtt_ms,
                'raw': stripped,
            })
            rtt_str = f" {rtt_ms} ms" if rtt_ms is not None else ""
            formatted_lines.append(f"{hop_num} {ip_cand}{rtt_str}")

    return hops, '\n'.join(formatted_lines)


class LiveTracerouteRunner:
    """Executes live network traceroutes from Cisco routers via SSH or from the EventAnalyzer server."""

    def execute_router_ssh_traceroute(
        self,
        router_ip: str,
        target_ip: str,
        source_interface: str = 'Loopback0',
        max_wait_seconds: float = 22.0,
    ) -> Dict[str, Any]:
        """
        Execute Router-to-Router traceroute using MPLS OAM (`traceroute mpls ipv4 <target> ... source <source_ip>`)
        with automatic OS detection (IOS-XR, IOS-XE, Classic IOS) and BGP-LU cross-domain segmentation.
        """
        from .segmented_oam_tracer import segmented_oam_tracer

        src_ip = validate_ipv4(router_ip)
        dst_ip = validate_ipv4(target_ip)
        start_ts = time.time()

        try:
            oam_res = segmented_oam_tracer.trace_direction(
                source_router_ip=src_ip,
                target_ip=dst_ip,
                max_domains=5,
            )
            hops = oam_res.get('stitched_hops', [])
            formatted_text = oam_res.get('formatted_text', '')
            used_cmd = oam_res.get('command') or f"traceroute mpls ipv4 {dst_ip} source {src_ip}"
            raw_output = oam_res.get('raw_output', '')
            elapsed = round(time.time() - start_ts, 2)

            return {
                'success': bool(oam_res.get('success')) and len(hops) > 0,
                'method': 'router_ssh',
                'source_router': src_ip,
                'source_hostname': oam_res.get('source_hostname', src_ip),
                'target_ip': dst_ip,
                'target_hostname': oam_res.get('target_hostname', dst_ip),
                'command': used_cmd,
                'elapsed_seconds': elapsed,
                'hops': hops,
                'segments': oam_res.get('segments', []),
                'formatted_text': formatted_text,
                'raw_output': raw_output,
                'error': oam_res.get('error'),
            }
        except Exception as e:
            elapsed = round(time.time() - start_ts, 2)
            logger.warning(f"ROUTER_SSH_TRACEROUTE_FAILED: src={src_ip} dst={dst_ip} err={e}")
            return {
                'success': False,
                'method': 'router_ssh',
                'source_router': src_ip,
                'target_ip': dst_ip,
                'error': str(e),
                'elapsed_seconds': elapsed,
                'hops': [],
                'segments': [],
                'formatted_text': '',
                'raw_output': '',
            }

    def execute_server_traceroute(
        self,
        target_ip: str,
        max_hops: int = 25,
        wait_sec: int = 1,
    ) -> Dict[str, Any]:
        """
        Execute OS-level `traceroute` directly from the EventAnalyzer backend container.
        """
        dst_ip = validate_ipv4(target_ip)
        safe_max_hops = max(1, min(int(max_hops or 25), 40))
        safe_wait = max(1, min(int(wait_sec or 1), 3))
        start_ts = time.time()

        cmd = ['traceroute', '-n', '-w', str(safe_wait), '-q', '1', '-m', str(safe_max_hops), dst_ip]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=25,
                check=False,
            )
            raw_output = (proc.stdout or '') + ('\n' + proc.stderr if proc.stderr else '')
            hops, formatted_text = parse_traceroute_hops(raw_output, dst_ip)
            elapsed = round(time.time() - start_ts, 2)
            return {
                'success': True,
                'method': 'server_os',
                'source_router': 'EventAnalyzer Server',
                'target_ip': dst_ip,
                'command': ' '.join(cmd),
                'elapsed_seconds': elapsed,
                'hops': hops,
                'formatted_text': formatted_text,
                'raw_output': raw_output.strip(),
            }
        except Exception as e:
            elapsed = round(time.time() - start_ts, 2)
            logger.error(f"SERVER_TRACEROUTE_ERROR: dst={dst_ip} err={e}")
            return {
                'success': False,
                'method': 'server_os',
                'source_router': 'EventAnalyzer Server',
                'target_ip': dst_ip,
                'error': str(e),
                'elapsed_seconds': elapsed,
                'hops': [],
                'formatted_text': '',
                'raw_output': '',
            }

    def run_and_analyze(
        self,
        trace_type: str = 'router_ssh',
        source_router_ip: str = '',
        target_ip: str = '',
        source_interface: str = 'Loopback0',
        auto_reverse: bool = True,
        auto_peer: bool = True,
        max_hops: int = 25,
    ) -> Dict[str, Any]:
        """
        Execute live traceroute (unidirectional or bidirectional) and immediately pass
        the discovered hops into `Wan2LoopbackService.analyze_paths()`.
        """
        from .segmented_oam_tracer import segmented_oam_tracer

        t_type = (trace_type or 'router_ssh').strip().lower()
        dst_ip = validate_ipv4(target_ip)

        fwd_result: Dict[str, Any] = {}
        ret_result: Optional[Dict[str, Any]] = None

        if t_type == 'server_os':
            fwd_result = self.execute_server_traceroute(dst_ip, max_hops=max_hops)
            analysis = wan2loopback_service.analyze_paths(
                mode='general',
                ipaddr=fwd_result.get('formatted_text', ''),
                auto_peer=auto_peer,
            )
        else:
            src_ip = validate_ipv4(source_router_ip)
            if auto_reverse and src_ip != dst_ip:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    fut_fwd = pool.submit(
                        self.execute_router_ssh_traceroute,
                        src_ip,
                        dst_ip,
                        source_interface,
                    )
                    fut_ret = pool.submit(
                        self.execute_router_ssh_traceroute,
                        dst_ip,
                        src_ip,
                        source_interface,
                    )
                    fwd_result = fut_fwd.result()
                    ret_result = fut_ret.result()
            else:
                fwd_result = self.execute_router_ssh_traceroute(
                    src_ip,
                    dst_ip,
                    source_interface,
                )

            if ret_result and ret_result.get('hops'):
                analysis = wan2loopback_service.analyze_paths(
                    mode='asymmetric',
                    ipaddr_fwd=fwd_result.get('formatted_text', ''),
                    ipaddr_ret=ret_result.get('formatted_text', ''),
                    auto_peer=auto_peer,
                )
            else:
                analysis = wan2loopback_service.analyze_paths(
                    mode='general',
                    ipaddr=fwd_result.get('formatted_text', ''),
                    auto_peer=auto_peer,
                )

            all_segments = list(fwd_result.get('segments', [])) + (
                list(ret_result.get('segments', [])) if ret_result else []
            )
            all_hops = list(fwd_result.get('hops', [])) + (
                list(ret_result.get('hops', [])) if ret_result else []
            )
            if all_segments or all_hops:
                segmented_oam_tracer._enrich_analysis_with_oam(
                    analysis, all_segments, all_hops
                )

        return {
            'trace_type': t_type,
            'forward_trace': fwd_result,
            'return_trace': ret_result,
            'analysis': analysis,
        }


live_traceroute_runner = LiveTracerouteRunner()
