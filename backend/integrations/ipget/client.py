import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple
from django.conf import settings

logger = logging.getLogger(__name__)


class IPGETClient:
    """
    Client for interacting with the IPGET Network Monitoring & Alarm API (10.199.47.38).
    Provides access to:
      1. Interface alarms (/device/alarm/interface/)
      2. Node reachability ping alarms (/device/alarm/ping/)
      3. Trouble Ticket System tickets (/tts/data/open/listNTID)
    """

    DEFAULT_GROUPS = "bangkok, central, north, east, north_east, west, south, p_route, isp"

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None, timeout: Optional[int] = None):
        self.base_url = (base_url or getattr(settings, 'IPGET_BASE_URL', 'http://10.199.47.38')).rstrip('/')
        self.api_key = api_key or getattr(settings, 'IPGET_API_KEY', '46177ba00a8de4eaa9dba64988274da3')
        self.timeout = timeout or getattr(settings, 'IPGET_TIMEOUT', 6)

    def _post(self, endpoint: str, payload: dict, timeout: Optional[int] = None) -> dict:
        url = f"{self.base_url}{endpoint}"
        headers = {
            'Content-Type': 'application/json',
            'IPGET-API-Key': self.api_key
        }
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as response:
                return json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                # IPGET API returns HTTP 404 with JSON when 0 records/tickets are found
                try:
                    return json.loads(e.read().decode('utf-8'))
                except Exception:
                    return {"count": 0, "data": []}
            raise

    @staticmethod
    def normalize_port_name(port_name: str) -> str:
        """
        Normalize port names to Cisco canonical short form for exact matching.
        E.g.
          'HundredGigE0/2/0/0' -> 'hu0/2/0/0'
          'TenGigabitEthernet2/3' -> 'te2/3'
          'TenGigE0/0/0/31' -> 'te0/0/0/31'
          'GigabitEthernet0/1/2' -> 'gi0/1/2'
          'Bundle-Ether1' -> 'be1'
        """
        if not port_name:
            return ''
        s = port_name.strip()
        s = re.sub(r'^HundredGig(?:abit)?E(?:thernet)?', 'Hu', s, flags=re.I)
        s = re.sub(r'^TenGig(?:abit)?E(?:thernet)?', 'Te', s, flags=re.I)
        s = re.sub(r'^FortyGig(?:abit)?E(?:thernet)?', 'Fo', s, flags=re.I)
        s = re.sub(r'^TwentyFiveGig(?:abit)?E(?:thernet)?', 'TF', s, flags=re.I)
        s = re.sub(r'^Gig(?:abit)?E(?:thernet)?', 'Gi', s, flags=re.I)
        s = re.sub(r'^FastEthernet', 'Fa', s, flags=re.I)
        s = re.sub(r'^Ethernet', 'Eth', s, flags=re.I)
        s = re.sub(r'^Bundle-Ether', 'BE', s, flags=re.I)
        s = re.sub(r'^Port-channel', 'Po', s, flags=re.I)
        s = re.sub(r'^Loopback', 'Lo', s, flags=re.I)
        s = re.sub(r'^Vlan', 'Vl', s, flags=re.I)
        return s.lower()

    _interface_alarm_cache: Dict[str, Tuple[float, List[dict]]] = {}
    _node_alarm_cache: Dict[str, Tuple[float, List[dict]]] = {}
    _tts_cache: Dict[str, Tuple[float, List[dict]]] = {}
    _site_cache: Dict[str, Tuple[float, dict]] = {}
    CACHE_TTL_SECONDS = 90

    @staticmethod
    def _get_redis():
        try:
            import redis
            return redis.Redis.from_url('redis://redis:6379/1', socket_timeout=1)
        except Exception:
            return None

    def fetch_interface_alarms(
        self,
        interval_hour: int = 72,
        layer: str = "L3",
        group_name: Optional[str] = None,
        prefer_cache: bool = True,
        force_refresh: bool = False
    ) -> List[dict]:
        """
        Fetch active or recent interface down alarms from IPGET.
        Cache-First Architecture:
          - If prefer_cache=True and not force_refresh: checks Redis cache and fallback snapshot first.
            Returns immediately without making external HTTP requests.
          - If force_refresh=True or cache is empty: calls IPGET API /device/alarm/interface/,
            stores results into Redis (TTL 300s) and updates persistent last_snapshot.
          - Gracefully falls back to last_snapshot during IPGET 403 or network failure.
        """
        import time
        cache_key = f"{layer}_{group_name or self.DEFAULT_GROUPS}_{interval_hour}"
        redis_key = f"ipget:if_alarms:{cache_key}"
        r = self._get_redis()

        # 1. Cache-First lookup: If cached data exists in Redis or memory, return immediately
        if prefer_cache and not force_refresh:
            if r:
                try:
                    cached_data = r.get(redis_key)
                    if cached_data:
                        logger.debug("IPGET fetch_interface_alarms: Cache hit from Redis key %s", redis_key)
                        return json.loads(cached_data.decode('utf-8'))
                    snapshot = r.get("ipget:if_alarms:last_snapshot")
                    if snapshot:
                        logger.debug("IPGET fetch_interface_alarms: Cache hit from Redis last_snapshot")
                        return json.loads(snapshot.decode('utf-8'))
                except Exception as e:
                    logger.warning("Redis cache read error: %s", e)

            mem_cached = self._interface_alarm_cache.get(cache_key)
            if mem_cached:
                return mem_cached[1]

        # 2. Fetch from IPGET API (if force_refresh=True or cache miss)
        now_ts = time.time()
        payload = {
            "layer": layer,
            "group_name": group_name or self.DEFAULT_GROUPS,
            "interval_hour": interval_hour
        }
        try:
            res = self._post("/device/alarm/interface/", payload)
            data = res.get("data", [])
            if data:
                self._interface_alarm_cache[cache_key] = (now_ts, data)
                if r:
                    try:
                        r.set(redis_key, json.dumps(data), ex=300)
                        r.set("ipget:if_alarms:last_snapshot", json.dumps(data))
                    except Exception:
                        pass
            return data
        except Exception as e:
            logger.error(f"IPGET fetch_interface_alarms error: {e}")
            if r:
                try:
                    snapshot = r.get("ipget:if_alarms:last_snapshot")
                    if snapshot:
                        logger.info("IPGET fetch_interface_alarms: using Redis last_snapshot during API failure/rate-limit")
                        return json.loads(snapshot.decode('utf-8'))
                except Exception:
                    pass
            mem_cached = self._interface_alarm_cache.get(cache_key)
            if mem_cached:
                return mem_cached[1]
            return []

    def fetch_node_alarms(
        self,
        interval_hour: int = 72,
        layer: str = "L3",
        group_name: Optional[str] = None,
        prefer_cache: bool = True,
        force_refresh: bool = False
    ) -> List[dict]:
        """
        Fetch node reachability ping alarms from IPGET.
        Cache-First Architecture:
          - If prefer_cache=True and not force_refresh: checks Redis cache and fallback snapshot first.
          - If force_refresh=True or cache miss: calls IPGET API /device/alarm/ping/ and updates Redis (TTL 300s).
          - Gracefully falls back to last_snapshot during IPGET 403 or network failure.
        """
        import time
        cache_key = f"{layer}_{group_name or self.DEFAULT_GROUPS}_{interval_hour}"
        redis_key = f"ipget:node_alarms:{cache_key}"
        r = self._get_redis()

        # 1. Cache-First lookup
        if prefer_cache and not force_refresh:
            if r:
                try:
                    cached_data = r.get(redis_key)
                    if cached_data:
                        logger.debug("IPGET fetch_node_alarms: Cache hit from Redis key %s", redis_key)
                        return json.loads(cached_data.decode('utf-8'))
                    snapshot = r.get("ipget:node_alarms:last_snapshot")
                    if snapshot:
                        logger.debug("IPGET fetch_node_alarms: Cache hit from Redis last_snapshot")
                        return json.loads(snapshot.decode('utf-8'))
                except Exception as e:
                    logger.warning("Redis cache read error: %s", e)

            mem_cached = self._node_alarm_cache.get(cache_key)
            if mem_cached:
                return mem_cached[1]

        # 2. Fetch from IPGET API
        now_ts = time.time()
        payload = {
            "layer": layer,
            "group_name": group_name or self.DEFAULT_GROUPS,
            "interval_hour": interval_hour
        }
        try:
            res = self._post("/device/alarm/ping/", payload)
            data = res.get("data", [])
            if data:
                self._node_alarm_cache[cache_key] = (now_ts, data)
                if r:
                    try:
                        r.set(redis_key, json.dumps(data), ex=300)
                        r.set("ipget:node_alarms:last_snapshot", json.dumps(data))
                    except Exception:
                        pass
            return data
        except Exception as e:
            logger.error(f"IPGET fetch_node_alarms error: {e}")
            if r:
                try:
                    snapshot = r.get("ipget:node_alarms:last_snapshot")
                    if snapshot:
                        return json.loads(snapshot.decode('utf-8'))
                except Exception:
                    pass
            mem_cached = self._node_alarm_cache.get(cache_key)
            if mem_cached:
                return mem_cached[1]
            return []

    def fetch_tts_by_ntids(
        self,
        ntids: List[str],
        prefer_cache: bool = True,
        force_refresh: bool = False
    ) -> List[dict]:
        """
        Fetch Trouble Tickets from TTS by list of NTID / Circuit IDs with Redis caching.
        """
        if not ntids:
            return []
        import time
        cache_key = ",".join(sorted(ntids))
        redis_key = f"ipget:tts:{cache_key}"
        r = self._get_redis()

        # 1. Cache-First lookup
        if prefer_cache and not force_refresh:
            if r:
                try:
                    cached_data = r.get(redis_key)
                    if cached_data:
                        return json.loads(cached_data.decode('utf-8'))
                except Exception:
                    pass

            mem_cached = self._tts_cache.get(cache_key)
            if mem_cached and (time.time() - mem_cached[0] < 300):
                return mem_cached[1]

        # 2. Fetch from TTS API
        now_ts = time.time()
        try:
            res = self._post("/tts/data/open/listNTID", {"ntid": ntids}, timeout=25)
            data = res.get("data", [])
            # Always cache in memory and Redis (even empty list [] to prevent hammering IPGET)
            self._tts_cache[cache_key] = (now_ts, data)
            if r:
                try:
                    r.set(redis_key, json.dumps(data), ex=180 if not data else 300)
                    for item in data:
                        cat_id = item.get('CATID')
                        if cat_id:
                            r.set(f"ipget:tts:{cat_id}", json.dumps([item]), ex=300)
                except Exception:
                    pass
            return data
        except Exception as e:
            logger.error(f"IPGET fetch_tts_by_ntids error: {e}")
            if r:
                try:
                    cached_data = r.get(redis_key)
                    if cached_data:
                        return json.loads(cached_data.decode('utf-8'))
                except Exception:
                    pass
            mem_cached = self._tts_cache.get(cache_key)
            if mem_cached:
                return mem_cached[1]
            return []

    def build_alarm_index(self, alarms: List[dict]) -> Tuple[Dict[Tuple[str, str], dict], Dict[Tuple[str, str], dict]]:
        """
        Build O(1) lookup tables from IPGET alarm records:
          1. ip_index: (ip_address, normalized_port) -> alarm_record
          2. name_index: (nodename_lower, normalized_port) -> alarm_record
        """
        ip_index = {}
        name_index = {}
        for item in alarms:
            norm_port = self.normalize_port_name(item.get("name", ""))
            if not norm_port:
                continue
            ip = (item.get("ip_address") or "").strip()
            if ip:
                ip_index[(ip, norm_port)] = item
            nodename = (item.get("nodename") or "").strip().lower()
            if nodename:
                name_index[(nodename, norm_port)] = item
        return ip_index, name_index

    def match_alarm(
        self,
        ip_index: Dict[Tuple[str, str], dict],
        name_index: Dict[Tuple[str, str], dict],
        device_ip: str,
        port_name: str,
        device_name: str = ""
    ) -> Optional[dict]:
        """
        Match an incident against IPGET alarm indexes.
        Tries (IP, Port) first, then falls back to (Hostname, Port).
        """
        norm_port = self.normalize_port_name(port_name)
        if not norm_port:
            return None

        # 1. Primary match: (IP, normalized_port)
        if device_ip:
            match = ip_index.get((device_ip.strip(), norm_port))
            if match:
                return match

        # 2. Fallback match: (hostname/nodename, normalized_port)
        if device_name:
            dev_clean = device_name.strip().lower()
            match = name_index.get((dev_clean, norm_port))
            if match:
                return match

            # Prefix match for hostnames like 'BK-BRKC-PE-9010-01' vs 'bk-brkc-pe-9010-01.bkk.catbb.net'
            short_host = dev_clean.split('.')[0]
            for (idx_node, idx_port), item in name_index.items():
                if idx_port == norm_port and (idx_node == short_host or idx_node.startswith(short_host)):
                    return item

        return None

    @staticmethod
    def extract_tts_info(ticket_data: dict) -> dict:
        """
        Extract normalized fields from TTS listNTID ticket response object.
        """
        if not ticket_data:
            return {}

        ticket_id = (ticket_data.get('INCIDENT_ID') or '').strip()
        circuit_id = (ticket_data.get('CATID') or '').strip()
        status = (ticket_data.get('IM_STATUS') or '').strip()
        repair_team = (ticket_data.get('REPAIRTEAM') or ticket_data.get('AGENCIES') or '').strip()
        dept = (ticket_data.get('RESPONSE_DEPARTMENT') or ticket_data.get('RESPONSE_AREA') or ticket_data.get('OWNER_NAME') or '').strip()
        actual_cause = (ticket_data.get('CAUSE_DETAIL') or ticket_data.get('CAUSE_GROUP') or '').strip()
        resolution = (ticket_data.get('RESOLUTION') or '').strip()

        # Parse GPS coordinates from DESCRIPTION (e.g. Location: 13.88533506, 100.5772652)
        desc = ticket_data.get('DESCRIPTION') or ''
        source_gps = ''
        dest_gps = ''
        gps_matches = re.findall(r'Location:\s*([0-9\.\-]+,\s*[0-9\.\-]+)', desc)
        if len(gps_matches) >= 1:
            source_gps = gps_matches[0].strip()
        if len(gps_matches) >= 2:
            dest_gps = gps_matches[1].strip()

        return {
            'ticket_id_tss': ticket_id,
            'circuit_id': circuit_id,
            'tts_status': status,
            'repair_team': repair_team,
            'response_department': dept,
            'actual_cause': actual_cause,
            'resolution': resolution,
            'source_gps': source_gps,
            'dest_gps': dest_gps,
            'raw_data': ticket_data
        }

    def fetch_node_ping_info(
        self,
        device_ip: str,
        device_name: str = "",
        prefer_cache: bool = True,
        force_refresh: bool = False
    ) -> Optional[dict]:
        """
        Query /device/alarm/ping/ to find site_name, province, cat_office_name for a device.
        """
        alarms = self.fetch_node_alarms(interval_hour=72, prefer_cache=prefer_cache, force_refresh=force_refresh)
        if not alarms:
            return None

        ip_clean = (device_ip or '').strip()
        dev_clean = (device_name or '').strip().lower().split('.')[0]

        for item in alarms:
            item_ip = (item.get('ip_address') or '').strip()
            item_node = (item.get('nodename') or '').strip().lower().split('.')[0]
            if (ip_clean and item_ip == ip_clean) or (dev_clean and item_node == dev_clean):
                return {
                    'site_name': item.get('site_name') or '',
                    'site_id': str(item.get('site_id') or ''),
                    'province': item.get('province') or '',
                    'cat_office_name': item.get('cat_office_name') or '',
                    'node_description': item.get('node_description') or ''
                }
        return None

    def fetch_tts_for_device(
        self,
        device_ip: str,
        device_name: str = "",
        sys_name: str = "",
        prefer_cache: bool = True,
        force_refresh: bool = False
    ) -> Optional[dict]:
        """
        Fetch Trouble Ticket for a Device Down incident using IP and hostname candidates.
        """
        candidates = []
        if device_ip:
            candidates.append(device_ip.strip())
        if device_name:
            clean_name = device_name.strip()
            candidates.append(clean_name)
            short_name = clean_name.split('.')[0]
            if short_name and short_name != clean_name:
                candidates.append(short_name)
        if sys_name and sys_name.strip() not in candidates:
            candidates.append(sys_name.strip())

        if not candidates:
            return None

        tickets = self.fetch_tts_by_ntids(candidates, prefer_cache=prefer_cache, force_refresh=force_refresh)
        if tickets and len(tickets) > 0:
            return self.extract_tts_info(tickets[0])
        return None

    def fetch_site_info(
        self,
        site_id: Any,
        prefer_cache: bool = True,
        force_refresh: bool = False
    ) -> Optional[dict]:
        """
        Fetch Site Master data (GPS coordinates, address, station class, unmanned status)
        from NTSite API (/ntsite/data/site).
        Cache-First Architecture:
          - Looks up in Redis 'ipget:site:{site_id}' (TTL 30 days = 2,592,000s)
          - In-memory cache fallback.
          - On cache miss: calls POST /ntsite/data/site with {"site_id": str(site_id)}.
        """
        if not site_id:
            return None
        sid = str(site_id).strip()
        if not sid or sid == '0' or sid.lower() == 'none':
            return None

        import time
        now_ts = time.time()
        redis_key = f"ipget:site:{sid}"
        r = self._get_redis()

        # 1. Cache-First lookup
        if prefer_cache and not force_refresh:
            if r:
                try:
                    cached_data = r.get(redis_key)
                    if cached_data:
                        return json.loads(cached_data.decode('utf-8'))
                except Exception as e:
                    logger.warning("Redis site cache read error: %s", e)

            mem_cached = self._site_cache.get(sid)
            if mem_cached:
                return mem_cached[1]

        # 2. Fetch from NTSite API
        try:
            res = self._post("/ntsite/data/site", {"site_id": sid}, timeout=6)
            details = res.get("detail", [])
            if details and len(details) > 0:
                raw = details[0]
                site_info = {
                    'site_id': raw.get('site_id'),
                    'site_name': raw.get('site_name') or '',
                    'site_code': raw.get('site_code') or '',
                    'user_site_code': raw.get('user_site_code') or '',
                    'latitude': str(raw.get('latitude') or raw.get('latitude_d') or '').strip(),
                    'longitude': str(raw.get('longitude') or raw.get('longitude_d') or '').strip(),
                    'class': raw.get('class') or '',
                    'unmanned': int(raw.get('unmanned') or 0),
                    'full_address': raw.get('full_address') or '',
                    'tumbol': raw.get('tumbol') or '',
                    'amphur': raw.get('amphur') or '',
                    'province': raw.get('province') or '',
                    'postcode': raw.get('postcode') or '',
                    'ability_90_max': raw.get('ability_90_max'),
                    'ability_1y_max': raw.get('ability_1y_max'),
                    'raw': raw
                }
                self._site_cache[sid] = (now_ts, site_info)
                if r:
                    try:
                        # 30 days TTL (2,592,000 seconds)
                        r.set(redis_key, json.dumps(site_info), ex=2592000)
                    except Exception:
                        pass
                return site_info
            return None
        except Exception as e:
            logger.error(f"IPGET fetch_site_info error for site_id {sid}: {e}")
            mem_cached = self._site_cache.get(sid)
            if mem_cached:
                return mem_cached[1]
            return None

