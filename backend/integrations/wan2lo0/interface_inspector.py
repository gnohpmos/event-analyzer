"""
Per-Router / Per-Interface Traffic Loss Diagnostic Engine (`RouterInterfaceInspector`).
Inspects every router (`ip_loopback`) and interface (`interface`) along a resolved
traceroute topology across 6 dimensions of packet loss & traffic degradation:
1. Physical / Layer-1-2 Errors (CRC, FCS, Frame, Input/Output Errors, Runts, Giants)
2. Queue Drops & Bandwidth Utilization % (Input/Output Drops, Rx/Tx Mbps vs BW)
3. Real-Time Delta Rate Check (Δ Errors & Δ Drops over 3 seconds to detect ACTIVE LOSS)
4. Optical Transceiver Power (DOM/DDM Rx/Tx dBm)
5. Path-Wide MTU Consistency Check (detects silent jumbo/MPLS packet drop bottlenecks)
6. Link Stability & Flap History (Carrier Transitions, Last Link Flapped, OperStatus)
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from pysnmp.hlapi.asyncio import (
    SnmpEngine, CommunityData, UdpTransportTarget,
    ContextData, ObjectType, ObjectIdentity, getCmd, nextCmd
)

from common.settings_helper import get_setting
from common.ssh_client import ManagedSSHClient
from .oam_drivers import detect_router_os

logger = logging.getLogger(__name__)


def parse_cisco_interface_output(raw_text: str) -> Dict[str, Any]:
    """
    Parse Cisco IOS-XR, IOS-XE, and Classic IOS `show interfaces <intf>` CLI output
    into normalized health metrics.
    """
    metrics: Dict[str, Any] = {
        'admin_status': 'unknown',
        'oper_status': 'unknown',
        'mtu_bytes': None,
        'bw_kbps': None,
        'rx_bps': 0,
        'tx_bps': 0,
        'rx_pps': 0,
        'tx_pps': 0,
        'rx_mbps': 0.0,
        'tx_mbps': 0.0,
        'rx_load_pct': 0.0,
        'tx_load_pct': 0.0,
        'in_errors': 0,
        'out_errors': 0,
        'crc_errors': 0,
        'frame_errors': 0,
        'runts': 0,
        'giants': 0,
        'in_drops': 0,
        'out_drops': 0,
        'carrier_transitions': 0,
        'last_flapped': '',
    }
    if not raw_text:
        return metrics

    # 1. Admin / Line Protocol status
    m_state = re.search(
        r'is\s+(administratively down|up|down).*?line protocol is\s+(up|down)',
        raw_text,
        re.IGNORECASE,
    )
    if m_state:
        adm = m_state.group(1).strip().lower()
        opr = m_state.group(2).strip().lower()
        metrics['admin_status'] = 'admin-down' if 'admin' in adm else adm
        metrics['oper_status'] = opr

    # 2. MTU & Bandwidth
    m_mtu = re.search(r'MTU\s+(\d+)\s+bytes', raw_text, re.IGNORECASE)
    if m_mtu:
        metrics['mtu_bytes'] = int(m_mtu.group(1))

    m_bw = re.search(r'BW\s+(\d+)\s*Kbit', raw_text, re.IGNORECASE)
    if m_bw:
        metrics['bw_kbps'] = int(m_bw.group(1))

    # 3. Last link flapped
    m_flap = re.search(r'Last link flapped\s+([^\r\n]+)', raw_text, re.IGNORECASE)
    if m_flap:
        metrics['last_flapped'] = m_flap.group(1).strip()

    # 4. Input / Output rate (bits/sec, packets/sec)
    m_in_rate = re.search(
        r'input rate\s+(\d+)\s+bits/sec,\s+(\d+)\s+packets/sec',
        raw_text,
        re.IGNORECASE,
    )
    if m_in_rate:
        metrics['rx_bps'] = int(m_in_rate.group(1))
        metrics['rx_pps'] = int(m_in_rate.group(2))
        metrics['rx_mbps'] = round(metrics['rx_bps'] / 1_000_000.0, 2)

    m_out_rate = re.search(
        r'output rate\s+(\d+)\s+bits/sec,\s+(\d+)\s+packets/sec',
        raw_text,
        re.IGNORECASE,
    )
    if m_out_rate:
        metrics['tx_bps'] = int(m_out_rate.group(1))
        metrics['tx_pps'] = int(m_out_rate.group(2))
        metrics['tx_mbps'] = round(metrics['tx_bps'] / 1_000_000.0, 2)

    if metrics['bw_kbps'] and metrics['bw_kbps'] > 0:
        bw_bps = metrics['bw_kbps'] * 1000.0
        metrics['rx_load_pct'] = round(min(100.0, (metrics['rx_bps'] / bw_bps) * 100.0), 2)
        metrics['tx_load_pct'] = round(min(100.0, (metrics['tx_bps'] / bw_bps) * 100.0), 2)

    # 5. Queue Drops (IOS/IOS-XE & IOS-XR variants)
    m_ios_q = re.search(
        r'Input queue:\s*\d+/\d+/(\d+)/\d+.*?Total output drops:\s*(\d+)',
        raw_text,
        re.IGNORECASE | re.DOTALL,
    )
    if m_ios_q:
        metrics['in_drops'] = int(m_ios_q.group(1))
        metrics['out_drops'] = int(m_ios_q.group(2))
    else:
        m_in_d = re.search(r'(\d+)\s+input drops', raw_text, re.IGNORECASE)
        if m_in_d:
            metrics['in_drops'] = int(m_in_d.group(1))
        m_out_d = re.search(r'(?:Total\s+)?output drops[:\s]+(\d+)|(\d+)\s+output drops', raw_text, re.IGNORECASE)
        if m_out_d:
            val = m_out_d.group(1) or m_out_d.group(2)
            metrics['out_drops'] = int(val)

    # 6. Physical Errors (Input errors, CRC, Frame, Runts, Giants, Output errors, Carrier transitions)
    m_in_err = re.search(r'(\d+)\s+input errors', raw_text, re.IGNORECASE)
    if m_in_err:
        metrics['in_errors'] = int(m_in_err.group(1))

    m_crc = re.search(r'(\d+)\s+CRC', raw_text, re.IGNORECASE)
    if m_crc:
        metrics['crc_errors'] = int(m_crc.group(1))

    m_frame = re.search(r'(\d+)\s+frame', raw_text, re.IGNORECASE)
    if m_frame:
        metrics['frame_errors'] = int(m_frame.group(1))

    m_runts = re.search(r'(\d+)\s+runts', raw_text, re.IGNORECASE)
    if m_runts:
        metrics['runts'] = int(m_runts.group(1))

    m_giants = re.search(r'(\d+)\s+giants', raw_text, re.IGNORECASE)
    if m_giants:
        metrics['giants'] = int(m_giants.group(1))

    m_out_err = re.search(r'(\d+)\s+output errors', raw_text, re.IGNORECASE)
    if m_out_err:
        metrics['out_errors'] = int(m_out_err.group(1))

    m_carrier = re.search(r'(\d+)\s+carrier transitions', raw_text, re.IGNORECASE)
    if m_carrier:
        metrics['carrier_transitions'] = int(m_carrier.group(1))

    return metrics


def parse_optical_dom_output(raw_text: str) -> Dict[str, Optional[float]]:
    """
    Parse Optical Transceiver DOM/DDM Rx Power (dBm) and Tx Power (dBm) from
    Cisco IOS-XR (`show controllers <intf> phy`) or IOS-XE (`show interfaces <intf> transceiver`).
    """
    optical: Dict[str, Optional[float]] = {
        'tx_power_dbm': None,
        'rx_power_dbm': None,
    }
    if not raw_text or '% invalid' in raw_text.lower():
        return optical

    # IOS-XR pattern: "Tx Power : -1.25 dBm", "Actual TX Power = -2.26 dBm", "Rx Power = -2.90 dBm"
    m_tx = re.search(
        r'(?:Tx|Transmit)\s*Power[^:\r\n=]*[:\s=]+([+-]?\d+\.\d+)\s*(?:dBm)?',
        raw_text,
        re.IGNORECASE,
    )
    if m_tx:
        try:
            optical['tx_power_dbm'] = round(float(m_tx.group(1)), 2)
        except ValueError:
            pass

    m_rx = re.search(
        r'(?:Rx|Receive|Optical)\s*Power[^:\r\n=]*[:\s=]+([+-]?\d+\.\d+)\s*(?:dBm)?',
        raw_text,
        re.IGNORECASE,
    )
    if m_rx:
        try:
            optical['rx_power_dbm'] = round(float(m_rx.group(1)), 2)
        except ValueError:
            pass

    # IOS-XE table fallback: "Gi0/0/1   34.2   3.28   18.4   -2.1   -6.4"
    if optical['rx_power_dbm'] is None:
        m_table = re.search(
            r'^\s*[A-Za-z]+\d+/[0-9/]+\s+[+-]?\d+\.\d+\s+[+-]?\d+\.\d+\s+[+-]?\d+\.\d+\s+([+-]?\d+\.\d+)\s+([+-]?\d+\.\d+)',
            raw_text,
            re.MULTILINE,
        )
        if m_table:
            try:
                optical['tx_power_dbm'] = round(float(m_table.group(1)), 2)
                optical['rx_power_dbm'] = round(float(m_table.group(2)), 2)
            except ValueError:
                pass

    return optical


def parse_bundle_identification(intf_str: str) -> Optional[Dict[str, Any]]:
    """
    Detect if an interface is a LAG bundle (Bundle-Ether / Port-channel) or a sub-interface.
    Returns parent bundle details or None if it's a regular physical interface.
    """
    s = (intf_str or '').strip()
    m_be = re.match(r'^(?:bundle-?ether|be)\s*(\d+)(?:\.(\d+))?$', s, re.IGNORECASE)
    if m_be:
        bundle_id = m_be.group(1)
        subif = m_be.group(2)
        return {
            'is_bundle': True,
            'bundle_type': 'bundle_ether',
            'bundle_id': bundle_id,
            'sub_interface': subif,
            'parent_interface': f'Bundle-Ether{bundle_id}',
            'raw_target': s,
        }
    m_po = re.match(r'^(?:port-?channel|po)\s*(\d+)(?:\.(\d+))?$', s, re.IGNORECASE)
    if m_po:
        bundle_id = m_po.group(1)
        subif = m_po.group(2)
        return {
            'is_bundle': True,
            'bundle_type': 'port_channel',
            'bundle_id': bundle_id,
            'sub_interface': subif,
            'parent_interface': f'Port-channel{bundle_id}',
            'raw_target': s,
        }
    return None


def parse_ios_xr_bundle_output(output: str) -> Dict[str, Any]:
    """
    Parse Cisco IOS-XR `show bundle Bundle-Ether <id>` CLI output.
    Extracts status, link counts (active/standby/configured), bandwidth, and member list.
    """
    res: Dict[str, Any] = {
        'status': 'unknown',
        'active_links': 0,
        'standby_links': 0,
        'configured_links': 0,
        'effective_bw_kbps': None,
        'available_bw_kbps': None,
        'min_active_links': 1,
        'members': [],
    }
    if not output:
        return res

    m_stat = re.search(r'Status:\s+(\w+)', output, re.IGNORECASE)
    if m_stat:
        res['status'] = m_stat.group(1).capitalize()

    m_links = re.search(
        r'Local links\s*<active/standby/configured>:\s*(\d+)\s*/\s*(\d+)\s*/\s*(\d+)',
        output,
        re.IGNORECASE,
    )
    if m_links:
        res['active_links'] = int(m_links.group(1))
        res['standby_links'] = int(m_links.group(2))
        res['configured_links'] = int(m_links.group(3))

    m_bw = re.search(
        r'Local bandwidth\s*<effective/available>:\s*(\d+)\s*\(\s*(\d+)\s*\)',
        output,
        re.IGNORECASE,
    )
    if m_bw:
        res['effective_bw_kbps'] = int(m_bw.group(1))
        res['available_bw_kbps'] = int(m_bw.group(2))

    m_min = re.search(r'Minimum active links\s*/\s*bandwidth:\s*(\d+)', output, re.IGNORECASE)
    if m_min:
        res['min_active_links'] = int(m_min.group(1))

    in_table = False
    for line in output.splitlines():
        line_str = line.strip()
        if '---' in line_str and not in_table:
            in_table = True
            continue
        if in_table:
            if not line_str or line_str.startswith('Link is') or line_str.startswith('RP/') or line_str.startswith('LC/'):
                continue
            parts = line_str.split()
            if len(parts) >= 3 and any(parts[0].lower().startswith(p) for p in ('te', 'hu', 'gi', 'fo', 'ge', 'et')):
                port = parts[0]
                device = parts[1] if len(parts) > 1 else 'Local'
                state = parts[2] if len(parts) > 2 else 'Unknown'
                bw = int(parts[-1]) if parts[-1].isdigit() else 0
                res['members'].append({
                    'member_interface': port,
                    'device': device,
                    'lag_state': state,
                    'bw_kbps': bw,
                })

    if not res['configured_links']:
        res['configured_links'] = len(res['members'])
    if not res['active_links']:
        res['active_links'] = sum(1 for m in res['members'] if m.get('lag_state') == 'Active')
    return res


def parse_cisco_etherchannel_summary(output: str, bundle_id: str) -> Dict[str, Any]:
    """
    Parse Cisco IOS-XE / Classic IOS `show etherchannel <id> summary` CLI output.
    Extracts group status, flags, protocol, and member ports with bundle status.
    """
    res: Dict[str, Any] = {
        'status': 'unknown',
        'active_links': 0,
        'down_links': 0,
        'configured_links': 0,
        'protocol': 'unknown',
        'po_name': f'Po{bundle_id}',
        'flags': '',
        'members': [],
    }
    if not output:
        return res

    for line in output.splitlines():
        line_str = line.strip()
        parts = line_str.split()
        if len(parts) >= 2 and parts[0] == str(bundle_id):
            po_part = parts[1]
            m_po = re.search(r'([A-Za-z0-9]+)(?:\(([A-Za-z]+)\))?', po_part)
            if m_po:
                res['po_name'] = m_po.group(1)
                res['flags'] = m_po.group(2) or ''
                if 'U' in res['flags']:
                    res['status'] = 'Up'
                elif 'D' in res['flags']:
                    res['status'] = 'Down'
                else:
                    res['status'] = 'Up' if not res['flags'] else 'Down'

            idx = 2
            if len(parts) > idx and parts[idx] in ('LACP', 'PAgP', '-'):
                res['protocol'] = parts[idx]
                idx += 1

            for port_tok in parts[idx:]:
                m_port = re.search(r'([A-Za-z0-9/]+)(?:\(([A-Za-z]+)\))?', port_tok)
                if m_port:
                    p_name = m_port.group(1)
                    p_flag = m_port.group(2) or ''
                    is_active = ('P' in p_flag)
                    state = 'Active' if is_active else ('Down' if 'D' in p_flag else ('Suspended' if 's' in p_flag else 'Standby'))
                    res['members'].append({
                        'member_interface': p_name,
                        'lag_state': state,
                        'flag': p_flag,
                    })
            break

    res['configured_links'] = len(res['members'])
    res['active_links'] = sum(1 for m in res['members'] if m['lag_state'] == 'Active')
    res['down_links'] = sum(1 for m in res['members'] if m['lag_state'] != 'Active')
    return res


class RouterInterfaceInspector:
    """
    Inspects router interfaces along a traceroute topology in parallel using
    SSH CLI (`show interfaces`, `show controllers phy`) with SNMP v2c fallback.
    """

    def inspect_topology_interfaces(
        self,
        targets: List[Dict[str, Any]],
        measure_delta: bool = True,
        delta_interval_sec: float = 15.0,
    ) -> Dict[str, Any]:
        """
        Inspect all `(ip_loopback, interface)` targets in the topology concurrently.
        Groups interfaces by router `ip_loopback` so each router is queried once in parallel.
        """
        start_ts = time.time()
        if not targets:
            return {
                'elapsed_seconds': 0.0,
                'summary': {
                    'total_checked': 0,
                    'healthy_count': 0,
                    'warning_count': 0,
                    'critical_count': 0,
                    'unreachable_count': 0,
                    'mtu_consistent': True,
                    'min_mtu': None,
                    'max_mtu': None,
                },
                'results': [],
                'by_key': {},
            }

        # Group targets by router loopback
        by_router: Dict[str, List[Dict[str, Any]]] = {}
        for tgt in targets:
            lo = (tgt.get('ip_loopback') or '').strip()
            intf = (tgt.get('interface') or '').strip()
            if lo and intf:
                by_router.setdefault(lo, []).append(tgt)

        router_results_map: Dict[str, Dict[str, Any]] = {}
        max_workers = min(16, max(1, len(by_router)))

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            future_map = {
                pool.submit(
                    self._inspect_single_router,
                    lo,
                    router_targets,
                    measure_delta,
                    delta_interval_sec,
                ): lo
                for lo, router_targets in by_router.items()
            }
            for fut, lo in future_map.items():
                try:
                    res = fut.result(timeout=60)
                    router_results_map.update(res)
                except Exception as e:
                    logger.error(f"INTERFACE_INSPECT_ROUTER_ERROR: lo={lo} err={e}")
                    for t in by_router[lo]:
                        key = f"{lo}:{t['interface']}"
                        router_results_map[key] = self._build_unreachable_result(t, str(e))

        # Assemble ordered results matching input targets
        ordered_results: List[Dict[str, Any]] = []
        for tgt in targets:
            key = f"{tgt.get('ip_loopback')}:{tgt.get('interface')}"
            if key in router_results_map:
                ordered_results.append(router_results_map[key])

        # Perform Path-Wide MTU Consistency Check across all reachable interfaces
        mtus = [
            r['mtu_bytes']
            for r in ordered_results
            if r.get('reachable') and r.get('mtu_bytes') and r['mtu_bytes'] > 0
        ]
        min_mtu = min(mtus) if mtus else None
        max_mtu = max(mtus) if mtus else None
        mtu_consistent = (min_mtu == max_mtu) if (min_mtu and max_mtu) else True

        if not mtu_consistent and min_mtu and max_mtu:
            for r in ordered_results:
                if r.get('reachable') and r.get('mtu_bytes') == min_mtu:
                    r['issues'].append(
                        f"MTU Bottleneck: {min_mtu}B (Path max is {max_mtu}B — risk of silent Jumbo/MPLS drop)"
                    )
                    if r['health_status'] == 'HEALTHY':
                        r['health_status'] = 'WARNING'

        # Compute summary counts
        healthy_count = sum(1 for r in ordered_results if r['health_status'] == 'HEALTHY')
        warning_count = sum(1 for r in ordered_results if r['health_status'] == 'WARNING')
        critical_count = sum(1 for r in ordered_results if r['health_status'] == 'CRITICAL')
        unreachable_count = sum(1 for r in ordered_results if r['health_status'] == 'UNREACHABLE')
        total_bundles = sum(1 for r in ordered_results if r.get('is_bundle'))
        degraded_bundles = sum(
            1 for r in ordered_results
            if r.get('is_bundle') and (r.get('bundle_summary') or {}).get('down_members', 0) > 0
        )

        elapsed = round(time.time() - start_ts, 2)
        return {
            'elapsed_seconds': elapsed,
            'measure_delta': measure_delta,
            'delta_interval_sec': delta_interval_sec if measure_delta else 0,
            'summary': {
                'total_checked': len(ordered_results),
                'healthy_count': healthy_count,
                'warning_count': warning_count,
                'critical_count': critical_count,
                'unreachable_count': unreachable_count,
                'total_bundles': total_bundles,
                'degraded_bundles': degraded_bundles,
                'mtu_consistent': mtu_consistent,
                'min_mtu': min_mtu,
                'max_mtu': max_mtu,
            },
            'results': ordered_results,
            'by_key': {f"{r['ip_loopback']}:{r['interface']}": r for r in ordered_results},
        }

    def _inspect_single_router(
        self,
        loopback_ip: str,
        router_targets: List[Dict[str, Any]],
        measure_delta: bool,
        delta_interval_sec: float,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Inspect all target interfaces on a single router via one SSH session
        (with automatic SNMP v2c fallback if SSH fails).
        Supports deep member-level inspection for Bundle-Ether and Port-channel LAGs.
        """
        results: Dict[str, Dict[str, Any]] = {}
        try:
            with ManagedSSHClient(host=loopback_ip, timeout=8) as ssh:
                ch = ssh.open_interactive_shell()
                try:
                    ch.send("terminal length 0\n")
                    time.sleep(0.35)
                    while ch.recv_ready():
                        ch.recv(65535)

                    # Step 1: Detect which targets are LAG bundles and discover member ports
                    sample_tgt = router_targets[0] if router_targets else {}
                    r_os = detect_router_os(sample_tgt.get('model', ''), sample_tgt.get('hostname', ''))

                    bundle_metadata: Dict[str, Dict[str, Any]] = {}
                    all_member_interfaces: Set[str] = set()

                    for tgt in router_targets:
                        intf_raw = tgt['interface']
                        b_info = parse_bundle_identification(intf_raw)
                        if b_info:
                            parent_id = b_info['bundle_id']
                            members_parsed: List[Dict[str, Any]] = []
                            lag_info: Dict[str, Any] = {}

                            if b_info['bundle_type'] == 'bundle_ether' or r_os == 'ios_xr':
                                raw_bundle = self._run_cli_cmd(
                                    ch, f"show bundle Bundle-Ether {parent_id}", wait_sec=0.8
                                )
                                lag_info = parse_ios_xr_bundle_output(raw_bundle)
                                members_parsed = lag_info.get('members', [])
                            else:
                                raw_bundle = self._run_cli_cmd(
                                    ch, f"show etherchannel {parent_id} summary", wait_sec=0.8
                                )
                                if 'invalid' in raw_bundle.lower():
                                    raw_bundle = self._run_cli_cmd(
                                        ch, "show etherchannel summary", wait_sec=0.8
                                    )
                                lag_info = parse_cisco_etherchannel_summary(raw_bundle, parent_id)
                                members_parsed = lag_info.get('members', [])

                            b_info['lag_info'] = lag_info
                            b_info['discovered_members'] = members_parsed
                            bundle_metadata[intf_raw] = b_info

                            for m in members_parsed:
                                if m.get('member_interface'):
                                    all_member_interfaces.add(self._sanitize_intf(m['member_interface']))

                    # Compile all interfaces to query: targets + discovered physical members
                    interfaces_to_query = list(dict.fromkeys(
                        [self._sanitize_intf(t['interface']) for t in router_targets] + list(all_member_interfaces)
                    ))

                    # Snapshot t0 for all targets AND all member interfaces on this router
                    t0_metrics: Dict[str, Dict[str, Any]] = {}
                    for intf in interfaces_to_query:
                        raw_t0 = self._run_cli_cmd(ch, f"show interfaces {intf}", wait_sec=0.8)
                        t0_metrics[intf] = parse_cisco_interface_output(raw_t0)

                    # Optional 15-second delta snapshot t1
                    t1_metrics: Dict[str, Dict[str, Any]] = {}
                    optical_map: Dict[str, Dict[str, Optional[float]]] = {}

                    if measure_delta and delta_interval_sec > 0:
                        time.sleep(min(delta_interval_sec, 30.0))
                        for intf in interfaces_to_query:
                            raw_t1 = self._run_cli_cmd(ch, f"show interfaces {intf}", wait_sec=0.8)
                            t1_metrics[intf] = parse_cisco_interface_output(raw_t1)
                    else:
                        t1_metrics = t0_metrics

                    # Query Optical Transceiver DOM (Rx/Tx Power dBm) for physical optical ports (including all members)
                    for intf in interfaces_to_query:
                        if not any(
                            intf.lower().startswith(p)
                            for p in ('bundle', 'be', 'lo', 'vl', 'bvi', 'tu', 'pw', 'port-channel', 'po')
                        ):
                            dom_raw = self._run_cli_cmd(
                                ch,
                                f"show controllers {intf} phy",
                                wait_sec=0.6,
                            )
                            opt = parse_optical_dom_output(dom_raw)
                            if opt['rx_power_dbm'] is None:
                                dom_raw2 = self._run_cli_cmd(
                                    ch,
                                    f"show interfaces {intf} transceiver detail",
                                    wait_sec=0.6,
                                )
                                opt = parse_optical_dom_output(dom_raw2)
                            if opt['rx_power_dbm'] is None:
                                m_slot = re.search(r'(\d+/\d+/\d+(?:/\d+)?)', intf)
                                if m_slot:
                                    dom_raw3 = self._run_cli_cmd(
                                        ch,
                                        f"show controllers optic {m_slot.group(1)}",
                                        wait_sec=0.6,
                                    )
                                    opt = parse_optical_dom_output(dom_raw3)
                            optical_map[intf] = opt
                        else:
                            optical_map[intf] = {'tx_power_dbm': None, 'rx_power_dbm': None}

                    # Assemble results for each requested target
                    for tgt in router_targets:
                        intf_raw = tgt['interface']
                        intf = self._sanitize_intf(intf_raw)
                        m0 = t0_metrics.get(intf, {})
                        m1 = t1_metrics.get(intf, m0)
                        opt = optical_map.get(intf, {'tx_power_dbm': None, 'rx_power_dbm': None})

                        b_info = bundle_metadata.get(intf_raw)
                        evaluated_members: List[Dict[str, Any]] = []

                        if b_info:
                            for m_meta in b_info.get('discovered_members', []):
                                m_name = self._sanitize_intf(m_meta['member_interface'])
                                m_m0 = t0_metrics.get(m_name, {})
                                m_m1 = t1_metrics.get(m_name, m_m0)
                                m_opt = optical_map.get(m_name, {'tx_power_dbm': None, 'rx_power_dbm': None})

                                evaluated_member = self._evaluate_member_health(
                                    m_meta, m_m0, m_m1, m_opt
                                )
                                evaluated_members.append(evaluated_member)

                        key = f"{loopback_ip}:{intf_raw}"
                        results[key] = self._evaluate_health(
                            tgt,
                            m0,
                            m1,
                            opt,
                            collection_method='SSH_CLI',
                            bundle_info=b_info,
                            members=evaluated_members,
                        )
                    return results
                finally:
                    try:
                        ch.close()
                    except Exception:
                        pass
        except Exception as ssh_err:
            logger.info(
                f"INTERFACE_INSPECT_SSH_FALLBACK_TO_SNMP: host={loopback_ip} reason={ssh_err}"
            )
            # Fallback to SNMP v2c IF-MIB query
            try:
                snmp_res = asyncio.run(
                    self._async_snmp_inspect_router(
                        loopback_ip,
                        router_targets,
                        measure_delta,
                        delta_interval_sec,
                    )
                )
                if snmp_res:
                    return snmp_res
            except Exception as snmp_err:
                logger.warning(
                    f"INTERFACE_INSPECT_SNMP_FALLBACK_FAILED: host={loopback_ip} err={snmp_err}"
                )

            for tgt in router_targets:
                key = f"{loopback_ip}:{tgt['interface']}"
                results[key] = self._build_unreachable_result(tgt, str(ssh_err))
            return results

    def _run_cli_cmd(self, ch, cmd: str, wait_sec: float = 0.8) -> str:
        """Send a single CLI command over an open Paramiko channel and collect output."""
        while ch.recv_ready():
            ch.recv(65535)
        ch.send(cmd + "\n")
        time.sleep(wait_sec)
        buf = ""
        deadline = time.time() + 3.0
        while time.time() < deadline:
            while ch.recv_ready():
                buf += ch.recv(65535).decode('utf-8', errors='ignore')
            if buf.strip().endswith('#') or buf.strip().endswith('>'):
                break
            time.sleep(0.15)
        return buf

    @staticmethod
    def _sanitize_intf(intf: str) -> str:
        return re.sub(r'[^A-Za-z0-9/\.\-_:]', '', (intf or '').strip())

    async def _async_snmp_inspect_router(
        self,
        host: str,
        router_targets: List[Dict[str, Any]],
        measure_delta: bool,
        delta_interval_sec: float,
    ) -> Dict[str, Dict[str, Any]]:
        """SNMP v2c IF-MIB fallback when SSH is unavailable on a router."""
        community = get_setting('SNMP_COMMUNITY', 'tpk-snmp')
        snmp_engine = SnmpEngine()
        auth_data = CommunityData(community, mpModel=1)
        transport = UdpTransportTarget((host, 161), timeout=2, retries=1)

        # Walk ifDescr (1.3.6.1.2.1.2.2.1.2) and ifName (1.3.6.1.2.1.31.1.1.1.1) to map interface -> ifIndex
        if_name_to_idx: Dict[str, str] = {}
        try:
            for base_oid in ('1.3.6.1.2.1.31.1.1.1.1', '1.3.6.1.2.1.2.2.1.2'):
                current_oid = ObjectIdentity(base_oid)
                for _ in range(250):
                    err_ind, err_stat, _, vb_table = await nextCmd(
                        snmp_engine,
                        auth_data,
                        transport,
                        ContextData(),
                        ObjectType(current_oid),
                        lookupMib=False,
                    )
                    if err_ind or err_stat or not vb_table or not vb_table[0]:
                        break
                    vb = vb_table[0][0]
                    oid_str = str(vb[0])
                    if not oid_str.startswith(base_oid + '.'):
                        break
                    if_idx = oid_str.split('.')[-1]
                    if_name = vb[1].prettyPrint().strip()
                    if if_name:
                        if_name_to_idx[if_name.lower()] = if_idx
                    current_oid = ObjectIdentity(oid_str)
        except Exception:
            pass

        if not if_name_to_idx:
            return {}

        async def query_if_snapshot(if_idx: str) -> Dict[str, Any]:
            oids = [
                f"1.3.6.1.2.1.2.2.1.7.{if_idx}",    # ifAdminStatus
                f"1.3.6.1.2.1.2.2.1.8.{if_idx}",    # ifOperStatus
                f"1.3.6.1.2.1.2.2.1.4.{if_idx}",    # ifMtu
                f"1.3.6.1.2.1.31.1.1.1.15.{if_idx}", # ifHighSpeed (Mbps)
                f"1.3.6.1.2.1.2.2.1.14.{if_idx}",   # ifInErrors
                f"1.3.6.1.2.1.2.2.1.20.{if_idx}",   # ifOutErrors
                f"1.3.6.1.2.1.2.2.1.13.{if_idx}",   # ifInDiscards
                f"1.3.6.1.2.1.2.2.1.19.{if_idx}",   # ifOutDiscards
                f"1.3.6.1.2.1.31.1.1.1.6.{if_idx}",  # ifHCInOctets
                f"1.3.6.1.2.1.31.1.1.1.10.{if_idx}", # ifHCOutOctets
            ]
            err_ind, err_stat, _, vbs = await getCmd(
                snmp_engine,
                auth_data,
                transport,
                ContextData(),
                *[ObjectType(ObjectIdentity(o)) for o in oids],
                lookupMib=False,
            )
            if err_ind or err_stat or not vbs:
                return {}
            vals = [self._safe_int(vb[1].prettyPrint()) for vb in vbs]
            admin_map = {1: 'up', 2: 'down', 3: 'testing'}
            oper_map = {1: 'up', 2: 'down', 3: 'testing', 4: 'unknown', 5: 'dormant'}
            return {
                'admin_status': admin_map.get(vals[0], 'unknown'),
                'oper_status': oper_map.get(vals[1], 'unknown'),
                'mtu_bytes': vals[2] or None,
                'bw_kbps': (vals[3] * 1000) if vals[3] else None,
                'in_errors': vals[4],
                'out_errors': vals[5],
                'crc_errors': 0,
                'frame_errors': 0,
                'runts': 0,
                'giants': 0,
                'in_drops': vals[6],
                'out_drops': vals[7],
                'in_octets': vals[8],
                'out_octets': vals[9],
                'rx_bps': 0,
                'tx_bps': 0,
                'rx_pps': 0,
                'tx_pps': 0,
                'rx_mbps': 0.0,
                'tx_mbps': 0.0,
                'rx_load_pct': 0.0,
                'tx_load_pct': 0.0,
                'carrier_transitions': 0,
                'last_flapped': '',
            }

        results: Dict[str, Dict[str, Any]] = {}
        t0_snaps: Dict[str, Dict[str, Any]] = {}
        matched_indices: Dict[str, str] = {}

        for tgt in router_targets:
            intf_raw = (tgt.get('interface') or '').strip()
            if_idx = if_name_to_idx.get(intf_raw.lower())
            if if_idx:
                matched_indices[intf_raw] = if_idx
                t0_snaps[intf_raw] = await query_if_snapshot(if_idx)

        if not matched_indices:
            return {}

        t1_snaps = dict(t0_snaps)
        if measure_delta and delta_interval_sec > 0:
            await asyncio.sleep(min(delta_interval_sec, 30.0))
            for intf_raw, if_idx in matched_indices.items():
                s1 = await query_if_snapshot(if_idx)
                s0 = t0_snaps.get(intf_raw, {})
                if s0 and s1 and delta_interval_sec > 0:
                    d_in_oct = max(0, s1.get('in_octets', 0) - s0.get('in_octets', 0))
                    d_out_oct = max(0, s1.get('out_octets', 0) - s0.get('out_octets', 0))
                    s1['rx_bps'] = int((d_in_oct * 8) / delta_interval_sec)
                    s1['tx_bps'] = int((d_out_oct * 8) / delta_interval_sec)
                    s1['rx_mbps'] = round(s1['rx_bps'] / 1_000_000.0, 2)
                    s1['tx_mbps'] = round(s1['tx_bps'] / 1_000_000.0, 2)
                    if s1.get('bw_kbps'):
                        bw_bps = s1['bw_kbps'] * 1000.0
                        s1['rx_load_pct'] = round(min(100.0, (s1['rx_bps'] / bw_bps) * 100.0), 2)
                        s1['tx_load_pct'] = round(min(100.0, (s1['tx_bps'] / bw_bps) * 100.0), 2)
                t1_snaps[intf_raw] = s1

        for tgt in router_targets:
            intf_raw = (tgt.get('interface') or '').strip()
            key = f"{host}:{intf_raw}"
            if intf_raw in t0_snaps and t0_snaps[intf_raw]:
                results[key] = self._evaluate_health(
                    tgt,
                    t0_snaps[intf_raw],
                    t1_snaps.get(intf_raw, t0_snaps[intf_raw]),
                    {'tx_power_dbm': None, 'rx_power_dbm': None},
                    collection_method='SNMP_V2C',
                )
            else:
                results[key] = self._build_unreachable_result(tgt, "Interface not found in SNMP IF-MIB")

        return results

    @staticmethod
    def _safe_int(val: Any) -> int:
        try:
            return int(str(val).strip())
        except (ValueError, TypeError):
            return 0

    def _evaluate_member_health(
        self,
        m_meta: Dict[str, Any],
        m0: Dict[str, Any],
        m1: Dict[str, Any],
        optical: Dict[str, Optional[float]],
    ) -> Dict[str, Any]:
        """
        Evaluate individual physical member link health within a LAG bundle.
        """
        member_name = m_meta.get('member_interface', '')
        lag_state = m_meta.get('lag_state', 'Unknown')
        oper_status = m1.get('oper_status', 'unknown')
        admin_status = m1.get('admin_status', 'unknown')

        delta_crc = max(0, m1.get('crc_errors', 0) - m0.get('crc_errors', 0))
        delta_in_err = max(0, m1.get('in_errors', 0) - m0.get('in_errors', 0))
        delta_out_err = max(0, m1.get('out_errors', 0) - m0.get('out_errors', 0))
        delta_in_drops = max(0, m1.get('in_drops', 0) - m0.get('in_drops', 0))
        delta_out_drops = max(0, m1.get('out_drops', 0) - m0.get('out_drops', 0))

        rx_dbm = optical.get('rx_power_dbm')
        tx_dbm = optical.get('tx_power_dbm')

        member_status = 'HEALTHY'
        member_issues: List[str] = []

        if oper_status == 'down' or lag_state.lower() in ('down', 'suspended'):
            member_status = 'CRITICAL'
            member_issues.append(f"Member is DOWN in LAG (State: {lag_state}, Line: {oper_status})")
        elif lag_state.lower() == 'standby':
            member_status = 'WARNING'
            member_issues.append("Member is in Standby mode")

        if delta_crc > 0 or delta_in_err > 0 or delta_out_err > 0:
            member_status = 'CRITICAL'
            member_issues.append(f"Active Packet Loss: ΔCRC=+{delta_crc}, ΔInErr=+{delta_in_err}")

        if delta_in_drops > 0 or delta_out_drops > 0:
            member_status = 'CRITICAL'
            member_issues.append(f"Active Queue Drops: ΔInDrops=+{delta_in_drops}")

        if rx_dbm is not None:
            if rx_dbm <= -22.0:
                member_status = 'CRITICAL'
                member_issues.append(f"Optical Rx Power Critical: {rx_dbm} dBm")
            elif rx_dbm <= -18.0:
                if member_status == 'HEALTHY':
                    member_status = 'WARNING'
                member_issues.append(f"Optical Rx Power Degraded: {rx_dbm} dBm")

        speed_mbps = ((m1.get('bw_kbps') or m_meta.get('bw_kbps') or 0) // 1000)
        return {
            'member_interface': member_name,
            'interface': member_name,
            'lag_state': lag_state,
            'bundle_status': lag_state,
            'admin_status': admin_status,
            'oper_status': oper_status,
            'health_status': member_status,
            'health_level': member_status,
            'bw_kbps': m1.get('bw_kbps') or m_meta.get('bw_kbps'),
            'speed_mbps': speed_mbps,
            'rx_mbps': m1.get('rx_mbps', 0.0),
            'tx_mbps': m1.get('tx_mbps', 0.0),
            'rx_load_pct': m1.get('rx_load_pct', 0.0),
            'tx_load_pct': m1.get('tx_load_pct', 0.0),
            'in_errors': m1.get('in_errors', 0),
            'out_errors': m1.get('out_errors', 0),
            'crc_errors': m1.get('crc_errors', 0),
            'in_drops': m1.get('in_drops', 0),
            'out_drops': m1.get('out_drops', 0),
            'delta_crc': delta_crc,
            'delta_in_errors': delta_in_err,
            'delta_out_errors': delta_out_err,
            'delta_in_drops': delta_in_drops,
            'delta_out_drops': delta_out_drops,
            'rx_power_dbm': rx_dbm,
            'tx_power_dbm': tx_dbm,
            'issues': member_issues,
        }

    def _evaluate_health(
        self,
        tgt: Dict[str, Any],
        m0: Dict[str, Any],
        m1: Dict[str, Any],
        optical: Dict[str, Optional[float]],
        collection_method: str,
        bundle_info: Optional[Dict[str, Any]] = None,
        members: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Evaluate the 6 Traffic Loss diagnostic dimensions and assign a Health Verdict:
        `HEALTHY` | `WARNING` | `CRITICAL`.
        Integrates member-level LAG health and capacity evaluation.
        """
        members = members or []
        delta_crc = max(0, m1.get('crc_errors', 0) - m0.get('crc_errors', 0))
        delta_in_err = max(0, m1.get('in_errors', 0) - m0.get('in_errors', 0))
        delta_out_err = max(0, m1.get('out_errors', 0) - m0.get('out_errors', 0))
        delta_in_drops = max(0, m1.get('in_drops', 0) - m0.get('in_drops', 0))
        delta_out_drops = max(0, m1.get('out_drops', 0) - m0.get('out_drops', 0))

        issues: List[str] = []
        status = 'HEALTHY'

        oper_status = m1.get('oper_status', 'unknown')
        admin_status = m1.get('admin_status', 'unknown')
        rx_load = m1.get('rx_load_pct', 0.0)
        tx_load = m1.get('tx_load_pct', 0.0)
        max_load = max(rx_load, tx_load)
        rx_dbm = optical.get('rx_power_dbm')
        tx_dbm = optical.get('tx_power_dbm')

        # Check bundle summary and capacity degradation
        is_bundle = bool(bundle_info and bundle_info.get('is_bundle'))
        bundle_summary = None

        if is_bundle:
            total_members = len(members)
            active_members = sum(1 for m in members if m.get('lag_state') == 'Active' and m.get('oper_status') == 'up')
            down_members = sum(1 for m in members if m.get('lag_state') != 'Active' or m.get('oper_status') != 'up')
            standby_members = sum(1 for m in members if m.get('lag_state') == 'Standby')
            capacity_loss_pct = round((down_members / total_members) * 100.0, 1) if total_members > 0 else 0.0

            lag_info = bundle_info.get('lag_info', {})
            min_links = lag_info.get('min_active_links', 1)
            min_links_met = active_members >= min_links

            effective_bw = sum((m.get('bw_kbps') or 0) for m in members if m.get('lag_state') == 'Active' and m.get('oper_status') == 'up')
            total_bw = sum((m.get('bw_kbps') or 0) for m in members)
            if not effective_bw and m1.get('bw_kbps'):
                effective_bw = m1.get('bw_kbps')

            is_degraded = (down_members > 0 or capacity_loss_pct > 0 or not min_links_met)
            bundle_summary = {
                'bundle_type': bundle_info.get('bundle_type', 'bundle_ether'),
                'parent_interface': bundle_info.get('parent_interface', ''),
                'sub_interface': bundle_info.get('sub_interface'),
                'total_members': total_members,
                'active_members': active_members,
                'down_members': down_members,
                'standby_members': standby_members,
                'capacity_loss_pct': capacity_loss_pct,
                'min_active_links': min_links,
                'min_links_met': min_links_met,
                'total_bw_kbps': total_bw or m1.get('bw_kbps'),
                'effective_bw_kbps': effective_bw,
                'degraded': is_degraded,
                'active_links': active_members,
                'total_links': total_members,
                'bundle_bw_mbps': (effective_bw or 0) // 1000,
            }

            # Capacity evaluation
            if total_members > 0:
                if not min_links_met or active_members == 0:
                    status = 'CRITICAL'
                    issues.insert(0, f"LAG BUNDLE FAILURE: Only {active_members}/{total_members} links active. Minimum required is {min_links}.")
                elif down_members > 0:
                    down_names = [m['member_interface'] for m in members if m.get('lag_state') != 'Active' or m.get('oper_status') != 'up']
                    loss_msg = f"LAG Capacity Degraded: {active_members}/{total_members} member links active ({capacity_loss_pct}% capacity loss) — Member(s) {', '.join(down_names)} DOWN"
                    issues.insert(0, loss_msg)
                    if capacity_loss_pct >= 50.0:
                        status = 'CRITICAL'
                    elif status == 'HEALTHY':
                        status = 'WARNING'

            # Roll up member active errors or optical degradation
            for m in members:
                if m.get('delta_crc', 0) > 0:
                    status = 'CRITICAL'
                    issues.append(f"Active CRC Errors on Member {m['member_interface']}: +{m['delta_crc']}")
                if m.get('delta_in_drops', 0) > 0:
                    status = 'CRITICAL'
                    issues.append(f"Active Queue Drops on Member {m['member_interface']}: +{m['delta_in_drops']}")
                if m.get('rx_power_dbm') is not None:
                    if m['rx_power_dbm'] <= -22.0:
                        status = 'CRITICAL'
                        issues.append(f"Critical Optical Rx Power on Member {m['member_interface']}: {m['rx_power_dbm']} dBm")
                    elif m['rx_power_dbm'] <= -18.0 and status == 'HEALTHY':
                        status = 'WARNING'
                        issues.append(f"Degraded Optical Rx Power on Member {m['member_interface']}: {m['rx_power_dbm']} dBm")

            # Roll up worst optical power so bundle is not null
            valid_rx = [m['rx_power_dbm'] for m in members if m.get('rx_power_dbm') is not None]
            valid_tx = [m['tx_power_dbm'] for m in members if m.get('tx_power_dbm') is not None]
            if valid_rx and rx_dbm is None:
                rx_dbm = min(valid_rx)
            if valid_tx and tx_dbm is None:
                tx_dbm = min(valid_tx)

        # 1. Operational State check
        if oper_status == 'down':
            status = 'CRITICAL'
            issues.append(f"Interface Line Protocol is DOWN (Admin: {admin_status})")

        # 2. Real-Time Active Delta Loss check (Δ > 0 over interval)
        if delta_crc > 0 or delta_in_err > 0 or delta_out_err > 0:
            status = 'CRITICAL'
            issues.append(
                f"ACTIVE PHYSICAL ERRORS: ΔCRC=+{delta_crc}, ΔInErr=+{delta_in_err}, ΔOutErr=+{delta_out_err} (Active Packet Corruption)"
            )
        if delta_in_drops > 0 or delta_out_drops > 0:
            status = 'CRITICAL'
            issues.append(
                f"ACTIVE QUEUE DROPS: ΔInDrops=+{delta_in_drops}, ΔOutDrops=+{delta_out_drops} (Active Congestion Loss)"
            )

        # 3. Traffic Utilization / Bandwidth Saturation check
        if max_load >= 90.0:
            status = 'CRITICAL'
            issues.append(f"Bandwidth Saturation: Peak Load {max_load}% (Rx {rx_load}% / Tx {tx_load}%)")
        elif max_load >= 75.0:
            if status == 'HEALTHY':
                status = 'WARNING'
            issues.append(f"High Traffic Utilization: {max_load}% (Rx {rx_load}% / Tx {tx_load}%)")

        # 4. Optical Transceiver Power (DOM/DDM) check
        if rx_dbm is not None:
            if rx_dbm <= -22.0:
                status = 'CRITICAL'
                issues.append(f"Optical Rx Power Critically Low: {rx_dbm} dBm (Fiber attenuation / dirty connector)")
            elif rx_dbm <= -18.0:
                if status == 'HEALTHY':
                    status = 'WARNING'
                issues.append(f"Optical Rx Power Degraded: {rx_dbm} dBm (Approaching threshold)")

        # 5. Historical Errors / Drops (when Δ == 0)
        total_hist_err = m1.get('crc_errors', 0) + m1.get('in_errors', 0) + m1.get('out_errors', 0)
        total_hist_drops = m1.get('in_drops', 0) + m1.get('out_drops', 0)
        if total_hist_err > 0 and (delta_crc == 0 and delta_in_err == 0 and delta_out_err == 0):
            if status == 'HEALTHY':
                status = 'WARNING'
            issues.append(
                f"Historical Physical Errors: CRC={m1.get('crc_errors', 0)}, InErr={m1.get('in_errors', 0)} (Currently Stable, Δ=0)"
            )
        if total_hist_drops > 0 and (delta_in_drops == 0 and delta_out_drops == 0):
            if status == 'HEALTHY':
                status = 'WARNING'
            issues.append(
                f"Historical Queue Drops: InDrops={m1.get('in_drops', 0)}, OutDrops={m1.get('out_drops', 0)} (Currently Stable, Δ=0)"
            )

        return {
            'ip_loopback': tgt.get('ip_loopback'),
            'hostname': tgt.get('hostname') or tgt.get('ip_loopback'),
            'model': tgt.get('model') or '',
            'area': tgt.get('area') or '',
            'interface': tgt.get('interface'),
            'ip_address': tgt.get('ip_address') or '',
            'role': tgt.get('role') or '',
            'direction': tgt.get('direction') or 'general',
            'link_index': tgt.get('link_index'),
            'circuit': tgt.get('circuit') or '',
            'reachable': True,
            'collection_method': collection_method,
            'health_status': status,
            'is_active_loss': (delta_crc + delta_in_err + delta_out_err + delta_in_drops + delta_out_drops) > 0,
            'issues': issues,
            'admin_status': admin_status,
            'oper_status': oper_status,
            'mtu_bytes': m1.get('mtu_bytes'),
            'bw_kbps': m1.get('bw_kbps'),
            'rx_mbps': m1.get('rx_mbps', 0.0),
            'tx_mbps': m1.get('tx_mbps', 0.0),
            'rx_pps': m1.get('rx_pps', 0),
            'tx_pps': m1.get('tx_pps', 0),
            'rx_load_pct': rx_load,
            'tx_load_pct': tx_load,
            'in_errors': m1.get('in_errors', 0),
            'out_errors': m1.get('out_errors', 0),
            'crc_errors': m1.get('crc_errors', 0),
            'frame_errors': m1.get('frame_errors', 0),
            'runts': m1.get('runts', 0),
            'giants': m1.get('giants', 0),
            'in_drops': m1.get('in_drops', 0),
            'out_drops': m1.get('out_drops', 0),
            'delta_crc': delta_crc,
            'delta_in_errors': delta_in_err,
            'delta_out_errors': delta_out_err,
            'delta_in_drops': delta_in_drops,
            'delta_out_drops': delta_out_drops,
            'carrier_transitions': m1.get('carrier_transitions', 0),
            'last_flapped': m1.get('last_flapped', ''),
            'tx_power_dbm': tx_dbm,
            'rx_power_dbm': rx_dbm,
            'is_bundle': is_bundle,
            'bundle_summary': bundle_summary,
            'members': members,
        }

    @staticmethod
    def _build_unreachable_result(tgt: Dict[str, Any], error_msg: str) -> Dict[str, Any]:
        return {
            'ip_loopback': tgt.get('ip_loopback'),
            'hostname': tgt.get('hostname') or tgt.get('ip_loopback'),
            'model': tgt.get('model') or '',
            'area': tgt.get('area') or '',
            'interface': tgt.get('interface'),
            'ip_address': tgt.get('ip_address') or '',
            'role': tgt.get('role') or '',
            'direction': tgt.get('direction') or 'general',
            'link_index': tgt.get('link_index'),
            'circuit': tgt.get('circuit') or '',
            'reachable': False,
            'collection_method': 'NONE',
            'health_status': 'UNREACHABLE',
            'is_active_loss': False,
            'issues': [f"Device unreachable via SSH/SNMP: {error_msg}"],
            'admin_status': 'unknown',
            'oper_status': 'unknown',
            'mtu_bytes': None,
            'bw_kbps': None,
            'rx_mbps': 0.0,
            'tx_mbps': 0.0,
            'rx_pps': 0,
            'tx_pps': 0,
            'rx_load_pct': 0.0,
            'tx_load_pct': 0.0,
            'in_errors': 0,
            'out_errors': 0,
            'crc_errors': 0,
            'frame_errors': 0,
            'runts': 0,
            'giants': 0,
            'in_drops': 0,
            'out_drops': 0,
            'delta_crc': 0,
            'delta_in_errors': 0,
            'delta_out_errors': 0,
            'delta_in_drops': 0,
            'delta_out_drops': 0,
            'carrier_transitions': 0,
            'last_flapped': '',
            'tx_power_dbm': None,
            'rx_power_dbm': None,
            'is_bundle': False,
            'bundle_summary': None,
            'members': [],
        }


router_interface_inspector = RouterInterfaceInspector()
