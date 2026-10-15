"""
Service for evaluating Ticket Eligibility Policies and building formatted
NT TTS ticket payloads.
Enforces the 4 strict business rules:
1. Must have confirmed down info from IPGET API 1 (/device/alarm/interface/)
2. Must have Circuit ID (cat_id) from IPGET API 1
3. Must have continuous downtime >= 15 minutes (900 seconds)
4. Must not already have an open ticket in TTS
"""
import logging
import os
import re
from contextlib import contextmanager
from typing import Dict, Any, List, Optional, Tuple
from django.utils import timezone

from common.constants import IncidentStatus, TimelineEventType
from incidents.models import Incident
from integrations.ipget import IPGETClient
from integrations.tts import TTSClient

logger = logging.getLogger(__name__)

SUSTAINED_DOWN_SECONDS = 900  # 15 minutes
CLOSED_TTS_STATUSES = ('Complete', 'Closed', 'Resolved', 'Rejected', 'Cancelled', 'Cancel')


class TicketPolicyService:
    def __init__(self, ipget_client: Optional[IPGETClient] = None, tts_client: Optional[TTSClient] = None):
        self.ipget = ipget_client or IPGETClient()
        self.tts = tts_client or TTSClient()

    @staticmethod
    def extract_circuit_candidates(circuit_id: str) -> List[str]:
        """
        Extracts candidate circuit IDs from potentially composite strings
        such as 'TBB0005562+TBB147010' or 'TBB145014/TBB145015'.
        """
        if not circuit_id:
            return []
        raw = circuit_id.strip()
        candidates: List[str] = []
        parts = [p.strip() for p in re.split(r'[+,/;\s]+', raw) if p.strip()]
        for p in parts:
            if p not in candidates:
                candidates.append(p)
        if raw not in candidates:
            candidates.append(raw)
        return candidates

    @staticmethod
    @contextmanager
    def redis_lock_circuit(lock_key: str, expire: int = 240):
        """
        Distributed lock context manager using Redis to prevent concurrent
        duplicate NT TTS ticket creation for the same circuit.
        """
        lock = None
        acquired = False
        try:
            import redis
            redis_host = os.getenv('REDIS_HOST', 'redis')
            r = redis.Redis(host=redis_host, port=6379, db=1, socket_timeout=2)
            lock = r.lock(lock_key, timeout=expire)
            acquired = bool(lock.acquire(blocking=False))
        except Exception as e:
            logger.warning(f"TicketPolicyService: Error acquiring redis lock {lock_key}: {e}")
            acquired = True

        try:
            yield acquired
        finally:
            if acquired and lock:
                try:
                    lock.release()
                except Exception as e:
                    logger.debug(f"TicketPolicyService: Error releasing redis lock {lock_key}: {e}")

    def find_active_circuit_tts_ticket(self, circuit_id: str, exclude_incident_id: Optional[int] = None) -> Optional[Incident]:
        """
        Checks if any other active incident on the same circuit already has an active NT TTS ticket.
        """
        if not circuit_id:
            return None
        candidates = self.extract_circuit_candidates(circuit_id)
        qs = (
            Incident.objects
            .filter(circuit_id__in=candidates, status__in=IncidentStatus.ACTIVE_STATUSES)
            .exclude(ticket_id_tss='')
            .exclude(ticket_id_tss__isnull=True)
            .exclude(tts_status__in=CLOSED_TTS_STATUSES)
        )
        if exclude_incident_id:
            qs = qs.exclude(id=exclude_incident_id)
        return qs.first()

    def propagate_tts_ticket_to_peers(
        self,
        origin_incident: Incident,
        ticket_id: str,
        circuit_id: str = "",
        tts_status: str = "Open",
        repair_team: str = "",
        incident_id_im: Optional[str] = None,
        is_reused: bool = False,
    ) -> int:
        """
        Auto-propagates NT TTS ticket number, status, and repair team to all active
        peer incidents sharing the same circuit_id.
        """
        cid = (circuit_id or origin_incident.circuit_id or '').strip()
        tid = (ticket_id or origin_incident.ticket_id_tss or '').strip()
        if not cid or not tid:
            return 0

        candidates = self.extract_circuit_candidates(cid)
        peers = (
            Incident.objects
            .filter(circuit_id__in=candidates, status__in=IncidentStatus.ACTIVE_STATUSES)
            .exclude(id=origin_incident.id)
            .exclude(ticket_id_tss=tid)
        )

        updated_count = 0
        for peer in peers:
            peer.ticket_id_tss = tid
            peer.tts_status = tts_status or 'Open'
            update_fields = ['ticket_id_tss', 'tts_status', 'updated_at']
            if repair_team and not peer.repair_team:
                peer.repair_team = repair_team
                update_fields.append('repair_team')
            peer.save(update_fields=update_fields)

            peer.add_timeline_entry(
                event_type=TimelineEventType.TICKET_LINKED,
                source='NT_TTS_PEER_SYNC',
                description=f"Auto-linked Trouble Ticket {tid} from peer circuit incident {origin_incident.incident_number}",
                data={
                    'ticket_id_tss': tid,
                    'incident_id': incident_id_im,
                    'circuit_id': cid,
                    'peer_incident': origin_incident.incident_number,
                    'reused': is_reused,
                },
            )
            updated_count += 1
            logger.info(
                f"TicketPolicyService: Auto-propagated NT TTS ticket {tid} "
                f"to peer Incident {peer.incident_number} (Circuit: {cid})"
            )
        return updated_count

    def evaluate_eligibility(self, incident: Incident, force_refresh: bool = False) -> Dict[str, Any]:
        """
        Evaluates the 4 strict conditions for opening a ticket for an incident.
        Uses Cache-First architecture by default (reads from Redis cache populated by periodic tasks).
        Returns a dictionary with overall eligibility, condition details, and reasons.
        """
        now = timezone.now()

        # -------------------------------------------------------------
        # Condition 1 & 2: IPGET API 1 Alarm & Circuit ID check (Cache-First)
        # -------------------------------------------------------------
        alarms = self.ipget.fetch_interface_alarms(interval_hour=72, prefer_cache=True, force_refresh=force_refresh)
        ip_index, name_index = self.ipget.build_alarm_index(alarms) if alarms else ({}, {})

        matched_alarm = None
        if incident.primary_device:
            matched_alarm = self.ipget.match_alarm(
                ip_index, name_index,
                device_ip=incident.primary_device.management_ip,
                port_name=incident.interface_name,
                device_name=incident.primary_device.name
            )

        # 1. Confirmed down info from IPGET API 1
        cond_ipget_confirmed = matched_alarm is not None

        # 2. Circuit ID from IPGET API 1
        circuit_id = ''
        if matched_alarm:
            circuit_id = (matched_alarm.get('cat_id') or matched_alarm.get('interface_cat_id') or '').strip()
        if not circuit_id and incident.circuit_id:
            circuit_id = incident.circuit_id.strip()

        cond_has_circuit_id = bool(circuit_id)

        # -------------------------------------------------------------
        # Condition 3: Sustained down >= 15 minutes (900 seconds)
        # -------------------------------------------------------------
        downtime_sec = incident.downtime_seconds or 0
        if incident.down_time:
            calculated_sec = int((now - incident.down_time).total_seconds())
            if calculated_sec > downtime_sec:
                downtime_sec = calculated_sec

        cond_sustained_15m = downtime_sec >= SUSTAINED_DOWN_SECONDS
        remaining_sec = max(0, SUSTAINED_DOWN_SECONDS - downtime_sec)

        # -------------------------------------------------------------
        # Condition 4: No existing ticket already opened (Self or Active Peer)
        # -------------------------------------------------------------
        existing_ticket = (incident.ticket_id_tss or '').strip()
        if not existing_ticket and circuit_id:
            peer_inc = self.find_active_circuit_tts_ticket(circuit_id, exclude_incident_id=incident.id)
            if peer_inc and peer_inc.ticket_id_tss:
                existing_ticket = peer_inc.ticket_id_tss.strip()
                # Auto-link from peer if this incident is active
                if incident.status in IncidentStatus.ACTIVE_STATUSES:
                    incident.ticket_id_tss = existing_ticket
                    incident.tts_status = peer_inc.tts_status or 'Open'
                    up_fields = ['ticket_id_tss', 'tts_status', 'updated_at']
                    if not incident.circuit_id and circuit_id:
                        incident.circuit_id = circuit_id
                        up_fields.append('circuit_id')
                    if peer_inc.repair_team and not incident.repair_team:
                        incident.repair_team = peer_inc.repair_team
                        up_fields.append('repair_team')
                    incident.save(update_fields=up_fields)
                    incident.add_timeline_entry(
                        event_type=TimelineEventType.TICKET_LINKED,
                        source='NT_TTS_PEER_SYNC',
                        description=f"Auto-linked Trouble Ticket {existing_ticket} from peer circuit incident {peer_inc.incident_number}",
                        data={'ticket_id_tss': existing_ticket, 'circuit_id': circuit_id, 'peer_incident': peer_inc.incident_number},
                    )

        has_existing_db = bool(existing_ticket)
        cond_no_existing_ticket = not has_existing_db

        # Overall decision
        is_eligible = (
            cond_ipget_confirmed and
            cond_has_circuit_id and
            cond_sustained_15m and
            cond_no_existing_ticket
        )

        reasons = []
        if not cond_ipget_confirmed:
            reasons.append("ยังไม่พบข้อมูลยืนยัน Down จาก API IPGET (API 1)")
        if not cond_has_circuit_id:
            reasons.append("ยังไม่พบ Circuit ID (CAT ID) จาก API IPGET (API 1)")
        if not cond_sustained_15m:
            minutes_left = (remaining_sec + 59) // 60
            reasons.append(f"ยัง Down ไม่ต่อเนื่องครบ 15 นาที (ปัจจุบัน {downtime_sec // 60} นาที, เหลืออีก {minutes_left} นาที)")
        if not cond_no_existing_ticket:
            reasons.append(f"มีการเปิด Ticket แล้วในระบบ ({existing_ticket})")

        return {
            "is_eligible": is_eligible,
            "circuit_id": circuit_id,
            "downtime_seconds": downtime_sec,
            "remaining_seconds": remaining_sec,
            "conditions": {
                "ipget_confirmed": {
                    "passed": cond_ipget_confirmed,
                    "label": "ยืนยัน Down จาก IPGET API 1",
                    "details": matched_alarm.get('name') if matched_alarm else None
                },
                "has_circuit_id": {
                    "passed": cond_has_circuit_id,
                    "label": "มี Circuit ID จาก IPGET API 1",
                    "details": circuit_id or None
                },
                "sustained_15m": {
                    "passed": cond_sustained_15m,
                    "label": "Down ต่อเนื่อง >= 15 นาที",
                    "current_minutes": downtime_sec // 60,
                    "required_minutes": 15,
                    "remaining_seconds": remaining_sec
                },
                "no_existing_ticket": {
                    "passed": cond_no_existing_ticket,
                    "label": "ยังไม่มีการเปิด Ticket",
                    "existing_ticket": existing_ticket or None
                }
            },
            "reasons": reasons,
            "matched_alarm": matched_alarm
        }

    def build_ticket_description(self, incident: Incident, matched_alarm: Optional[dict] = None, circuit_id: str = "") -> str:
        """
        Builds the standard structured description text for opening a ticket on NT TTS.
        """
        cid = circuit_id or incident.circuit_id or ""
        bw = ""
        src_node = incident.primary_device.name if incident.primary_device else ""
        src_ip = incident.primary_device.management_ip if incident.primary_device else ""
        src_port = incident.interface_name or ""
        src_loc = incident.site_name or ""

        dest_node = incident.remote_device or ""
        dest_ip = ""
        dest_port = incident.remote_interface or ""
        dest_loc = ""

        if matched_alarm:
            raw_bw = matched_alarm.get('bandwidth') or matched_alarm.get('bw') or ""
            if raw_bw:
                try:
                    val = float(raw_bw)
                    bw = f"{int(val) if val.is_integer() else val} Gbps"
                except Exception:
                    bw = f"{raw_bw} Gbps" if "bps" not in str(raw_bw) else str(raw_bw)

            if not cid:
                cid = matched_alarm.get('cat_id') or matched_alarm.get('interface_cat_id') or ""
            if matched_alarm.get('nodename'):
                src_node = matched_alarm.get('nodename')
            if matched_alarm.get('ip_address'):
                src_ip = matched_alarm.get('ip_address')
            if matched_alarm.get('name'):
                src_port = matched_alarm.get('name')
            if not src_loc or src_loc == matched_alarm.get('site_name'):
                src_loc = matched_alarm.get('site_name') or matched_alarm.get('source_site') or src_loc

            dest_node = matched_alarm.get('destname') or dest_node
            dest_port = matched_alarm.get('destport') or dest_port
            dest_ip = matched_alarm.get('dest_ip') or matched_alarm.get('destip') or ""
            dest_loc = matched_alarm.get('dest_site') or matched_alarm.get('destsite') or matched_alarm.get('dest_location') or ""

        bw_line = f"    Bandwidth : {bw}\n" if bw else ""

        # Enrich Location with GPS coordinates & Site details from NTSite API (/ntsite/data/site)
        src_site_id = (matched_alarm.get('site_id') if matched_alarm else None)
        dest_site_id = (matched_alarm.get('dest_site_id') if matched_alarm else None)

        src_site_info = self.ipget.fetch_site_info(src_site_id) if src_site_id else None
        dest_site_info = self.ipget.fetch_site_info(dest_site_id) if dest_site_id else None

        # Build Source Location
        if src_site_info and src_site_info.get('latitude') and src_site_info.get('longitude'):
            src_coords = f"{src_site_info['latitude']}, {src_site_info['longitude']}"
            parts = []
            s_name = src_site_info.get('site_name') or src_loc
            s_class = src_site_info.get('class')
            if s_name:
                parts.append(f"{s_name}" + (f" [Class {s_class}]" if s_class else ""))
            if src_site_info.get('full_address'):
                parts.append(src_site_info['full_address'])
            if src_site_info.get('unmanned'):
                parts.append("[Unmanned Site]")
            detail_line = f"\n    ({', '.join(parts)})" if parts else ""
            src_loc_str = f"{src_coords}{detail_line}"
        else:
            src_loc_str = src_loc

        # Build Destination Location
        if dest_site_info and dest_site_info.get('latitude') and dest_site_info.get('longitude'):
            dest_coords = f"{dest_site_info['latitude']}, {dest_site_info['longitude']}"
            parts = []
            d_name = dest_site_info.get('site_name') or dest_loc
            d_class = dest_site_info.get('class')
            if d_name:
                parts.append(f"{d_name}" + (f" [Class {d_class}]" if d_class else ""))
            if dest_site_info.get('full_address'):
                parts.append(dest_site_info['full_address'])
            if dest_site_info.get('unmanned'):
                parts.append("[Unmanned Site]")
            detail_line = f"\n    ({', '.join(parts)})" if parts else ""
            dest_loc_str = f"{dest_coords}{detail_line}"
        else:
            dest_loc_str = dest_loc

        desc = (
            f"พบ Link Down  CAT ID : {cid} รบกวนตรวจสอบครับ\n"
            f"{bw_line}"
            f"    ข้อมูลต้นทาง\n"
            f"    Node name : {src_node}\n"
            f"    IP : {src_ip}\n"
            f"    Interface : {src_port}\n"
            f"    Location : {src_loc_str}\n"
            f"    !\n"
            f"    ข้อมูลปลายทาง\n"
            f"    Node name : {dest_node}\n"
            f"    IP : {dest_ip}\n"
            f"    Interface : {dest_port}\n"
            f"    Location : {dest_loc_str}"
        )
        return desc.strip()
