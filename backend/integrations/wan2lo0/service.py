"""
Wan2Loopback Service (v3.1 + EventAnalyzer Incident Correlation).
Translates WAN IP hops from traceroute into full Router Loopback0 topology,
calculates /30 and /31 peer interfaces, builds Mermaid diagrams, and correlates
devices/circuits with active EventAnalyzer incidents.
"""
import logging
import os
import re
import struct
import socket
import time
from typing import Any, Dict, List, Optional, Tuple

import pymysql
from pymysql.cursors import DictCursor

from incidents.models import Incident, IncidentStatus

logger = logging.getLogger(__name__)

IP_REGEX = re.compile(r'([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})')
RTT_REGEX = re.compile(r'([0-9]+(?:\.[0-9]+)?)\s*ms', re.IGNORECASE)


def filter_ip(raw_line: str) -> Optional[str]:
    """Extract the first valid IPv4 address from a line of text."""
    if not raw_line:
        return None
    match = IP_REGEX.search(raw_line)
    if not match:
        return None
    candidate = match.group(1).strip()
    parts = candidate.split('.')
    if len(parts) == 4 and all(0 <= int(p) <= 255 for p in parts):
        return candidate
    return None


def extract_rtt_ms(raw_line: str) -> Optional[float]:
    """Extract average or minimum RTT (ms) from a traceroute hop line if present."""
    if not raw_line:
        return None
    matches = RTT_REGEX.findall(raw_line)
    if not matches:
        return None
    try:
        vals = [float(x) for x in matches]
        return round(sum(vals) / len(vals), 2)
    except (ValueError, ZeroDivisionError):
        return None


def ip_to_long(ip_str: str) -> Optional[int]:
    """Convert IPv4 string to 32-bit unsigned integer."""
    try:
        return struct.unpack("!I", socket.inet_aton(ip_str))[0]
    except OSError:
        return None


def long_to_ip(ip_long: int) -> str:
    """Convert 32-bit unsigned integer to IPv4 string."""
    return socket.inet_ntoa(struct.pack("!I", ip_long & 0xFFFFFFFF))


def get_peer_ip(ip_str: str, netmask: str) -> Optional[str]:
    """
    Calculate the point-to-point peer IP in a /30 (255.255.255.252)
    or /31 (255.255.255.254, RFC 3021) subnet.
    """
    if not ip_str or not netmask:
        return None
    netmask = netmask.strip()
    ip_long = ip_to_long(ip_str.strip())
    mask_long = ip_to_long(netmask)
    if ip_long is None or mask_long is None:
        return None

    net_long = ip_long & mask_long
    if netmask == '255.255.255.252':  # /30
        ip1 = net_long + 1
        ip2 = net_long + 2
        if ip_long == ip1:
            return long_to_ip(ip2)
        if ip_long == ip2:
            return long_to_ip(ip1)
    elif netmask == '255.255.255.254':  # /31
        ip1 = net_long
        ip2 = net_long + 1
        return long_to_ip(ip2) if ip_long == ip1 else long_to_ip(ip1)
    return None


def clean_mermaid_str(text: Optional[str]) -> str:
    """Sanitize string for safe embedding in Mermaid node/edge labels."""
    if not text:
        return ''
    cleaned = re.sub(r'["\'\[\]\(\)\{\}<>]', ' ', str(text))
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned.strip()


def shorten_intf(intf: Optional[str]) -> str:
    """Shorten Cisco interface names for compact diagram rendering."""
    if not intf:
        return ''
    s = str(intf).strip()
    s = re.sub(r'^HundredGigE', 'Hu', s, flags=re.IGNORECASE)
    s = re.sub(r'^TenGigabitEthernet', 'Te', s, flags=re.IGNORECASE)
    s = re.sub(r'^TenGigE', 'Te', s, flags=re.IGNORECASE)
    s = re.sub(r'^GigabitEthernet', 'Gi', s, flags=re.IGNORECASE)
    s = re.sub(r'^FastEthernet', 'Fa', s, flags=re.IGNORECASE)
    s = re.sub(r'^Ethernet', 'Eth', s, flags=re.IGNORECASE)
    return s


def extract_circuit_id(desc: Optional[str]) -> str:
    """Extract CAT ID / Circuit ID / Bundle identifier from interface description."""
    if not desc:
        return ''
    s = str(desc)
    m = re.search(r'(TBB[0-9A-Z]+)', s, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    m = re.search(r'(BE[0-9]+|BUNDLE-?ETHER[0-9]+|BUNDLE[0-9]+)', s, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r'(BUNDLE\s+[^\s,:]+)', s, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r'\b([0-9]{8,12})\b', s)
    if m:
        return m.group(1)
    m = re.search(r'([A-Z0-9_\-]{6,})', s, re.IGNORECASE)
    if m:
        return m.group(1)[:16]
    return ''


class Wan2LoopbackService:
    """
    Service to query the `information` MySQL database (`ipwan` & `nodeinfo`),
    reconstruct network hop topologies, and correlate with active incidents.
    """

    def __init__(self):
        self.unix_socket = os.environ.get('WAN_DB_SOCKET', '/var/lib/mysql/mysql.sock')
        self.db_host = os.environ.get('WAN_DB_HOST', '127.0.0.1')
        self.db_port = int(os.environ.get('WAN_DB_PORT', '3306'))
        self.db_user = os.environ.get('WAN_DB_USER', 'root')
        self.db_password = os.environ.get('WAN_DB_PASSWORD', 'ait@1761')
        self.db_name = os.environ.get('WAN_DB_NAME', 'information')

    def _get_connection(self):
        """Return a Read-Only MySQL connection via Unix socket (or TCP fallback)."""
        if os.path.exists(self.unix_socket):
            return pymysql.connect(
                unix_socket=self.unix_socket,
                user=self.db_user,
                password=self.db_password,
                database=self.db_name,
                charset='utf8mb4',
                cursorclass=DictCursor,
                connect_timeout=5,
                read_timeout=10,
            )
        return pymysql.connect(
            host=self.db_host,
            port=self.db_port,
            user=self.db_user,
            password=self.db_password,
            database=self.db_name,
            charset='utf8mb4',
            cursorclass=DictCursor,
            connect_timeout=5,
            read_timeout=10,
        )

    def search_nodes(self, query: str = '', limit: int = 50) -> List[Dict[str, Any]]:
        """
        Search router nodes from `nodeinfo` table by hostname, ip_nms (Loopback0), model, or location.
        Used for the Live Router-to-Router Traceroute selector.
        """
        from devices.province_mapping import resolve_province

        q = (query or '').strip()
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cur:
                    if q:
                        like_q = f"%{q}%"
                        sql = """
                            SELECT
                                TRIM(ip_nms) AS ip_nms,
                                TRIM(hostname) AS hostname,
                                TRIM(model) AS model,
                                TRIM(COALESCE(location, '')) AS location
                            FROM nodeinfo
                            WHERE ip_nms LIKE %s
                               OR hostname LIKE %s
                               OR model LIKE %s
                               OR location LIKE %s
                            ORDER BY
                                CASE WHEN hostname LIKE %s THEN 0
                                     WHEN ip_nms LIKE %s THEN 1
                                     ELSE 2 END,
                                hostname ASC
                            LIMIT %s
                        """
                        cur.execute(
                            sql,
                            (like_q, like_q, like_q, like_q, f"{q}%", f"{q}%", int(limit)),
                        )
                    else:
                        sql = """
                            SELECT
                                TRIM(ip_nms) AS ip_nms,
                                TRIM(hostname) AS hostname,
                                TRIM(model) AS model,
                                TRIM(COALESCE(location, '')) AS location
                            FROM nodeinfo
                            WHERE ip_nms != '' AND hostname != ''
                            ORDER BY hostname ASC
                            LIMIT %s
                        """
                        cur.execute(sql, (int(limit),))
                    rows = list(cur.fetchall())
                    for r in rows:
                        prov_code, prov_name = resolve_province(r.get('hostname') or '')
                        r['area'] = prov_name or prov_code or ''
                    return rows
        except Exception as e:
            logger.error(f"WAN2LO0_NODE_SEARCH_ERROR: {e}")
            return []

    def analyze_paths(
        self,
        mode: str = 'general',
        ipaddr: str = '',
        ipaddr_fwd: str = '',
        ipaddr_ret: str = '',
        auto_peer: bool = True,
    ) -> Dict[str, Any]:
        """
        Core topology analysis method:
        1. Parse IPs and RTT latencies from Forward / Return / General input.
        2. Query `ipwan` for matching WAN interfaces and auto-calculated /30 or /31 peers.
        3. Disambiguate duplicate IPs using confirmed Loopback0 context.
        4. Enrich router Loopback0s with `nodeinfo` (hostname, model, area).
        5. Reconstruct hop-by-hop P2P links and standalone cloud links.
        6. Cross-check routers & circuits against active EventAnalyzer incidents.
        7. Generate Mermaid flowchart syntax + interactive `js_edges` metadata.
        """
        start_time = time.time()

        fwd_hops: List[str] = []
        ret_hops: List[str] = []
        gen_hops: List[str] = []
        ip_directions: Dict[str, str] = {}
        ip_rtt_ms: Dict[str, float] = {}

        effective_mode = (mode or 'general').strip().lower()
        input_gen = (ipaddr or '').strip()
        input_fwd = (ipaddr_fwd or '').strip()
        input_ret = (ipaddr_ret or '').strip()

        if effective_mode == 'asymmetric' or input_fwd or input_ret:
            effective_mode = 'asymmetric'
            for line in input_fwd.splitlines():
                ip = filter_ip(line)
                if ip:
                    fwd_hops.append(ip)
                    ip_directions[ip] = 'forward'
                    rtt = extract_rtt_ms(line)
                    if rtt is not None:
                        ip_rtt_ms[ip] = rtt
            for line in input_ret.splitlines():
                ip = filter_ip(line)
                if ip:
                    ret_hops.append(ip)
                    if ip_directions.get(ip) == 'forward':
                        ip_directions[ip] = 'both'
                    else:
                        ip_directions[ip] = 'return'
                    rtt = extract_rtt_ms(line)
                    if rtt is not None and ip not in ip_rtt_ms:
                        ip_rtt_ms[ip] = rtt
        else:
            current_tag = 'general'
            has_tags = False
            for line in input_gen.splitlines():
                trim_upper = line.strip().upper()
                if any(t in trim_upper for t in ('#FORWARD', '[FORWARD]', '#FORWORD')):
                    current_tag = 'forward'
                    has_tags = True
                    continue
                if any(t in trim_upper for t in ('#RETURN', '[RETURN]', '#RETRUN')):
                    current_tag = 'return'
                    has_tags = True
                    continue

                ip = filter_ip(line)
                if ip:
                    if current_tag == 'forward':
                        fwd_hops.append(ip)
                    elif current_tag == 'return':
                        ret_hops.append(ip)
                    else:
                        gen_hops.append(ip)

                    if ip in ip_directions and ip_directions[ip] != current_tag and current_tag != 'general':
                        ip_directions[ip] = 'both'
                    else:
                        ip_directions[ip] = current_tag

                    rtt = extract_rtt_ms(line)
                    if rtt is not None:
                        ip_rtt_ms[ip] = rtt

            if has_tags:
                effective_mode = 'asymmetric'

        # Preserve unique order of all input IPs
        all_input_ips: List[str] = []
        for ip in fwd_hops + ret_hops + gen_hops:
            if ip not in all_input_ips:
                all_input_ips.append(ip)

        records: Dict[str, Dict[str, Any]] = {}
        not_found_ips: List[str] = []

        if all_input_ips:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cur:
                    # 1. Fetch initial IPs from ipwan
                    placeholders = ','.join(['%s'] * len(all_input_ips))
                    sql = f"""
                        SELECT ip_address, ip_loopback, interface, subnet, description, time
                        FROM ipwan
                        WHERE ip_address IN ({placeholders})
                        ORDER BY time DESC
                    """
                    cur.execute(sql, tuple(all_input_ips))
                    raw_candidates: Dict[str, List[Dict[str, Any]]] = {}
                    for row in cur.fetchall():
                        ip_addr = (row.get('ip_address') or '').strip()
                        if ip_addr:
                            row['ip_address'] = ip_addr
                            row['ip_loopback'] = (row.get('ip_loopback') or '').strip()
                            row['interface'] = (row.get('interface') or '').strip()
                            row['subnet'] = (row.get('subnet') or '').strip()
                            row['description'] = (row.get('description') or '').strip()
                            row['time'] = str(row.get('time') or '')
                            raw_candidates.setdefault(ip_addr, []).append(row)

                    for in_ip in all_input_ips:
                        if in_ip not in raw_candidates:
                            not_found_ips.append(in_ip)

                    # 2. Auto-detect Peer IPs (/30 and /31)
                    if auto_peer:
                        peers_to_fetch: List[str] = []
                        for ip_addr, rows in list(raw_candidates.items()):
                            for r in rows:
                                peer_ip = get_peer_ip(r['ip_address'], r['subnet'])
                                if (
                                    peer_ip
                                    and peer_ip not in raw_candidates
                                    and peer_ip not in peers_to_fetch
                                ):
                                    peers_to_fetch.append(peer_ip)

                        if peers_to_fetch:
                            peer_placeholders = ','.join(['%s'] * len(peers_to_fetch))
                            sql_peer = f"""
                                SELECT ip_address, ip_loopback, interface, subnet, description, time
                                FROM ipwan
                                WHERE ip_address IN ({peer_placeholders})
                                ORDER BY time DESC
                            """
                            cur.execute(sql_peer, tuple(peers_to_fetch))
                            for prow in cur.fetchall():
                                pip = (prow.get('ip_address') or '').strip()
                                if pip:
                                    prow['ip_address'] = pip
                                    prow['ip_loopback'] = (prow.get('ip_loopback') or '').strip()
                                    prow['interface'] = (prow.get('interface') or '').strip()
                                    prow['subnet'] = (prow.get('subnet') or '').strip()
                                    prow['description'] = (prow.get('description') or '').strip()
                                    prow['time'] = str(prow.get('time') or '')
                                    raw_candidates.setdefault(pip, []).append(prow)

                    # 3. Disambiguate when multiple records exist for the same WAN IP
                    known_loopbacks = set()
                    for ip_addr, rows in raw_candidates.items():
                        if len(rows) == 1 and rows[0].get('ip_loopback'):
                            known_loopbacks.add(rows[0]['ip_loopback'])

                    for ip_addr, rows in raw_candidates.items():
                        chosen = rows[0]
                        if len(rows) > 1:
                            for cand in rows:
                                if cand.get('ip_loopback') in known_loopbacks:
                                    chosen = cand
                                    break
                        rec = dict(chosen)
                        rec['is_auto_peer'] = ip_addr not in all_input_ips
                        rec['direction'] = ip_directions.get(ip_addr, 'general')
                        rec['rtt_ms'] = ip_rtt_ms.get(ip_addr)
                        rec['hostname'] = ''
                        rec['model'] = ''
                        rec['area'] = ''
                        rec['circuit'] = extract_circuit_id(rec.get('description', ''))
                        records[ip_addr] = rec

                    # 4. Fetch Hostname, Model, and Location from nodeinfo for all Loopback0 IPs
                    from devices.province_mapping import resolve_province

                    loopbacks = list({
                        r['ip_loopback']
                        for r in records.values()
                        if r.get('ip_loopback')
                    })
                    if loopbacks:
                        lo_placeholders = ','.join(['%s'] * len(loopbacks))
                        sql_nodes = f"""
                            SELECT
                                TRIM(ip_nms) AS ip_nms,
                                TRIM(hostname) AS hostname,
                                TRIM(model) AS model,
                                TRIM(COALESCE(location, '')) AS location
                            FROM nodeinfo
                            WHERE ip_nms IN ({lo_placeholders})
                        """
                        cur.execute(sql_nodes, tuple(loopbacks))
                        node_map: Dict[str, Dict[str, Any]] = {}
                        for nrow in cur.fetchall():
                            lo_key = (nrow.get('ip_nms') or '').strip()
                            if lo_key:
                                node_map[lo_key] = nrow

                        for rip, rval in records.items():
                            lo = rval.get('ip_loopback', '')
                            if lo in node_map:
                                hname = node_map[lo].get('hostname') or ''
                                rval['hostname'] = hname
                                rval['model'] = node_map[lo].get('model') or ''
                                prov_code, prov_name = resolve_province(hname)
                                rval['area'] = prov_name or prov_code or ''

        # 5. Build Topology Links from Hop Sequences (Forward, Return, General)
        links: List[Dict[str, Any]] = []
        seen_links = set()

        def add_p2p_link(
            direction_str: str,
            from_lo_val: str,
            from_ip_val: str,
            from_intf_val: str,
            to_lo_val: str,
            to_ip_val: str,
            to_intf_val: str,
            desc_val: str,
        ):
            lkey = f"{direction_str}:{from_lo_val}:{to_lo_val}:{from_ip_val}:{to_ip_val}"
            if lkey not in seen_links:
                seen_links.add(lkey)
                links.append({
                    'type': 'p2p',
                    'direction': direction_str,
                    'dev_a': from_lo_val,
                    'hostname_a': records.get(from_ip_val, {}).get('hostname') or from_lo_val,
                    'ip_a': from_ip_val,
                    'intf_a': from_intf_val,
                    'dev_b': to_lo_val,
                    'hostname_b': records.get(to_ip_val, {}).get('hostname') or to_lo_val,
                    'ip_b': to_ip_val,
                    'intf_b': to_intf_val,
                    'rtt_ms': ip_rtt_ms.get(to_ip_val) or ip_rtt_ms.get(from_ip_val),
                    'circuit': extract_circuit_id(desc_val),
                    'description': desc_val,
                })

        def trace_hop_path(hops: List[str], direction: str):
            effective_hops = list(hops)
            if auto_peer and effective_hops and effective_hops[0] in records:
                first_ip = effective_hops[0]
                first_rec = records[first_ip]
                peer0 = get_peer_ip(first_ip, first_rec.get('subnet', ''))
                if (
                    peer0
                    and peer0 in records
                    and records[peer0].get('ip_loopback')
                    and records[peer0].get('ip_loopback') != first_rec.get('ip_loopback')
                ):
                    if len(effective_hops) == 1 or (
                        effective_hops[1] != peer0
                        and records.get(effective_hops[1], {}).get('ip_loopback')
                        != records[peer0].get('ip_loopback')
                    ):
                        effective_hops.insert(0, peer0)

            for i in range(len(effective_hops) - 1):
                ip1 = effective_hops[i]
                ip2 = effective_hops[i + 1]
                if ip1 not in records or ip2 not in records:
                    continue

                r1 = records[ip1]
                r2 = records[ip2]
                lo1 = r1['ip_loopback']
                lo2 = r2['ip_loopback']
                if not lo1 or not lo2 or lo1 == lo2:
                    continue

                peer1 = get_peer_ip(ip1, r1['subnet'])
                peer2 = get_peer_ip(ip2, r2['subnet'])

                from_lo = from_ip = from_intf = None
                to_lo = to_ip = to_intf = None
                desc = ''

                if peer1 == ip2:
                    from_lo, from_ip, from_intf = lo1, ip1, r1['interface']
                    to_lo, to_ip, to_intf = lo2, ip2, r2['interface']
                    desc = r1['description'] or r2['description']
                elif peer2 and peer2 in records and records[peer2]['ip_loopback'] == lo1:
                    from_lo, from_ip, from_intf = lo1, peer2, records[peer2]['interface']
                    to_lo, to_ip, to_intf = lo2, ip2, r2['interface']
                    desc = records[peer2]['description'] or r2['description']
                elif peer1 and peer1 in records and records[peer1]['ip_loopback'] == lo2:
                    from_lo, from_ip, from_intf = lo1, ip1, r1['interface']
                    to_lo, to_ip, to_intf = lo2, peer1, records[peer1]['interface']
                    desc = r1['description'] or records[peer1]['description']

                if from_lo and to_lo:
                    add_p2p_link(
                        direction,
                        from_lo,
                        from_ip,
                        from_intf,
                        to_lo,
                        to_ip,
                        to_intf,
                        desc,
                    )
                elif peer2 and peer2 in records:
                    # Handle hidden hop (e.g. PHP + no mpls ip propagate-ttl) where peer2 belongs to an intermediate router
                    peer2_rec = records[peer2]
                    lo_peer2 = peer2_rec.get('ip_loopback')
                    if lo_peer2 and lo_peer2 != lo2:
                        if lo_peer2 != lo1:
                            # Bridge lo1 -> lo_peer2 if a P2P link between them exists in records
                            for cand_ip, cand_rec in records.items():
                                if cand_rec.get('ip_loopback') == lo1:
                                    cand_peer = get_peer_ip(cand_ip, cand_rec.get('subnet', ''))
                                    if (
                                        cand_peer
                                        and cand_peer in records
                                        and records[cand_peer].get('ip_loopback') == lo_peer2
                                    ):
                                        add_p2p_link(
                                            direction,
                                            lo1,
                                            cand_ip,
                                            cand_rec['interface'],
                                            lo_peer2,
                                            cand_peer,
                                            records[cand_peer]['interface'],
                                            cand_rec['description'] or records[cand_peer]['description'],
                                        )
                                        break
                        # Add directional link from intermediate router (lo_peer2) to lo2
                        add_p2p_link(
                            direction,
                            lo_peer2,
                            peer2,
                            peer2_rec['interface'],
                            lo2,
                            ip2,
                            r2['interface'],
                            peer2_rec['description'] or r2['description'],
                        )

        if fwd_hops:
            trace_hop_path(fwd_hops, 'forward')
        if ret_hops:
            trace_hop_path(ret_hops, 'return')
        if gen_hops:
            trace_hop_path(gen_hops, 'general')

        # Fallback: Discover any P2P links between records not captured by sequential hops
        connected_pairs = set()
        for lk in links:
            if lk.get('type') == 'p2p':
                pair_key = (
                    f"{lk['ip_a']}-{lk['ip_b']}"
                    if lk['ip_a'] < lk['ip_b']
                    else f"{lk['ip_b']}-{lk['ip_a']}"
                )
                connected_pairs.add(pair_key)

        for ip_addr, item in records.items():
            peer_ip = get_peer_ip(ip_addr, item['subnet'])
            if peer_ip and peer_ip in records:
                pair_key = f"{ip_addr}-{peer_ip}" if ip_addr < peer_ip else f"{peer_ip}-{ip_addr}"
                if pair_key not in connected_pairs:
                    connected_pairs.add(pair_key)
                    peer_item = records[peer_ip]
                    if item['ip_loopback'] != peer_item['ip_loopback']:
                        links.append({
                            'type': 'p2p',
                            'direction': 'general',
                            'dev_a': item['ip_loopback'],
                            'hostname_a': item.get('hostname') or item['ip_loopback'],
                            'ip_a': ip_addr,
                            'intf_a': item['interface'],
                            'dev_b': peer_item['ip_loopback'],
                            'hostname_b': peer_item.get('hostname') or peer_item['ip_loopback'],
                            'ip_b': peer_ip,
                            'intf_b': peer_item['interface'],
                            'rtt_ms': ip_rtt_ms.get(peer_ip) or ip_rtt_ms.get(ip_addr),
                            'circuit': extract_circuit_id(item['description']),
                            'description': item['description'],
                        })

        # Standalone links for unmatched IPs
        matched_ips = set()
        for lk in links:
            if lk.get('ip_a'):
                matched_ips.add(lk['ip_a'])
            if lk.get('ip_b'):
                matched_ips.add(lk['ip_b'])

        for ip_addr, item in records.items():
            if ip_addr not in matched_ips:
                desc = clean_mermaid_str(item['description'])
                if len(desc) > 30:
                    desc = desc[:27] + '...'
                links.append({
                    'type': 'standalone',
                    'direction': item['direction'],
                    'dev_a': item['ip_loopback'],
                    'hostname_a': item.get('hostname') or item['ip_loopback'],
                    'ip_a': ip_addr,
                    'intf_a': item['interface'],
                    'dev_b': None,
                    'hostname_b': None,
                    'ip_b': None,
                    'intf_b': None,
                    'rtt_ms': ip_rtt_ms.get(ip_addr),
                    'circuit': extract_circuit_id(item['description']),
                    'description': desc,
                })

        # 6. Order Router Devices Strictly Along the Topological Path (Source -> Intermediate -> Destination)
        ordered_loopbacks: List[str] = []

        # 6a. Primary sequence from Forward P2P links (starts with Source Router dev_a)
        for lk in links:
            if lk.get('type') == 'p2p' and lk.get('direction') == 'forward':
                for lo_val in (lk.get('dev_a'), lk.get('dev_b')):
                    if lo_val and lo_val not in ordered_loopbacks:
                        ordered_loopbacks.append(lo_val)

        # 6b. Sequence from General P2P links (if operating in general mode)
        for lk in links:
            if lk.get('type') == 'p2p' and lk.get('direction') == 'general':
                for lo_val in (lk.get('dev_a'), lk.get('dev_b')):
                    if lo_val and lo_val not in ordered_loopbacks:
                        ordered_loopbacks.append(lo_val)

        # 6c. Sequence from Return P2P links walked in reverse (Source -> Destination)
        # so asymmetric return-only routers are inserted at their true topological position
        return_p2p_links = [
            lk for lk in links if lk.get('type') == 'p2p' and lk.get('direction') == 'return'
        ]
        for lk in reversed(return_p2p_links):
            src_side = lk.get('dev_b')
            dst_side = lk.get('dev_a')
            if src_side and src_side not in ordered_loopbacks:
                ordered_loopbacks.append(src_side)
            if dst_side and dst_side not in ordered_loopbacks:
                if src_side and src_side in ordered_loopbacks:
                    idx = ordered_loopbacks.index(src_side)
                    ordered_loopbacks.insert(idx + 1, dst_side)
                else:
                    ordered_loopbacks.append(dst_side)

        # 6d. Fallback for any remaining routers from hop lists or standalone records
        for hop_list in (fwd_hops, gen_hops, list(reversed(ret_hops))):
            for hip in hop_list:
                lo = records.get(hip, {}).get('ip_loopback')
                if lo and lo not in ordered_loopbacks:
                    ordered_loopbacks.append(lo)
        for r in records.values():
            lo = r.get('ip_loopback')
            if lo and lo not in ordered_loopbacks:
                ordered_loopbacks.append(lo)

        # 7. Cross-check Active Incidents in EventAnalyzer PostgreSQL
        all_hostnames = list({
            r.get('hostname') for r in records.values() if r.get('hostname')
        })
        all_circuits = list({
            lk.get('circuit') for lk in links if lk.get('circuit')
        } | {
            r.get('circuit') for r in records.values() if r.get('circuit')
        })
        active_incidents_by_loopback, active_incidents_by_circuit, all_matched_incidents = (
            self._correlate_active_incidents(ordered_loopbacks, all_hostnames, all_circuits)
        )

        devices: List[Dict[str, Any]] = []
        devices_by_lo: Dict[str, Dict[str, Any]] = {}
        for lo in ordered_loopbacks:
            dev_recs = [item for item in records.values() if item['ip_loopback'] == lo]
            first = dev_recs[0] if dev_recs else {}
            hostname = first.get('hostname') or lo
            dev_incidents = active_incidents_by_loopback.get(lo, [])
            dev_obj = {
                'loopback': lo,
                'hostname': hostname,
                'model': first.get('model') or '',
                'area': first.get('area') or '',
                'interfaces': dev_recs,
                'active_incidents': dev_incidents,
            }
            devices.append(dev_obj)
            devices_by_lo[lo] = dev_obj

        # Attach active_incidents to records and links
        for ip_addr, rec in records.items():
            lo = rec.get('ip_loopback', '')
            cid = rec.get('circuit', '')
            inc_map = {inc['id']: inc for inc in active_incidents_by_loopback.get(lo, [])}
            if cid and cid in active_incidents_by_circuit:
                for inc in active_incidents_by_circuit[cid]:
                    inc_map[inc['id']] = inc
            rec['active_incidents'] = list(inc_map.values())

        for lk in links:
            inc_map = {}
            for lo_key in (lk.get('dev_a'), lk.get('dev_b')):
                if lo_key and lo_key in active_incidents_by_loopback:
                    for inc in active_incidents_by_loopback[lo_key]:
                        inc_map[inc['id']] = inc
            cid = lk.get('circuit', '')
            if cid and cid in active_incidents_by_circuit:
                for inc in active_incidents_by_circuit[cid]:
                    inc_map[inc['id']] = inc
            lk['active_incidents'] = list(inc_map.values())

        # Categorize records for Forward, Return, and General tables
        records_fwd: List[Dict[str, Any]] = []
        seen_fwd = set()
        hop_fwd_idx = 0
        for fip in fwd_hops:
            if fip in records and fip not in seen_fwd:
                seen_fwd.add(fip)
                rec = dict(records[fip])
                rec['hop_label'] = f"Hop {hop_fwd_idx}"
                hop_fwd_idx += 1
                records_fwd.append(rec)
        for lk in links:
            if lk['direction'] == 'forward':
                for ip_key in (lk.get('ip_a'), lk.get('ip_b')):
                    if ip_key and ip_key in records and ip_key not in seen_fwd:
                        seen_fwd.add(ip_key)
                        rec = dict(records[ip_key])
                        rec['hop_label'] = 'Peer'
                        records_fwd.append(rec)

        records_ret: List[Dict[str, Any]] = []
        seen_ret = set()
        hop_ret_idx = 0
        for rip in ret_hops:
            if rip in records and rip not in seen_ret:
                seen_ret.add(rip)
                rec = dict(records[rip])
                rec['hop_label'] = f"Hop {hop_ret_idx}"
                hop_ret_idx += 1
                records_ret.append(rec)
        for lk in links:
            if lk['direction'] == 'return':
                for ip_key in (lk.get('ip_a'), lk.get('ip_b')):
                    if ip_key and ip_key in records and ip_key not in seen_ret:
                        seen_ret.add(ip_key)
                        rec = dict(records[ip_key])
                        rec['hop_label'] = 'Peer'
                        records_ret.append(rec)

        records_gen: List[Dict[str, Any]] = []
        for ip_addr, item in records.items():
            if ip_addr not in seen_fwd and ip_addr not in seen_ret:
                rec = dict(item)
                rec['hop_label'] = 'Peer' if item.get('is_auto_peer') else 'Interface'
                records_gen.append(rec)

        # Build unique topology interface pairs for Per-Interface Traffic Loss Inspector
        topology_interfaces: List[Dict[str, Any]] = []
        seen_topo_intfs = set()
        for hop_seq_idx, lk in enumerate(links):
            for side, lo_field, host_field, ip_field, intf_field, role_label in (
                ('A', 'dev_a', 'hostname_a', 'ip_a', 'intf_a', 'Egress / Upstream'),
                ('B', 'dev_b', 'hostname_b', 'ip_b', 'intf_b', 'Ingress / Downstream'),
            ):
                lo_val = lk.get(lo_field)
                intf_val = lk.get(intf_field)
                ip_val = lk.get(ip_field)
                if lo_val and intf_val:
                    tkey = f"{lo_val}:{intf_val}"
                    if tkey not in seen_topo_intfs:
                        seen_topo_intfs.add(tkey)
                        dev_meta = devices_by_lo.get(lo_val, {})
                        topology_interfaces.append({
                            'ip_loopback': lo_val,
                            'hostname': dev_meta.get('hostname') or lk.get(host_field) or lo_val,
                            'model': dev_meta.get('model') or '',
                            'area': dev_meta.get('area') or '',
                            'interface': intf_val,
                            'ip_address': ip_val or '',
                            'role': role_label,
                            'direction': lk.get('direction', 'general'),
                            'link_index': hop_seq_idx,
                            'circuit': lk.get('circuit') or '',
                            'description': lk.get('description') or '',
                        })

        # 8. Generate Mermaid Syntax + js_edges
        mermaid_code, js_edges, dev_node_map = self._build_mermaid(devices, links)

        exec_time = round(time.time() - start_time, 3)

        return {
            'mode': effective_mode,
            'auto_peer': auto_peer,
            'exec_time': exec_time,
            'stats': {
                'input_ips_count': len(all_input_ips),
                'matched_interfaces_count': len(records),
                'routers_count': len(devices),
                'links_count': len(links),
                'not_found_count': len(not_found_ips),
                'active_incidents_count': len(all_matched_incidents),
            },
            'not_found_ips': not_found_ips,
            'devices': devices,
            'dev_node_map': dev_node_map,
            'links': links,
            'records_fwd': records_fwd,
            'records_ret': records_ret,
            'records_gen': records_gen,
            'records_all': list(records.values()),
            'topology_interfaces': topology_interfaces,
            'active_incidents': all_matched_incidents,
            'mermaid_code': mermaid_code,
            'js_edges': js_edges,
        }

    def _correlate_active_incidents(
        self,
        loopbacks: List[str],
        hostnames: List[str],
        circuits: List[str],
    ) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, List[Dict[str, Any]]], List[Dict[str, Any]]]:
        """
        Query EventAnalyzer's PostgreSQL `Incident` table for active incidents
        matching any router Loopback0, hostname, or circuit ID in the topology.
        """
        by_loopback: Dict[str, List[Dict[str, Any]]] = {}
        by_circuit: Dict[str, List[Dict[str, Any]]] = {}
        all_incidents: List[Dict[str, Any]] = []

        if not loopbacks and not hostnames and not circuits:
            return by_loopback, by_circuit, all_incidents

        try:
            from django.db.models import Q

            q_filter = Q()
            if loopbacks:
                q_filter |= Q(primary_device__management_ip__in=loopbacks)
            if hostnames:
                q_filter |= (
                    Q(primary_device__name__in=hostnames)
                    | Q(primary_device__sys_name__in=hostnames)
                    | Q(remote_device__in=hostnames)
                )
            if circuits:
                q_filter |= Q(circuit_id__in=circuits)

            qs = (
                Incident.objects.select_related('primary_device')
                .filter(status__in=IncidentStatus.ACTIVE_STATUSES)
                .filter(q_filter)
                .order_by('-down_time')
            )

            for inc in qs:
                dev_ip = inc.primary_device.management_ip if inc.primary_device else ''
                dev_name = (
                    (inc.primary_device.sys_name or inc.primary_device.name)
                    if inc.primary_device
                    else ''
                )
                inc_dict = {
                    'id': inc.id,
                    'incident_number': inc.incident_number,
                    'incident_type': inc.incident_type,
                    'status': inc.status,
                    'node_name': dev_name,
                    'device_ip': dev_ip,
                    'interface_name': inc.interface_name,
                    'circuit_id': inc.circuit_id,
                    'osticket_id': inc.ticket_id_osticket,
                    'tts_id': inc.ticket_id_tss,
                    'down_time': inc.down_time.isoformat() if inc.down_time else None,
                }
                all_incidents.append(inc_dict)
                if dev_ip:
                    by_loopback.setdefault(dev_ip, []).append(inc_dict)
                if inc.circuit_id:
                    by_circuit.setdefault(inc.circuit_id.upper(), []).append(inc_dict)
        except Exception as e:
            logger.warning(f"WAN2LO0_INCIDENT_CORRELATION_WARNING: {e}")

        return by_loopback, by_circuit, all_incidents

    def _build_mermaid(
        self,
        devices: List[Dict[str, Any]],
        links: List[Dict[str, Any]],
    ) -> Tuple[str, List[Dict[str, Any]], Dict[str, str]]:
        """Generate Mermaid flowchart LR code and js_edges metadata for interactive SVG manipulation."""
        mermaid_lines = [
            "flowchart LR",
            "    classDef router fill:#1e293b,stroke:#0284c7,stroke-width:2px,color:#f8fafc,font-weight:bold;",
            "    classDef routerAlert fill:#450a0a,stroke:#ef4444,stroke-width:3px,color:#fef2f2,font-weight:bold;",
            "    classDef cloud fill:#f8fafc,stroke:#94a3b8,stroke-width:1px,stroke-dasharray: 4 4,color:#475569;",
        ]

        dev_node_map: Dict[str, str] = {}
        for idx, dev in enumerate(devices, start=1):
            lo = dev['loopback']
            node_id = f"R{idx}"
            dev_node_map[lo] = node_id

            host_label = clean_mermaid_str(dev['hostname'])
            model_label = clean_mermaid_str(dev['model'])
            area_label = clean_mermaid_str(dev.get('area', ''))
            active_incs = dev.get('active_incidents') or []

            label = f"<b>{host_label}</b><br/>Loopback: {lo}"
            if model_label:
                label += f"<br/><small>({model_label})</small>"
            if area_label:
                label += f"<br/><small>📍 {area_label}</small>"
            if active_incs:
                inc_badges = ', '.join(
                    inc.get('osticket_id') or inc.get('tts_id') or f"INC-{inc['id']:06d}"
                    for inc in active_incs[:2]
                )
                label += f"<br/>🚨 <b>ACTIVE INCIDENT: {clean_mermaid_str(inc_badges)}</b>"
                mermaid_lines.append(f'    {node_id}["{label}"]:::routerAlert')
            else:
                mermaid_lines.append(f'    {node_id}["{label}"]:::router')

        cloud_counter = 1
        link_styles: List[str] = []
        js_edges: List[Dict[str, Any]] = []
        link_index = 0

        for lk in links:
            node_a = dev_node_map.get(lk.get('dev_a') or '')
            if lk.get('type') == 'p2p':
                node_b = dev_node_map.get(lk.get('dev_b') or '')
                if node_a and node_b:
                    intf_a = shorten_intf(lk.get('intf_a'))
                    intf_b = shorten_intf(lk.get('intf_b'))
                    rtt_badge = f" [{lk['rtt_ms']} ms]" if lk.get('rtt_ms') is not None else ""

                    if lk.get('direction') == 'forward':
                        dir_badge = f"🔵 <b>ขาไป (Forward){rtt_badge}</b><br/>"
                        label = f"{dir_badge}{intf_a} ({lk['ip_a']}) ➔ {intf_b} ({lk['ip_b']})"
                        mermaid_lines.append(f'    {node_a} --> |"{label}"| {node_b}')
                        link_styles.append(f"    linkStyle {link_index} stroke:#2563eb,stroke-width:3px;")
                    elif lk.get('direction') == 'return':
                        dir_badge = f"🟠 <b>ขากลับ (Return){rtt_badge}</b><br/>"
                        label = f"{dir_badge}{intf_b} ({lk['ip_b']}) &lt;- {intf_a} ({lk['ip_a']})"
                        mermaid_lines.append(f'    {node_a} -.-> |"{label}"| {node_b}')
                        link_styles.append(
                            f"    linkStyle {link_index} stroke:#ea580c,stroke-width:3px,stroke-dasharray: 6 4;"
                        )
                    else:
                        label = f"{intf_a} ({lk['ip_a']})<br/>⟷<br/>{intf_b} ({lk['ip_b']})"
                        mermaid_lines.append(f'    {node_a} <===> |"{label}"| {node_b}')
                        link_styles.append(f"    linkStyle {link_index} stroke:#0284c7,stroke-width:2.5px;")

                    js_edges.append({
                        'index': link_index,
                        'source': node_a,
                        'target': node_b,
                        'direction': lk.get('direction', 'general'),
                        'dev_a': lk.get('dev_a'),
                        'intf_a': lk.get('intf_a'),
                        'ip_a': lk.get('ip_a'),
                        'dev_b': lk.get('dev_b'),
                        'intf_b': lk.get('intf_b'),
                        'ip_b': lk.get('ip_b'),
                    })
                    link_index += 1
            else:
                if node_a:
                    cloud_id = f"Ext{cloud_counter}"
                    cloud_counter += 1
                    intf_a = shorten_intf(lk.get('intf_a'))
                    label = f"{intf_a}<br/>{lk.get('ip_a')}"
                    if lk.get('description'):
                        label += f"<br/>{lk['description']}"

                    if lk.get('direction') == 'forward':
                        label = f"🔵 ขาไป (Forward)<br/>{label}"
                        mermaid_lines.append(f'    {cloud_id}(["☁️ WAN Peer / Circuit"]):::cloud')
                        mermaid_lines.append(f'    {node_a} --> |"{label}"| {cloud_id}')
                        link_styles.append(f"    linkStyle {link_index} stroke:#2563eb,stroke-width:3px;")
                        edge_src, edge_dst = node_a, cloud_id
                    elif lk.get('direction') == 'return':
                        label = f"🟠 ขากลับ (Return)<br/>{label}"
                        mermaid_lines.append(f'    {cloud_id}(["☁️ WAN Peer / Circuit"]):::cloud')
                        mermaid_lines.append(f'    {cloud_id} -.-> |"{label}"| {node_a}')
                        link_styles.append(
                            f"    linkStyle {link_index} stroke:#ea580c,stroke-width:3px,stroke-dasharray: 6 4;"
                        )
                        edge_src, edge_dst = cloud_id, node_a
                    else:
                        mermaid_lines.append(f'    {cloud_id}(["☁️ WAN Peer / Circuit"]):::cloud')
                        mermaid_lines.append(f'    {node_a} -.-> |"{label}"| {cloud_id}')
                        link_styles.append(f"    linkStyle {link_index} stroke:#94a3b8,stroke-width:2px;")
                        edge_src, edge_dst = node_a, cloud_id

                    js_edges.append({
                        'index': link_index,
                        'source': edge_src,
                        'target': edge_dst,
                        'direction': lk.get('direction', 'general'),
                        'dev_a': lk.get('dev_a'),
                        'intf_a': lk.get('intf_a'),
                        'ip_a': lk.get('ip_a'),
                        'dev_b': None,
                        'intf_b': None,
                        'ip_b': None,
                    })
                    link_index += 1

        mermaid_lines.extend(link_styles)
        return '\n'.join(mermaid_lines), js_edges, dev_node_map


wan2loopback_service = Wan2LoopbackService()
