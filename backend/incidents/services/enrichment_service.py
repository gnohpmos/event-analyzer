"""
Domain service for enriching Incidents with IPGET alarms,
site metadata, and Trouble Ticket System (TTS) work order details.
"""
import logging
import re
from datetime import timedelta
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

    def enrich_pending_incidents(self, interval_hour: int = 24) -> dict:
        """
        Processes all pending active incidents created within the last 24h
        that do not yet have a ticket_id_tss linked.
        """
        cutoff = timezone.now() - timedelta(hours=interval_hour)
        pending_incidents = (
            Incident.objects
            .filter(Q(ticket_id_tss='') | Q(ticket_id_tss__isnull=True))
            .filter(Q(status__in=IncidentStatus.ACTIVE_STATUSES) | Q(created_at__gte=cutoff))
            .select_related('primary_device')
        )

        count = pending_incidents.count()
        if count == 0:
            return {"status": "skipped", "reason": "No pending incidents requiring ticket sync"}

        updated_count = 0
        link_incidents = [inc for inc in pending_incidents if inc.incident_type == IncidentType.LINK]
        device_incidents = [inc for inc in pending_incidents if inc.incident_type == IncidentType.DEVICE]

        # 1. Process LINK Incidents with cached alarm index
        if link_incidents:
            alarms = self.client.fetch_interface_alarms(interval_hour=interval_hour)
            ip_index, name_index = self.client.build_alarm_index(alarms) if alarms else ({}, {})

            for inc in link_incidents:
                changed = self._enrich_link_with_index(inc, ip_index, name_index)
                if changed:
                    changed.append('updated_at')
                    inc.save(update_fields=list(set(changed)))
                    updated_count += 1

            # Phase 2 for LINK incidents: Query TTS by Circuit NTID
            still_pending = [inc for inc in link_incidents if not inc.ticket_id_tss]
            if still_pending:
                updated_count += self._sync_tts_by_circuits(still_pending)

        # 2. Process DEVICE Incidents
        if device_incidents:
            for inc in device_incidents:
                changed = self._enrich_device_incident(inc)
                if changed:
                    changed.append('updated_at')
                    inc.save(update_fields=list(set(changed)))
                    updated_count += 1

        return {
            "status": "success",
            "pending_count": count,
            "updated_count": updated_count
        }

    def enrich_single_incident(self, incident_id: int, interval_hour: int = 72) -> dict:
        """
        On-demand enrichment for a single incident (triggered from UI modal or API).
        Always refreshes latest TTS work order status, repair team, and actual cause.
        """
        try:
            inc = Incident.objects.select_related('primary_device').get(id=incident_id)
        except Incident.DoesNotExist:
            return {"status": "error", "message": "Incident not found"}

        changed_fields = []
        if inc.incident_type == IncidentType.LINK:
            changed_fields = self._enrich_single_link(inc, interval_hour=interval_hour)
        else:
            changed_fields = self._enrich_device_incident(inc)

        if changed_fields:
            changed_fields = list(set(changed_fields))
            changed_fields.append('updated_at')
            inc.save(update_fields=changed_fields)
            return {
                "status": "updated",
                "ticket_id_tss": inc.ticket_id_tss,
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

    def _enrich_single_link(self, inc: Incident, interval_hour: int = 72) -> List[str]:
        """Fetches interface alarms and TTS ticket for a single link incident."""
        changed_fields: List[str] = []

        # 1. Check Interface Alarms
        alarms = self.client.fetch_interface_alarms(interval_hour=interval_hour)
        if alarms:
            ip_index, name_index = self.client.build_alarm_index(alarms)
            changed_fields.extend(self._enrich_link_with_index(inc, ip_index, name_index))

        # 2. Query TTS by Circuit ID
        cid = self._resolve_circuit_id(inc)
        if cid:
            tts_list = self.client.fetch_tts_by_ntids([cid])
            if tts_list and tts_list[0].get('INCIDENT_ID'):
                tts_info = self.client.extract_tts_info(tts_list[0])
                changed_fields.extend(self._apply_tts_info(inc, tts_info, source='TTS_SYNC'))

        return changed_fields

    def _sync_tts_by_circuits(self, incidents: List[Incident]) -> int:
        """Batch queries TTS by circuit IDs for pending link incidents."""
        ntid_map: Dict[str, Incident] = {}
        for inc in incidents:
            cid = self._resolve_circuit_id(inc)
            if cid:
                ntid_map[cid] = inc

        if not ntid_map:
            return 0

        tts_records = self.client.fetch_tts_by_ntids(list(ntid_map.keys()))
        updated_count = 0
        for record in tts_records:
            cat_id = record.get('CATID')
            t_id = record.get('INCIDENT_ID')
            if cat_id in ntid_map and t_id:
                inc = ntid_map[cat_id]
                if not inc.ticket_id_tss:
                    tts_info = self.client.extract_tts_info(record)
                    changed = self._apply_tts_info(inc, tts_info, source='TTS_SYNC')
                    if changed:
                        changed.append('updated_at')
                        inc.save(update_fields=list(set(changed)))
                        updated_count += 1
                        logger.info(f"TTS_SYNC_SUCCESS: Link Incident {inc.incident_number} linked to ticket {t_id}")

        return updated_count

    # -------------------------------------------------------------------------
    # Private Helpers - DEVICE Incidents
    # -------------------------------------------------------------------------

    def _enrich_device_incident(self, inc: Incident) -> List[str]:
        """Enriches a device incident with ping alarm site info and TTS ticket."""
        changed_fields: List[str] = []
        dev_ip = inc.primary_device.management_ip
        dev_name = inc.primary_device.name
        sys_name = getattr(inc.primary_device, 'sys_name', '')

        # A. Ping Alarm Site Info
        ping_info = self.client.fetch_node_ping_info(device_ip=dev_ip, device_name=dev_name)
        if ping_info and ping_info.get('site_name'):
            if inc.site_name != ping_info['site_name']:
                inc.site_name = ping_info['site_name']
                changed_fields.append('site_name')

        # B. TTS Ticket by Device IP / Hostname Candidates
        tts_info = self.client.fetch_tts_for_device(device_ip=dev_ip, device_name=dev_name, sys_name=sys_name)
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

        return changed

    def _apply_tts_info(self, inc: Incident, tts_info: dict, source: str = 'TTS_SYNC') -> List[str]:
        """Applies trouble ticket attributes from TTS listNTID response."""
        changed: List[str] = []
        t_id = tts_info.get('ticket_id_tss')

        if t_id and not inc.ticket_id_tss:
            inc.ticket_id_tss = t_id
            changed.append('ticket_id_tss')
            inc.add_timeline_entry(
                event_type=TimelineEventType.TICKET_LINKED,
                source=source,
                description=f"Trouble Ticket {t_id} linked from TTS ({tts_info.get('tts_status', '')})",
                data={'ticket_id_tss': t_id, 'tts_info': tts_info},
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
