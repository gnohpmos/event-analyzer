"""
Domain service for enriching Incidents with IPGET alarms,
site metadata, and Trouble Ticket System (TTS) work order details.
"""
import logging
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Dict, List, Optional, Tuple

from django.db.models import Q
from django.utils import timezone

from common.constants import (
    IncidentStatus, IncidentType, TimelineEventType
)
from incidents.models import Incident
from integrations.ipget import IPGETClient

logger = logging.getLogger(__name__)


class IncidentEnrichmentService:
    """
    Coordinates data enrichment for LINK and DEVICE incidents from IPGET and TTS APIs.
    Decouples business logic, alarm matching, and model updates from Celery background tasks.
    """

    def __init__(self, ipget_client: Optional[IPGETClient] = None):
        self.client = ipget_client or IPGETClient()

    def enrich_pending_incidents(self, interval_hour: int = 72) -> dict:
        """
        Cache Master Periodic Task (every 2 minutes):
        1. Unconditionally refreshes interface alarms and node alarms from IPGET into Redis cache (force_refresh=True).
        2. Enriches any pending LINK and DEVICE incidents that require ticket sync.
        """
        import time

        # 1. Unconditionally refresh Redis cache from IPGET as Cache Master
        interface_alarms = []
        try:
            interface_alarms = self.client.fetch_interface_alarms(
                interval_hour=interval_hour, force_refresh=True
            )
            logger.info(f"CACHE_MASTER: Refreshed {len(interface_alarms)} interface alarms into Redis cache")
        except Exception as e:
            logger.warning(f"CACHE_MASTER: Failed to refresh interface alarms: {e}")
            interface_alarms = self.client.fetch_interface_alarms(interval_hour=interval_hour, prefer_cache=True)

        # Brief pause between IPGET calls to prevent burst rate-limits
        time.sleep(1)

        try:
            node_alarms = self.client.fetch_node_alarms(
                interval_hour=interval_hour, force_refresh=True
            )
            logger.info(f"CACHE_MASTER: Refreshed {len(node_alarms)} node ping alarms into Redis cache")
        except Exception as e:
            logger.warning(f"CACHE_MASTER: Failed to refresh node ping alarms: {e}")

        # 2. Process pending and active incidents
        cutoff = timezone.now() - timedelta(hours=interval_hour)
        pending_incidents = (
            Incident.objects
            .filter(
                Q(ticket_id_tss='') | Q(ticket_id_tss__isnull=True) | Q(ticket_id_tss__startswith='IM')
                | Q(status__in=IncidentStatus.ACTIVE_STATUSES)
            )
            .filter(Q(status__in=IncidentStatus.ACTIVE_STATUSES) | Q(created_at__gte=cutoff))
            .select_related('primary_device')
        )

        count = pending_incidents.count()
        if count == 0:
            return {
                "status": "success",
                "cache_refreshed": True,
                "alarms_count": len(interface_alarms),
                "reason": "Cache refreshed successfully; no pending incidents requiring ticket sync"
            }

        updated_count = 0
        link_incidents = [inc for inc in pending_incidents if inc.incident_type == IncidentType.LINK]
        device_incidents = [inc for inc in pending_incidents if inc.incident_type == IncidentType.DEVICE]

        # Process LINK Incidents with the alarm index built from fresh alarms
        if link_incidents:
            ip_index, name_index = self.client.build_alarm_index(interface_alarms) if interface_alarms else ({}, {})

            for inc in link_incidents:
                changed = self._enrich_link_with_index(inc, ip_index, name_index)
                if changed:
                    changed.append('updated_at')
                    inc.save(update_fields=list(set(changed)))
                    updated_count += 1

            # Phase 2 for LINK incidents: Query TTS by Circuit NTID (refresh active tickets too)
            still_pending = [
                inc for inc in link_incidents
                if not inc.ticket_id_tss
                or inc.ticket_id_tss.startswith('IM')
                or inc.status in IncidentStatus.ACTIVE_STATUSES
            ]
            if still_pending:
                updated_count += self._sync_tts_by_circuits(still_pending, force_refresh=True)

            # Phase 2.5 for LINK incidents: Sync NT TTS ticket from Peer incidents on same circuit
            active_links_without_tts = Incident.objects.filter(
                incident_type=IncidentType.LINK,
                status__in=IncidentStatus.ACTIVE_STATUSES,
                ticket_id_tss=''
            ).exclude(circuit_id='')
            for inc in active_links_without_tts:
                cid = self._resolve_circuit_id(inc)
                if not cid:
                    continue
                peer_tts = (
                    Incident.objects
                    .filter(circuit_id=cid, status__in=IncidentStatus.ACTIVE_STATUSES)
                    .exclude(id=inc.id)
                    .exclude(ticket_id_tss='')
                    .exclude(tts_status__in=['Complete', 'Closed', 'Resolved', 'Rejected', 'Cancelled', 'Cancel'])
                    .first()
                )
                if peer_tts and peer_tts.ticket_id_tss:
                    inc.ticket_id_tss = peer_tts.ticket_id_tss
                    inc.tts_status = peer_tts.tts_status or 'Open'
                    up_fields = ['ticket_id_tss', 'tts_status', 'updated_at']
                    if peer_tts.repair_team and not inc.repair_team:
                        inc.repair_team = peer_tts.repair_team
                        up_fields.append('repair_team')
                    inc.save(update_fields=up_fields)
                    inc.add_timeline_entry(
                        event_type=TimelineEventType.TICKET_LINKED,
                        source='NT_TTS_PEER_SYNC',
                        description=f"Auto-linked Trouble Ticket {peer_tts.ticket_id_tss} from peer circuit incident {peer_tts.incident_number}",
                        data={'ticket_id_tss': peer_tts.ticket_id_tss, 'circuit_id': cid, 'peer_incident': peer_tts.incident_number}
                    )
                    updated_count += 1
                    logger.info(f"TTS_PEER_AUTO_SYNC: Linked NT TTS {peer_tts.ticket_id_tss} to {inc.incident_number}")

            # Phase 3 for LINK incidents: Sync osTicket from Peer incidents
            active_links_without_osticket = Incident.objects.filter(
                incident_type=IncidentType.LINK,
                status__in=IncidentStatus.ACTIVE_STATUSES,
                ticket_id_osticket=''
            ).exclude(circuit_id='')
            for inc in active_links_without_osticket:
                cid = self._resolve_circuit_id(inc)
                if not cid:
                    continue
                peer_ticket = Incident.objects.filter(
                    circuit_id=cid,
                    status__in=IncidentStatus.ACTIVE_STATUSES
                ).exclude(id=inc.id).exclude(ticket_id_osticket='').values_list('ticket_id_osticket', flat=True).first()
                if peer_ticket:
                    inc.ticket_id_osticket = peer_ticket
                    inc.osticket_status = 'Open'
                    inc.save(update_fields=['ticket_id_osticket', 'osticket_status', 'updated_at'])
                    inc.add_timeline_entry(
                        event_type=TimelineEventType.OSTICKET_LINKED,
                        source='CIRCUIT_SYNC',
                        description=f"Auto-linked osTicket {peer_ticket} from peer circuit incident",
                        data={'ticket_id_osticket': peer_ticket, 'circuit_id': cid}
                    )
                    updated_count += 1
                    logger.info(f"OSTICKET_AUTO_SYNC: Linked osTicket {peer_ticket} to {inc.incident_number}")

        # Process DEVICE Incidents
        if device_incidents:
            for inc in device_incidents:
                changed = self._enrich_device_incident(inc, force_refresh=False)
                if changed:
                    changed.append('updated_at')
                    inc.save(update_fields=list(set(changed)))
                    updated_count += 1

        return {
            "status": "success",
            "cache_refreshed": True,
            "alarms_count": len(interface_alarms),
            "pending_count": count,
            "updated_count": updated_count
        }

    def enrich_single_incident(self, incident_id: int, interval_hour: int = 72, force_refresh: bool = False) -> dict:
        """
        On-demand enrichment for a single incident (triggered from UI modal or API).
        Defaults to Cache-First (prefer_cache=True) using Redis cache populated by periodic background tasks.
        """
        try:
            inc = Incident.objects.select_related('primary_device').get(id=incident_id)
        except Incident.DoesNotExist:
            return {"status": "error", "message": "Incident not found"}

        changed_fields = []
        if inc.incident_type == IncidentType.LINK:
            changed_fields = self._enrich_single_link(inc, interval_hour=interval_hour, force_refresh=force_refresh)
        else:
            changed_fields = self._enrich_device_incident(inc, force_refresh=force_refresh)

        if changed_fields:
            changed_fields = list(set(changed_fields))
            changed_fields.append('updated_at')
            inc.save(update_fields=changed_fields)
            return {
                "status": "updated",
                "ticket_id_tss": inc.ticket_id_tss,
                "ticket_id_osticket": inc.ticket_id_osticket,
                "osticket_status": inc.osticket_status,
                "circuit_id": inc.circuit_id,
                "site_name": inc.site_name,
                "tts_status": inc.tts_status,
                "repair_team": inc.repair_team,
                "actual_cause": inc.actual_cause,
                "resolution": inc.resolution,
                "fields": changed_fields
            }

        return {
            "status": "checked_no_changes",
            "ticket_id_tss": inc.ticket_id_tss,
            "ticket_id_osticket": inc.ticket_id_osticket,
            "osticket_status": inc.osticket_status,
            "tts_status": inc.tts_status,
            "site_name": inc.site_name
        }

    # -------------------------------------------------------------------------
    # Private Helpers - LINK Incidents
    # -------------------------------------------------------------------------

    def _enrich_link_with_index(
        self,
        inc: Incident,
        ip_index: Dict[Tuple[str, str], dict],
        name_index: Dict[Tuple[str, str], dict]
    ) -> List[str]:
        """Matches a link incident against pre-indexed alarms and applies metadata."""
        if not ip_index and not name_index:
            return []

        matched = self.client.match_alarm(
            ip_index, name_index,
            device_ip=inc.primary_device.management_ip,
            port_name=inc.interface_name,
            device_name=inc.primary_device.name
        )
        if not matched:
            return []

        return self._apply_alarm_match(inc, matched)

    def _enrich_single_link(self, inc: Incident, interval_hour: int = 72, force_refresh: bool = False) -> List[str]:
        """Fetches interface alarms and TTS ticket for a single link incident with Cache-First lookup."""
        changed_fields: List[str] = []

        # 1. Check Interface Alarms (Cache-First)
        alarms = self.client.fetch_interface_alarms(
            interval_hour=interval_hour, prefer_cache=(not force_refresh), force_refresh=force_refresh
        )
        if alarms:
            ip_index, name_index = self.client.build_alarm_index(alarms)
            changed_fields.extend(self._enrich_link_with_index(inc, ip_index, name_index))

        # 2. Query TTS by Circuit ID (Cache-First, supporting composite IDs)
        cid = self._resolve_circuit_id(inc)
        if cid:
            candidates = [p.strip() for p in re.split(r'[+,/;\s]+', cid) if p.strip()]
            if cid not in candidates:
                candidates.append(cid)
            tts_list = self.client.fetch_tts_by_ntids(candidates, prefer_cache=(not force_refresh), force_refresh=force_refresh)
            if tts_list and tts_list[0].get('INCIDENT_ID'):
                candidate = tts_list[0]
                if not self._is_stale_ticket(inc, candidate):
                    tts_info = self.client.extract_tts_info(candidate)
                    changed_fields.extend(self._apply_tts_info(inc, tts_info, source='TTS_SYNC'))
                elif inc.ticket_id_tss == candidate.get('INCIDENT_ID'):
                    inc.ticket_id_tss = ''
                    inc.tts_status = ''
                    inc.repair_team = ''
                    changed_fields.extend(['ticket_id_tss', 'tts_status', 'repair_team'])
                    logger.info(f"TTS_UNLINK_STALE: Cleared stale ticket {candidate.get('INCIDENT_ID')} from {inc.incident_number}")

            # 2.5 Fallback: Check active peer incident for NT TTS ticket
            if not inc.ticket_id_tss:
                peer_tts = (
                    Incident.objects
                    .filter(circuit_id__in=candidates, status__in=IncidentStatus.ACTIVE_STATUSES)
                    .exclude(id=inc.id)
                    .exclude(ticket_id_tss='')
                    .exclude(tts_status__in=['Complete', 'Closed', 'Resolved', 'Rejected', 'Cancelled', 'Cancel'])
                    .first()
                )
                if peer_tts and peer_tts.ticket_id_tss:
                    inc.ticket_id_tss = peer_tts.ticket_id_tss
                    inc.tts_status = peer_tts.tts_status or 'Open'
                    changed_fields.extend(['ticket_id_tss', 'tts_status'])
                    if peer_tts.repair_team and not inc.repair_team:
                        inc.repair_team = peer_tts.repair_team
                        changed_fields.append('repair_team')
                    inc.add_timeline_entry(
                        event_type=TimelineEventType.TICKET_LINKED,
                        source='NT_TTS_PEER_SYNC',
                        description=f"Auto-linked Trouble Ticket {peer_tts.ticket_id_tss} from peer circuit incident {peer_tts.incident_number}",
                        data={'ticket_id_tss': peer_tts.ticket_id_tss, 'circuit_id': cid, 'peer_incident': peer_tts.incident_number}
                    )

        # 3. Query / Sync osTicket from Peer Incident or osTicket Search
        cid = self._resolve_circuit_id(inc)
        tts_id = (inc.ticket_id_tss or '').strip()
        if not inc.ticket_id_osticket and (cid or tts_id):
            peer_query = Q()
            if cid:
                peer_query |= Q(circuit_id=cid)
            if tts_id:
                peer_query |= Q(ticket_id_tss=tts_id)

            peer = (
                Incident.objects
                .filter(peer_query, status__in=IncidentStatus.ACTIVE_STATUSES)
                .exclude(id=inc.id)
                .exclude(ticket_id_osticket='')
                .first()
            )
            if peer and peer.ticket_id_osticket:
                inc.ticket_id_osticket = peer.ticket_id_osticket
                inc.osticket_status = peer.osticket_status or 'Open'
                changed_fields.extend(['ticket_id_osticket', 'osticket_status'])
                inc.add_timeline_entry(
                    event_type=TimelineEventType.OSTICKET_LINKED,
                    source='CIRCUIT_SYNC',
                    description=f"Auto-linked osTicket {peer.ticket_id_osticket} from peer circuit incident {peer.incident_number}",
                    data={'ticket_id_osticket': peer.ticket_id_osticket, 'circuit_id': cid, 'peer_incident': peer.incident_number}
                )
                logger.info(
                    f"OSTICKET_PEER_SYNC: Auto-linked osTicket {peer.ticket_id_osticket} "
                    f"to {inc.incident_number} from peer {peer.incident_number}"
                )
            elif tts_id:
                try:
                    from integrations.osticket import OSTicketSearcher
                    searcher = OSTicketSearcher()
                    remote = searcher.find_ticket_by_tts(tts_id)
                    if remote and remote.get('ticket_number'):
                        rem_num = remote['ticket_number']
                        inc.ticket_id_osticket = rem_num
                        inc.osticket_status = 'Open'
                        changed_fields.extend(['ticket_id_osticket', 'osticket_status'])
                        inc.add_timeline_entry(
                            event_type=TimelineEventType.OSTICKET_LINKED,
                            source='OSTICKET_GATEWAY',
                            description=f"Discovered and linked existing osTicket {rem_num} (CAT TTS: {tts_id})",
                            data={'ticket_id_osticket': rem_num, 'cat_tts': tts_id, 'circuit_id': cid}
                        )
                        logger.info(f"OSTICKET_REMOTE_SYNC: Discovered osTicket {rem_num} for {inc.incident_number}")
                except Exception as e:
                    logger.debug(f"OSTicket search check failed in enrichment: {e}")

        return changed_fields

    @staticmethod
    def _is_stale_ticket(inc: Incident, candidate: dict) -> bool:
        """Checks if a completed TTS ticket occurred > 6 hours before the incident down_time."""
        cand_status = candidate.get('IM_STATUS', '')
        cand_fault = candidate.get('FAULT_DATE')
        if cand_status in ['Complete', 'Closed', 'Resolved', 'Rejected', 'Cancelled', 'Cancel'] and cand_fault and inc.down_time:
            try:
                cand_dt = datetime.fromisoformat(cand_fault.replace('Z', '+00:00'))
                if cand_dt.tzinfo is None:
                    cand_dt = cand_dt.replace(tzinfo=ZoneInfo('Asia/Bangkok'))
                if (inc.down_time - cand_dt).total_seconds() > 21600:
                    logger.info(
                        f"TTS_SKIP_STALE: Skipping stale completed ticket {candidate.get('INCIDENT_ID')} "
                        f"(fault date {cand_fault}) for incident {inc.incident_number} (down {inc.down_time})"
                    )
                    return True
            except Exception as e:
                logger.warning(f"Error parsing candidate fault date {cand_fault}: {e}")
        return False

    def _sync_tts_by_circuits(self, incidents: List[Incident], force_refresh: bool = False) -> int:
        """Batch queries TTS by circuit IDs for pending and active link incidents."""
        from collections import defaultdict
        ntid_map: Dict[str, List[Incident]] = defaultdict(list)
        for inc in incidents:
            cid = self._resolve_circuit_id(inc)
            if cid:
                parts = [p.strip() for p in re.split(r'[+,/;\s]+', cid) if p.strip()]
                if cid not in parts:
                    parts.append(cid)
                for p in parts:
                    if inc not in ntid_map[p]:
                        ntid_map[p].append(inc)

        if not ntid_map:
            return 0

        tts_records = self.client.fetch_tts_by_ntids(
            list(ntid_map.keys()),
            prefer_cache=(not force_refresh),
            force_refresh=force_refresh,
        )
        updated_count = 0
        for record in tts_records:
            cat_id = record.get('CATID')
            t_id = record.get('INCIDENT_ID')
            if cat_id in ntid_map and t_id:
                inc_list = ntid_map[cat_id]
                tts_info = self.client.extract_tts_info(record)
                for inc in inc_list:
                    if self._is_stale_ticket(inc, record):
                        if inc.ticket_id_tss == t_id:
                            inc.ticket_id_tss = ''
                            inc.tts_status = ''
                            inc.repair_team = ''
                            inc.save(update_fields=['ticket_id_tss', 'tts_status', 'repair_team', 'updated_at'])
                            updated_count += 1
                            logger.info(f"TTS_UNLINK_STALE: Cleared stale ticket {t_id} from active incident {inc.incident_number}")
                        continue
                    changed = self._apply_tts_info(inc, tts_info, source='TTS_SYNC')
                    if changed:
                        changed.append('updated_at')
                        inc.save(update_fields=list(set(changed)))
                        updated_count += 1
                        logger.info(f"TTS_SYNC_SUCCESS: Link Incident {inc.incident_number} linked/updated to ticket {t_id}")

        return updated_count

    # -------------------------------------------------------------------------
    # Private Helpers - DEVICE Incidents
    # -------------------------------------------------------------------------

    def _enrich_device_incident(self, inc: Incident, force_refresh: bool = False) -> List[str]:
        """Enriches a device incident with ping alarm site info and TTS ticket (Cache-First)."""
        changed_fields: List[str] = []
        dev_ip = inc.primary_device.management_ip
        dev_name = inc.primary_device.name
        sys_name = getattr(inc.primary_device, 'sys_name', '')

        # A. Ping Alarm Site Info (Cache-First)
        ping_info = self.client.fetch_node_ping_info(
            device_ip=dev_ip, device_name=dev_name, prefer_cache=(not force_refresh), force_refresh=force_refresh
        )
        if ping_info and ping_info.get('site_name'):
            if inc.site_name != ping_info['site_name']:
                inc.site_name = ping_info['site_name']
                changed_fields.append('site_name')

        # B. TTS Ticket by Device IP / Hostname Candidates (Cache-First)
        tts_info = self.client.fetch_tts_for_device(
            device_ip=dev_ip, device_name=dev_name, sys_name=sys_name, prefer_cache=(not force_refresh), force_refresh=force_refresh
        )
        if tts_info and tts_info.get('ticket_id_tss'):
            changed_fields.extend(self._apply_tts_info(inc, tts_info, source='TTS_DEVICE_SYNC'))

        return changed_fields

    # -------------------------------------------------------------------------
    # Mapping & Domain Mutation Helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _resolve_circuit_id(inc: Incident) -> str:
        """Resolves circuit ID from field or extracts from link_description."""
        if inc.circuit_id:
            return inc.circuit_id.strip()
        if inc.link_description:
            m = re.search(r'(TBB\d+|308\d+)', inc.link_description)
            if m:
                return m.group(1).strip()
        return ''

    def _apply_alarm_match(self, inc: Incident, matched: dict) -> List[str]:
        """Applies attributes extracted from IPGET interface alarm."""
        changed: List[str] = []
        ticket_id = (matched.get('ticket_id_tss') or '').strip()
        if ticket_id and not inc.ticket_id_tss:
            inc.ticket_id_tss = ticket_id
            changed.append('ticket_id_tss')
            inc.add_timeline_entry(
                event_type=TimelineEventType.TICKET_LINKED,
                source='IPGET_SYNC',
                description=f"Trouble Ticket {ticket_id} linked from TSS",
                data={'ticket_id_tss': ticket_id, 'ipget_alarm': matched},
            )

        cat_id = (matched.get('cat_id') or matched.get('interface_cat_id') or '').strip()
        if cat_id and not inc.circuit_id:
            inc.circuit_id = cat_id
            changed.append('circuit_id')

        destname = (matched.get('destname') or '').strip()
        if destname and not inc.remote_device:
            inc.remote_device = destname
            changed.append('remote_device')

        destport = (matched.get('destport') or '').strip()
        if destport and not inc.remote_interface:
            inc.remote_interface = destport
            changed.append('remote_interface')

        site = (matched.get('site_name') or '').strip()
        if site and not inc.site_name:
            inc.site_name = site
            changed.append('site_name')

        # Enrich source and destination GPS coordinates from NTSite API (/ntsite/data/site)
        src_site_id = matched.get('site_id')
        dest_site_id = matched.get('dest_site_id')
        if src_site_id and not inc.source_gps:
            src_info = self.client.fetch_site_info(src_site_id)
            if src_info and src_info.get('latitude') and src_info.get('longitude'):
                inc.source_gps = f"{src_info['latitude']}, {src_info['longitude']}"
                changed.append('source_gps')
                if not inc.site_name and src_info.get('site_name'):
                    inc.site_name = src_info.get('site_name')
                    changed.append('site_name')

        if dest_site_id and not inc.dest_gps:
            dest_info = self.client.fetch_site_info(dest_site_id)
            if dest_info and dest_info.get('latitude') and dest_info.get('longitude'):
                inc.dest_gps = f"{dest_info['latitude']}, {dest_info['longitude']}"
                changed.append('dest_gps')

        return changed

    def _apply_tts_info(self, inc: Incident, tts_info: dict, source: str = 'TTS_SYNC') -> List[str]:
        """Applies trouble ticket attributes from TTS listNTID response."""
        changed: List[str] = []
        t_id = tts_info.get('ticket_id_tss')
        new_status = tts_info.get('tts_status', '')

        is_upgrade = False
        if not inc.ticket_id_tss:
            is_upgrade = True
        elif inc.ticket_id_tss.startswith('IM') and t_id and t_id.startswith('SD'):
            is_upgrade = True
        elif t_id and inc.ticket_id_tss != t_id:
            # Upgrade if current ticket was completed/closed but incoming ticket is active
            if inc.tts_status in ['Complete', 'Closed', 'Resolved'] and new_status not in ['Complete', 'Closed', 'Resolved']:
                is_upgrade = True
                logger.info(
                    f"TTS_UPGRADE: Upgrading stale closed ticket {inc.ticket_id_tss} to active ticket {t_id} "
                    f"for incident {inc.incident_number}"
                )
            elif inc.status in IncidentStatus.ACTIVE_STATUSES and new_status == 'Work In Progress':
                is_upgrade = True
                logger.info(
                    f"TTS_UPGRADE: Upgrading ticket {inc.ticket_id_tss} to {t_id} (Work In Progress) "
                    f"for incident {inc.incident_number}"
                )

        if t_id and is_upgrade:
            old_id = inc.ticket_id_tss
            inc.ticket_id_tss = t_id
            changed.append('ticket_id_tss')
            inc.add_timeline_entry(
                event_type=TimelineEventType.TICKET_LINKED,
                source=source,
                description=f"Updated Trouble Ticket from {old_id} to latest active ticket {t_id} ({new_status})" if old_id else f"Trouble Ticket {t_id} linked from TTS ({new_status})",
                data={'ticket_id_tss': t_id, 'old_id': old_id, 'tts_info': tts_info},
            )

        cid = tts_info.get('circuit_id')
        if cid and not inc.circuit_id:
            inc.circuit_id = cid
            changed.append('circuit_id')

        # Update mutable fields (status, team, cause, resolution, GPS)
        mutable_fields = [
            'tts_status', 'repair_team', 'response_department',
            'actual_cause', 'resolution', 'source_gps', 'dest_gps'
        ]
        for field in mutable_fields:
            val = tts_info.get(field, '')
            if val and getattr(inc, field, '') != val:
                setattr(inc, field, val)
                changed.append(field)

        return changed
