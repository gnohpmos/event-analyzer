"""
Celery background tasks for Incidents Lifecycle, Flapping Soak Timer,
and automated SNMP verification.
"""
import logging
from celery import shared_task
from django.db import transaction
from django.utils import timezone

from common.constants import (
    IncidentStatus, TimelineEventType, Classification, Confidence, IncidentType
)
from incidents.models import Incident

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=5, default_retry_delay=60)
def check_link_soak_completion(self, incident_id: int):
    """
    Validates whether an incident in STABILIZING state has maintained
    continuous UP status for the full soak period (45 minutes).

    Safety:
    Uses select_for_update to avoid race conditions with incoming FLAP events.
    """
    try:
        with transaction.atomic():
            incident = (
                Incident.objects
                .select_for_update()
                .select_related('primary_device')
                .get(id=incident_id)
            )

            # If incident is no longer stabilizing (e.g. flapped and returned to FLAPPING/DOWN), abort
            if incident.status != IncidentStatus.STABILIZING:
                logger.info(
                    f"SOAK_TASK_SKIPPED: Incident {incident.incident_number} "
                    f"status is '{incident.status}' (no longer STABILIZING)"
                )
                return {"status": "skipped", "reason": f"Status is {incident.status}"}

            now = timezone.now()
            if not incident.soak_until:
                logger.warning(f"SOAK_TASK_ABORTED: Incident {incident.incident_number} has no soak_until")
                return {"status": "error", "reason": "No soak_until timestamp"}

            # Verify soak duration has fully elapsed
            if now < incident.soak_until:
                remaining_seconds = int((incident.soak_until - now).total_seconds()) + 2
                logger.info(
                    f"SOAK_TASK_RESCHEDULE: Incident {incident.incident_number} "
                    f"needs {remaining_seconds}s more"
                )
                check_link_soak_completion.apply_async(args=[incident_id], countdown=remaining_seconds)
                return {"status": "rescheduled", "remaining_seconds": remaining_seconds}

            # Soak timer successfully completed!
            incident.status = IncidentStatus.RECOVERED
            incident.up_time = incident.last_up_time or now

            # Determine RCA classification
            if incident.classification in (Classification.PARENT_DEVICE_DOWN, Classification.ADMIN_SHUTDOWN):
                pass  # Keep explicit parent or admin classification
            elif incident.flap_count >= 2:
                incident.classification = Classification.LINK_FLAPPING
                incident.confidence = Confidence.HIGH
            elif (incident.net_downtime_seconds or 0) >= 900:  # 15+ minutes sustained outage -> Physical Failure
                incident.classification = Classification.PHYSICAL_LINK_FAILURE
                incident.confidence = Confidence.HIGH
            else:  # Under 15 minutes isolated glitch -> Transient Glitch
                incident.classification = Classification.TRANSIENT_GLITCH
                incident.confidence = Confidence.HIGH

            incident.save(update_fields=[
                'status', 'up_time', 'classification', 'confidence', 'updated_at'
            ])

            # Record timeline entries
            incident.add_timeline_entry(
                event_type=TimelineEventType.SOAK_TIMER_COMPLETED,
                source='SYSTEM_ENGINE',
                description=(
                    f"Continuous UP soak period (45 mins) successfully completed. "
                    f"Interface [{incident.interface_name}] confirmed stable."
                ),
                data={
                    'soak_completed_at': now.isoformat(),
                    'flap_count': incident.flap_count,
                    'net_downtime_seconds': incident.net_downtime_seconds,
                },
                timestamp=now,
            )

            incident.add_timeline_entry(
                event_type=TimelineEventType.CLASSIFICATION_COMPLETED,
                source='CLASSIFICATION_ENGINE',
                description=f"Automated RCA classification: {incident.classification} ({incident.confidence})",
                data={'classification': incident.classification, 'confidence': incident.confidence},
                timestamp=now,
            )

            incident.add_timeline_entry(
                event_type=TimelineEventType.RECOVERED,
                source='SYSTEM_ENGINE',
                description=f"Incident {incident.incident_number} closed as RECOVERED.",
                data={'downtime_seconds': incident.downtime_seconds},
                timestamp=now,
            )

            logger.info(
                f"SOAK_COMPLETED: Incident {incident.incident_number} "
                f"RECOVERED classification={incident.classification}"
            )

            # Trigger optional SNMP IF-MIB verification
            try:
                from verification.tasks import verify_link_interface_task
                verify_link_interface_task.delay(incident.id)
            except Exception:
                pass

            return {
                "status": "success",
                "incident_number": incident.incident_number,
                "classification": incident.classification,
            }

    except Incident.DoesNotExist:
        logger.error(f"SOAK_TASK_ERROR: Incident id={incident_id} not found")
        return {"status": "error", "message": "Incident not found"}


@shared_task
def sync_pending_tss_tickets_task(interval_hour: int = 24):
    """
    Periodic task to check IPGET for any LINK or DEVICE incidents
    that do not yet have a TSS trouble ticket ID (ticket_id_tss).
    - For LINK incidents: queries /device/alarm/interface/ by (IP, Port) and /tts/data/open/listNTID by Circuit NTID.
    - For DEVICE incidents: queries /device/alarm/ping/ for site info and /tts/data/open/listNTID by Device IP/Hostname.
    Only checks active incidents or incidents created within the last 24 hours.
    Once ticket_id_tss is found, it is saved and background periodic polling stops.
    """
    from datetime import timedelta
    from django.db.models import Q
    from integrations.ipget import IPGETClient

    cutoff = timezone.now() - timedelta(hours=24)
    pending_incidents = (
        Incident.objects
        .filter(Q(ticket_id_tss='') | Q(ticket_id_tss__isnull=True))
        .filter(Q(status__in=IncidentStatus.ACTIVE_STATUSES) | Q(created_at__gte=cutoff))
        .select_related('primary_device')
    )

    count = pending_incidents.count()
    if count == 0:
        return {"status": "skipped", "reason": "No pending incidents requiring ticket sync"}

    client = IPGETClient()
    updated_count = 0

    link_incidents = [inc for inc in pending_incidents if inc.incident_type == IncidentType.LINK]
    device_incidents = [inc for inc in pending_incidents if inc.incident_type == IncidentType.DEVICE]

    # --- 1. Process LINK Incidents ---
    if link_incidents:
        alarms = client.fetch_interface_alarms(interval_hour=interval_hour)
        if alarms:
            ip_index, name_index = client.build_alarm_index(alarms)
            for inc in link_incidents:
                matched = client.match_alarm(
                    ip_index, name_index,
                    device_ip=inc.primary_device.management_ip,
                    port_name=inc.interface_name,
                    device_name=inc.primary_device.name
                )
                if not matched:
                    continue

                changed_fields = []
                ticket_id = (matched.get('ticket_id_tss') or '').strip()
                if ticket_id and not inc.ticket_id_tss:
                    inc.ticket_id_tss = ticket_id
                    changed_fields.append('ticket_id_tss')
                    inc.add_timeline_entry(
                        event_type=TimelineEventType.TICKET_LINKED,
                        source='IPGET_SYNC',
                        description=f"Trouble Ticket {ticket_id} linked from TSS",
                        data={'ticket_id_tss': ticket_id, 'ipget_alarm': matched},
                    )

                cat_id = (matched.get('cat_id') or matched.get('interface_cat_id') or '').strip()
                if cat_id and not inc.circuit_id:
                    inc.circuit_id = cat_id
                    changed_fields.append('circuit_id')

                destname = (matched.get('destname') or '').strip()
                if destname and not inc.remote_device:
                    inc.remote_device = destname
                    changed_fields.append('remote_device')

                destport = (matched.get('destport') or '').strip()
                if destport and not inc.remote_interface:
                    inc.remote_interface = destport
                    changed_fields.append('remote_interface')

                site = (matched.get('site_name') or '').strip()
                if site and not inc.site_name:
                    inc.site_name = site
                    changed_fields.append('site_name')

                if changed_fields:
                    changed_fields.append('updated_at')
                    inc.save(update_fields=changed_fields)
                    updated_count += 1

        # Phase 2 for LINK incidents: Query TTS by NTID
        still_pending_links = [inc for inc in link_incidents if not inc.ticket_id_tss]
        if still_pending_links:
            import re
            ntid_map = {}
            for inc in still_pending_links:
                cid = inc.circuit_id
                if not cid and inc.link_description:
                    m = re.search(r'(TBB\d+|308\d+)', inc.link_description)
                    if m:
                        cid = m.group(1)
                if cid:
                    ntid_map[cid] = inc

            if ntid_map:
                tts_records = client.fetch_tts_by_ntids(list(ntid_map.keys()))
                for record in tts_records:
                    cat_id = record.get('CATID')
                    t_id = record.get('INCIDENT_ID')
                    if cat_id in ntid_map and t_id:
                        inc = ntid_map[cat_id]
                        if not inc.ticket_id_tss:
                            tts_info = client.extract_tts_info(record)
                            inc.ticket_id_tss = t_id
                            inc.circuit_id = cat_id
                            inc.tts_status = tts_info.get('tts_status', '')
                            inc.repair_team = tts_info.get('repair_team', '')
                            inc.response_department = tts_info.get('response_department', '')
                            inc.actual_cause = tts_info.get('actual_cause', '')
                            inc.resolution = tts_info.get('resolution', '')
                            inc.source_gps = tts_info.get('source_gps', '')
                            inc.dest_gps = tts_info.get('dest_gps', '')
                            inc.add_timeline_entry(
                                event_type=TimelineEventType.TICKET_LINKED,
                                source='TTS_SYNC',
                                description=f"Trouble Ticket {t_id} linked from TTS ({tts_info.get('tts_status', '')})",
                                data={'ticket_id_tss': t_id, 'cat_id': cat_id, 'tts_info': tts_info},
                            )
                            inc.save(update_fields=[
                                'ticket_id_tss', 'circuit_id', 'tts_status', 'repair_team',
                                'response_department', 'actual_cause', 'resolution',
                                'source_gps', 'dest_gps', 'updated_at'
                            ])
                            updated_count += 1
                            logger.info(f"TTS_SYNC_SUCCESS: Link Incident {inc.incident_number} linked to ticket {t_id}")

    # --- 2. Process DEVICE Incidents ---
    if device_incidents:
        for inc in device_incidents:
            changed_fields = []
            dev_ip = inc.primary_device.management_ip
            dev_name = inc.primary_device.name
            sys_name = getattr(inc.primary_device, 'sys_name', '')

            # A. Check Ping Alarm for site info
            if not inc.site_name:
                ping_info = client.fetch_node_ping_info(device_ip=dev_ip, device_name=dev_name)
                if ping_info and ping_info.get('site_name'):
                    inc.site_name = ping_info['site_name']
                    changed_fields.append('site_name')

            # B. Check TTS by Device IP / Hostname
            if not inc.ticket_id_tss:
                tts_info = client.fetch_tts_for_device(device_ip=dev_ip, device_name=dev_name, sys_name=sys_name)
                if tts_info and tts_info.get('ticket_id_tss'):
                    t_id = tts_info['ticket_id_tss']
                    inc.ticket_id_tss = t_id
                    inc.tts_status = tts_info.get('tts_status', '')
                    inc.repair_team = tts_info.get('repair_team', '')
                    inc.response_department = tts_info.get('response_department', '')
                    inc.actual_cause = tts_info.get('actual_cause', '')
                    inc.resolution = tts_info.get('resolution', '')
                    inc.source_gps = tts_info.get('source_gps', '')
                    inc.dest_gps = tts_info.get('dest_gps', '')
                    changed_fields.extend([
                        'ticket_id_tss', 'tts_status', 'repair_team',
                        'response_department', 'actual_cause', 'resolution',
                        'source_gps', 'dest_gps'
                    ])
                    inc.add_timeline_entry(
                        event_type=TimelineEventType.TICKET_LINKED,
                        source='TTS_DEVICE_SYNC',
                        description=f"Device Trouble Ticket {t_id} linked from TTS ({tts_info.get('tts_status', '')})",
                        data={'ticket_id_tss': t_id, 'device_ip': dev_ip, 'tts_info': tts_info},
                    )
                    logger.info(f"TTS_DEVICE_SYNC_SUCCESS: Device Incident {inc.incident_number} linked to ticket {t_id}")

            if changed_fields:
                changed_fields = list(set(changed_fields))
                changed_fields.append('updated_at')
                inc.save(update_fields=changed_fields)
                updated_count += 1

    return {
        "status": "success",
        "pending_count": count,
        "updated_count": updated_count
    }


@shared_task
def sync_single_incident_ticket_task(incident_id: int):
    """
    On-demand sync for a specific incident (triggered when opening IncidentDetailModal or clicking Sync Ticket).
    Supports both LINK and DEVICE incidents.
    Always queries latest TTS status, repair team, and actual cause.
    """
    import re
    from integrations.ipget import IPGETClient

    try:
        inc = Incident.objects.select_related('primary_device').get(id=incident_id)
        client = IPGETClient()
        changed_fields = []

        if inc.incident_type == IncidentType.LINK:
            # 1. Interface Alarms match
            alarms = client.fetch_interface_alarms(interval_hour=72)
            ip_index, name_index = client.build_alarm_index(alarms)
            matched = client.match_alarm(
                ip_index, name_index,
                device_ip=inc.primary_device.management_ip,
                port_name=inc.interface_name,
                device_name=inc.primary_device.name
            )

            if matched:
                ticket_id = (matched.get('ticket_id_tss') or '').strip()
                if ticket_id and not inc.ticket_id_tss:
                    inc.ticket_id_tss = ticket_id
                    changed_fields.append('ticket_id_tss')
                    inc.add_timeline_entry(
                        event_type=TimelineEventType.TICKET_LINKED,
                        source='IPGET_SYNC',
                        description=f"Trouble Ticket {ticket_id} linked from TSS",
                        data={'ticket_id_tss': ticket_id},
                    )

                cat_id = (matched.get('cat_id') or matched.get('interface_cat_id') or '').strip()
                if cat_id and not inc.circuit_id:
                    inc.circuit_id = cat_id
                    changed_fields.append('circuit_id')

                destname = (matched.get('destname') or '').strip()
                if destname and not inc.remote_device:
                    inc.remote_device = destname
                    changed_fields.append('remote_device')

                destport = (matched.get('destport') or '').strip()
                if destport and not inc.remote_interface:
                    inc.remote_interface = destport
                    changed_fields.append('remote_interface')

                site = (matched.get('site_name') or '').strip()
                if site and not inc.site_name:
                    inc.site_name = site
                    changed_fields.append('site_name')

            # 2. TTS query by NTID / Circuit ID
            cid = inc.circuit_id
            if not cid and inc.link_description:
                m = re.search(r'(TBB\d+|308\d+)', inc.link_description)
                if m:
                    cid = m.group(1)

            if cid:
                tts_list = client.fetch_tts_by_ntids([cid])
                if tts_list and tts_list[0].get('INCIDENT_ID'):
                    tts_info = client.extract_tts_info(tts_list[0])
                    t_id = tts_info.get('ticket_id_tss')
                    if t_id and not inc.ticket_id_tss:
                        inc.ticket_id_tss = t_id
                        changed_fields.append('ticket_id_tss')
                        inc.add_timeline_entry(
                            event_type=TimelineEventType.TICKET_LINKED,
                            source='TTS_SYNC',
                            description=f"Trouble Ticket {t_id} linked from TTS ({tts_info.get('tts_status', '')})",
                            data={'ticket_id_tss': t_id, 'cat_id': cid},
                        )

                    if cid and not inc.circuit_id:
                        inc.circuit_id = cid
                        changed_fields.append('circuit_id')

                    # Refresh repair status & actual cause
                    for k in ['tts_status', 'repair_team', 'response_department', 'actual_cause', 'resolution', 'source_gps', 'dest_gps']:
                        val = tts_info.get(k, '')
                        if val and getattr(inc, k, '') != val:
                            setattr(inc, k, val)
                            changed_fields.append(k)

        else:
            # DEVICE Incident
            dev_ip = inc.primary_device.management_ip
            dev_name = inc.primary_device.name
            sys_name = getattr(inc.primary_device, 'sys_name', '')

            # A. Ping alarm site info
            ping_info = client.fetch_node_ping_info(device_ip=dev_ip, device_name=dev_name)
            if ping_info and ping_info.get('site_name'):
                if inc.site_name != ping_info['site_name']:
                    inc.site_name = ping_info['site_name']
                    changed_fields.append('site_name')

            # B. Query TTS by IP & Hostname
            tts_info = client.fetch_tts_for_device(device_ip=dev_ip, device_name=dev_name, sys_name=sys_name)
            if tts_info and tts_info.get('ticket_id_tss'):
                t_id = tts_info['ticket_id_tss']
                if not inc.ticket_id_tss:
                    inc.ticket_id_tss = t_id
                    changed_fields.append('ticket_id_tss')
                    inc.add_timeline_entry(
                        event_type=TimelineEventType.TICKET_LINKED,
                        source='TTS_DEVICE_SYNC',
                        description=f"Device Trouble Ticket {t_id} linked from TTS ({tts_info.get('tts_status', '')})",
                        data={'ticket_id_tss': t_id, 'device_ip': dev_ip},
                    )

                for k in ['tts_status', 'repair_team', 'response_department', 'actual_cause', 'resolution', 'source_gps', 'dest_gps']:
                    val = tts_info.get(k, '')
                    if val and getattr(inc, k, '') != val:
                        setattr(inc, k, val)
                        changed_fields.append(k)

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
    except Incident.DoesNotExist:
        return {"status": "error", "message": "Incident not found"}

