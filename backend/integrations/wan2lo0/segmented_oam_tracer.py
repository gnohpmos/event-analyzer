"""
Segmented Hop-by-Hop OAM Tracing Engine for Unified / Seamless MPLS (BGP-LU).
Orchestrates domain-by-domain traversal, queries BGP-LU route tables at ABRs,
executes reliable intra-domain LSP traces, and stitches segments into an end-to-end path.
"""
from concurrent.futures import ThreadPoolExecutor
import ipaddress
import logging
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from common.ssh_client import ManagedSSHClient
from .oam_drivers import (
    BaseOAMDriver,
    get_oam_driver,
    detect_router_os,
    execute_with_fallback,
    validate_ipv4,
)
from .service import Wan2LoopbackService, wan2loopback_service

logger = logging.getLogger(__name__)

_router_locks_guard = threading.Lock()
_router_locks: Dict[str, threading.Lock] = {}


def _get_router_lock(router_ip: str) -> threading.Lock:
    with _router_locks_guard:
        if router_ip not in _router_locks:
            _router_locks[router_ip] = threading.Lock()
        return _router_locks[router_ip]


class SegmentedOAMTracer:
    """
    Executes Segmented Hop-by-Hop MPLS OAM Tracing across BGP-LU domain boundaries.
    Always uses `traceroute mpls ipv4 <target> ... source <source_ip>`.
    """

    def __init__(self, service: Optional[Wan2LoopbackService] = None):
        self.service = service or wan2loopback_service

    def _get_node_metadata(self, ip_str: str) -> Dict[str, Any]:
        """Fetch router hostname, model, and location from nodeinfo."""
        try:
            conn = self.service._get_connection()
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT ip_nms, hostname, model, location FROM nodeinfo WHERE ip_nms = %s LIMIT 1",
                        (ip_str,),
                    )
                    row = cur.fetchone()
                    if row:
                        return {
                            'ip': ip_str,
                            'hostname': (row.get('hostname') or ip_str).strip(),
                            'model': (row.get('model') or '').strip(),
                            'location': (row.get('location') or '').strip(),
                        }
        except Exception as e:
            logger.warning(f"NODE_METADATA_FETCH_ERR: ip={ip_str} err={e}")

        return {'ip': ip_str, 'hostname': ip_str, 'model': '', 'location': ''}

    def trace_direction(
        self,
        source_router_ip: str,
        target_ip: str,
        max_domains: int = 5,
    ) -> Dict[str, Any]:
        """
        Execute domain-by-domain MPLS OAM tracing in a single direction (`source_router_ip` -> `target_ip`),
        always executing `traceroute mpls ipv4 <trace_target> ... source <current_router>`.
        """
        start_ts = time.time()
        src_ip = validate_ipv4(source_router_ip)
        dst_ip = validate_ipv4(target_ip)

        src_meta = self._get_node_metadata(src_ip)
        dst_meta = self._get_node_metadata(dst_ip)

        segments: List[Dict[str, Any]] = []
        visited_routers: Set[str] = set()
        current_router = src_ip
        domain_idx = 1
        trace_failed_reason: Optional[str] = None

        while domain_idx <= max_domains:
            if current_router in visited_routers:
                logger.warning(f"SEGMENTED_OAM_LOOP_DETECTED: router {current_router} visited twice")
                break
            visited_routers.add(current_router)

            curr_meta = self._get_node_metadata(current_router)
            driver = get_oam_driver(curr_meta.get('model', ''), curr_meta.get('hostname', ''))

            logger.info(
                f"SEGMENTED_OAM_STEP: domain={domain_idx} router={current_router} "
                f"({curr_meta['hostname']}) model={curr_meta['model']} os={driver.os_family}"
            )

            seg_start = time.time()
            try:
                router_lock = _get_router_lock(current_router)
                with router_lock:
                    with ManagedSSHClient(host=current_router, timeout=10) as ssh:
                        ch = ssh.open_interactive_shell()
                        try:
                            ch.send("terminal length 0\n")
                            time.sleep(0.4)
                            while ch.recv_ready():
                                ch.recv(65535)

                            # Step 1: Query BGP-LU table for target_ip
                            bgp_cmds = driver.get_bgp_lu_commands(dst_ip)
                            bgp_out, used_bgp_cmd = execute_with_fallback(
                                ch, bgp_cmds, wait_sec=0.8, max_timeout=10.0
                            )
                            parsed_bgp = driver.parse_bgp_output(bgp_out, dst_ip)

                            next_hop = parsed_bgp.get('best_next_hop')
                            bgp_label = parsed_bgp.get('best_label')
                            local_label = parsed_bgp.get('local_label')

                            # Determine trace destination for this domain:
                            # - If dst_ip is in the same domain (no BGP-LU entry, or BGP-LU next_hop == dst_ip),
                            #   trace directly to dst_ip in a single segment (is_final = True).
                            # - If dst_ip crosses a BGP-LU ABR (next_hop != dst_ip), trace to the ABR first.
                            is_final = False
                            if not next_hop or next_hop == dst_ip or next_hop == current_router:
                                trace_target = dst_ip
                                is_final = True
                            else:
                                trace_target = next_hop

                            # Step 2: Execute Intra-Domain LSP Traceroute WITH source <current_router>
                            trace_cmds = driver.get_lsp_trace_commands(
                                trace_target, source_ip=current_router
                            )
                            trace_out, used_trace_cmd = execute_with_fallback(
                                ch, trace_cmds, wait_sec=1.0, max_timeout=18.0
                            )
                            hops = driver.parse_lsp_trace_output(trace_out)

                            target_meta = self._get_node_metadata(trace_target)
                            seg_elapsed = round(time.time() - seg_start, 2)

                            segment_data = {
                                'domain_index': domain_idx,
                                'domain_name': f"Domain {domain_idx} ({curr_meta['hostname']} -> {target_meta['hostname']})",
                                'source_router': current_router,
                                'source_hostname': curr_meta['hostname'],
                                'source_model': curr_meta['model'],
                                'target_router': trace_target,
                                'target_hostname': target_meta['hostname'],
                                'target_model': target_meta['model'],
                                'driver_os': driver.os_family,
                                'nexthop': next_hop or trace_target,
                                'bgp_label': bgp_label,
                                'local_label': local_label,
                                'is_final_segment': is_final,
                                'elapsed_seconds': seg_elapsed,
                                'bgp_command': used_bgp_cmd,
                                'trace_command': used_trace_cmd,
                                'hops': hops,
                                'raw_trace': trace_out.strip(),
                            }
                            segments.append(segment_data)

                            if is_final or trace_target == dst_ip:
                                logger.info(f"SEGMENTED_OAM_FINISHED: reached final destination {dst_ip}")
                                break

                            # Advance to next domain router
                            current_router = trace_target
                            domain_idx += 1

                        finally:
                            try:
                                ch.close()
                            except Exception:
                                pass

            except Exception as e:
                seg_elapsed = round(time.time() - seg_start, 2)
                logger.error(f"SEGMENTED_OAM_ERROR: router={current_router} err={e}")
                trace_failed_reason = f"Failed to connect or query router {current_router}: {e}"
                segments.append({
                    'domain_index': domain_idx,
                    'domain_name': f"Domain {domain_idx} (Error at {curr_meta['hostname']})",
                    'source_router': current_router,
                    'source_hostname': curr_meta['hostname'],
                    'source_model': curr_meta['model'],
                    'target_router': dst_ip,
                    'target_hostname': dst_meta['hostname'],
                    'target_model': dst_meta['model'],
                    'driver_os': driver.os_family,
                    'nexthop': None,
                    'bgp_label': None,
                    'local_label': None,
                    'is_final_segment': True,
                    'elapsed_seconds': seg_elapsed,
                    'bgp_command': '',
                    'trace_command': '',
                    'hops': [],
                    'error': str(e),
                    'raw_trace': '',
                })
                break

        elapsed = round(time.time() - start_ts, 2)
        stitched_hops, formatted_text = self._stitch_hops(segments, src_ip, dst_ip)
        cmd_summary = ' -> '.join(
            seg['trace_command'] for seg in segments if seg.get('trace_command')
        )
        raw_combined = '\n\n'.join(
            f"=== [{seg['domain_name']}] {seg['source_hostname']} ({seg['source_router']}) ===\n"
            f"$ {seg['trace_command']}\n{seg.get('raw_trace', '')}"
            for seg in segments
        )

        return {
            'success': len(segments) > 0 and trace_failed_reason is None,
            'source_router': src_ip,
            'source_hostname': src_meta['hostname'],
            'target_ip': dst_ip,
            'target_hostname': dst_meta['hostname'],
            'total_domains': len(segments),
            'elapsed_seconds': elapsed,
            'segments': segments,
            'stitched_hops': stitched_hops,
            'formatted_text': formatted_text,
            'command': cmd_summary,
            'raw_output': raw_combined,
            'error': trace_failed_reason,
        }

    def trace(
        self,
        source_router_ip: str,
        target_ip: str,
        max_domains: int = 5,
        auto_peer: bool = True,
        auto_reverse: bool = False,
    ) -> Dict[str, Any]:
        """
        Execute domain-by-domain segmented OAM tracing from `source_router_ip` to `target_ip`
        (and optionally in reverse if `auto_reverse=True`).
        """
        start_ts = time.time()
        src_ip = validate_ipv4(source_router_ip)
        dst_ip = validate_ipv4(target_ip)

        ret_dir_res: Optional[Dict[str, Any]] = None
        if auto_reverse and src_ip != dst_ip:
            with ThreadPoolExecutor(max_workers=2) as pool:
                fut_fwd = pool.submit(self.trace_direction, src_ip, dst_ip, max_domains)
                fut_ret = pool.submit(self.trace_direction, dst_ip, src_ip, max_domains)
                fwd_dir_res = fut_fwd.result()
                ret_dir_res = fut_ret.result()
        else:
            fwd_dir_res = self.trace_direction(src_ip, dst_ip, max_domains=max_domains)

        total_elapsed = round(time.time() - start_ts, 2)
        segments = fwd_dir_res['segments']
        stitched_hops = fwd_dir_res['stitched_hops']
        formatted_text = fwd_dir_res['formatted_text']

        if ret_dir_res and ret_dir_res.get('stitched_hops'):
            analysis = self.service.analyze_paths(
                mode='asymmetric',
                ipaddr_fwd=formatted_text,
                ipaddr_ret=ret_dir_res.get('formatted_text', ''),
                auto_peer=auto_peer,
            )
            all_segments = segments + ret_dir_res.get('segments', [])
            all_hops = stitched_hops + ret_dir_res.get('stitched_hops', [])
            self._enrich_analysis_with_oam(analysis, all_segments, all_hops)
        else:
            analysis = self.service.analyze_paths(
                mode='general',
                ipaddr=formatted_text,
                auto_peer=auto_peer,
            )
            self._enrich_analysis_with_oam(analysis, segments, stitched_hops)

        return {
            'success': fwd_dir_res['success'],
            'method': 'segmented_mpls_oam',
            'source_router': src_ip,
            'source_hostname': fwd_dir_res['source_hostname'],
            'target_ip': dst_ip,
            'target_hostname': fwd_dir_res['target_hostname'],
            'total_domains': len(segments),
            'total_elapsed_seconds': total_elapsed,
            'segments': segments,
            'return_segments': ret_dir_res.get('segments', []) if ret_dir_res else [],
            'stitched_hops': stitched_hops,
            'return_stitched_hops': ret_dir_res.get('stitched_hops', []) if ret_dir_res else [],
            'formatted_text': formatted_text,
            'return_formatted_text': ret_dir_res.get('formatted_text', '') if ret_dir_res else '',
            'analysis': analysis,
            'error': fwd_dir_res.get('error'),
        }

    def _stitch_hops(
        self,
        segments: List[Dict[str, Any]],
        source_ip: str,
        target_ip: str,
    ) -> Tuple[List[Dict[str, Any]], str]:
        """
        Merge hops from each segment in sequential order, removing redundant border hops,
        calculating cumulative RTT, and generating formatted text lines for Wan2Loopback.
        """
        stitched: List[Dict[str, Any]] = []
        formatted_lines: List[str] = []
        global_hop_idx = 1
        seen_ips: Set[str] = set()

        for seg in segments:
            domain_idx = seg.get('domain_index', 1)
            bgp_label = seg.get('bgp_label')
            hops = seg.get('hops', [])

            for h_idx, h in enumerate(hops):
                hop_ip = h.get('ip')
                if not hop_ip:
                    continue

                # Merge label stack: transport label + domain BGP-LU label
                label_stack = list(h.get('labels') or [])
                if bgp_label and bgp_label not in label_stack:
                    label_stack.append(bgp_label)

                is_border = (
                    (h_idx == len(hops) - 1 and not seg.get('is_final_segment'))
                    or (hop_ip == seg.get('target_router') and not seg.get('is_final_segment'))
                )
                rtt = h.get('rtt_ms')

                stitched.append({
                    'hop': global_hop_idx,
                    'segment_index': domain_idx,
                    'ip': hop_ip,
                    'code': h.get('code', '!'),
                    'status': h.get('status', 'ok'),
                    'labels': label_stack,
                    'rtt_ms': rtt,
                    'is_domain_border': is_border,
                    'raw': h.get('raw', ''),
                })

                rtt_str = f" {rtt} ms" if rtt is not None else ""
                formatted_lines.append(f"{global_hop_idx} {hop_ip}{rtt_str}")
                global_hop_idx += 1

        return stitched, '\n'.join(formatted_lines)

    def _enrich_analysis_with_oam(
        self,
        analysis: Dict[str, Any],
        segments: List[Dict[str, Any]],
        stitched_hops: List[Dict[str, Any]],
    ) -> None:
        """
        Enrich Wan2Loopback analysis output with OAM label stacks and domain markers.
        """
        if not analysis:
            return

        hop_map = {h['ip']: h for h in stitched_hops}

        # Enrich records across all record collections
        for rec_key in ('records_all', 'records_gen', 'records_fwd', 'records_ret'):
            for rec in analysis.get(rec_key, []):
                ip = rec.get('ip_address')
                if ip in hop_map:
                    h_info = hop_map[ip]
                    rec['mpls_labels'] = h_info.get('labels', [])
                    rec['domain_index'] = h_info.get('segment_index')
                    rec['is_domain_border'] = h_info.get('is_domain_border', False)

        # Enrich js_edges with label stacks if matching endpoints
        for edge in analysis.get('js_edges', []):
            edge_ips = [edge.get('ip_a'), edge.get('ip_b')]
            for ip in edge_ips:
                if ip and ip in hop_map and hop_map[ip].get('labels'):
                    edge['labels'] = hop_map[ip]['labels']
                    break


segmented_oam_tracer = SegmentedOAMTracer()
