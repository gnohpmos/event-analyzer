"""
osTicket Client for creating incident tickets via Internal REST API.
Includes 5-layered deduplication and concurrency protection.
"""
import os
import json
import logging
import requests
from contextlib import contextmanager
from typing import Dict, Any, Optional
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from common.constants import TimelineEventType, IncidentStatus
from incidents.models import Incident
from .builder import OSTicketPayloadBuilder
from .searcher import OSTicketSearcher

logger = logging.getLogger(__name__)


class OSTicketClient:
    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        topic_id: Optional[int] = None,
        sla_id: Optional[int] = None,
        sender_name: Optional[str] = None,
        sender_email: Optional[str] = None,
        timeout: int = 30,
    ):
        self.api_url = (api_url or os.getenv('OSTICKET_API_URL', 'http://192.168.243.127/osticket/api/tickets.json')).strip()
        self.api_key = (api_key or os.getenv('OSTICKET_API_KEY', 'D20FF17FB93ED8CA1B863ECF9636A8EB')).strip()
        self.web_url = (os.getenv('OSTICKET_WEB_URL', 'https://msticket.catbb.net/')).rstrip('/')
        self.topic_id = int(topic_id or os.getenv('OSTICKET_TOPIC_ID', '27'))
        self.sla_id = int(sla_id or os.getenv('OSTICKET_SLA_ID', '10'))
        self.sender_name = sender_name or os.getenv('OSTICKET_SENDER_NAME', 'พงศธร พันสนิท')
        self.sender_email = sender_email or os.getenv('OSTICKET_SENDER_EMAIL', 'p.pansanit@gmail.com')
        self.timeout = timeout

    @staticmethod
    def _get_redis():
        try:
            import redis
            redis_host = os.getenv('REDIS_HOST', 'redis')
            return redis.Redis(host=redis_host, port=6379, db=1, socket_timeout=2)
        except Exception as e:
            logger.warning(f"OSTicketClient: Failed to connect to Redis: {e}")
            return None

    @contextmanager
    def _redis_lock(self, lock_key: str, expire: int = 60):
        """
        Distributed lock context manager using Redis.
        Fails fast if lock cannot be acquired.
        """
        r = self._get_redis()
        lock = None
        acquired = False
        if r:
            try:
                lock = r.lock(lock_key, timeout=expire)
                acquired = lock.acquire(blocking=False)
            except Exception as e:
                logger.warning(f"OSTicketClient: Error acquiring redis lock {lock_key}: {e}")
                acquired = True  # Proceed if Redis is down
        else:
            acquired = True  # Proceed if Redis is unavailable

        try:
            yield acquired
        finally:
            if acquired and lock:
                try:
                    lock.release()
                except Exception as e:
                    logger.debug(f"OSTicketClient: Error releasing lock {lock_key}: {e}")

    def find_active_circuit_ticket(self, circuit_id: str, exclude_incident_id: Optional[int] = None) -> Optional[str]:
        """
        Layer 4 Deduplication:
        Checks if any other active/unresolved incident for the same circuit already has an osTicket.
        """
        if not circuit_id:
            return None

        active_statuses = IncidentStatus.ACTIVE_STATUSES
        qs = Incident.objects.filter(
            circuit_id=circuit_id,
            status__in=active_statuses,
        ).exclude(ticket_id_osticket='')

        if exclude_incident_id:
            qs = qs.exclude(id=exclude_incident_id)

        existing = qs.first()
        if existing and existing.ticket_id_osticket:
            logger.info(
                f"OSTicketClient: Found existing active ticket {existing.ticket_id_osticket} "
                f"on circuit {circuit_id} (Incident: {existing.incident_number})"
            )
            return existing.ticket_id_osticket
        return None

    def propagate_ticket_to_peers(
        self,
        origin_incident: Incident,
        ticket_number: str,
        circuit_id: Optional[str] = None,
        cat_tts: Optional[str] = None,
        is_reused: bool = False
    ) -> int:
        """
        Auto-propagates osTicket number and Open status to all active peer incidents
        sharing the same circuit_id or active TTS ticket.
        """
        cid = (circuit_id or origin_incident.circuit_id or '').strip()
        tts_id = (cat_tts or origin_incident.ticket_id_tss or '').strip()
        if not cid and not tts_id:
            return 0

        query = Q()
        if cid:
            query |= Q(circuit_id=cid)
        if tts_id:
            query |= Q(ticket_id_tss=tts_id)

        peers = (
            Incident.objects
            .filter(query, status__in=IncidentStatus.ACTIVE_STATUSES)
            .exclude(id=origin_incident.id)
            .exclude(ticket_id_osticket=ticket_number)
        )

        updated_count = 0
        for peer in peers:
            peer.ticket_id_osticket = ticket_number
            peer.osticket_status = 'Open'
            update_fields = ['ticket_id_osticket', 'osticket_status', 'updated_at']
            if tts_id and not peer.ticket_id_tss:
                peer.ticket_id_tss = tts_id
                update_fields.append('ticket_id_tss')
            peer.save(update_fields=update_fields)

            peer.add_timeline_entry(
                event_type=TimelineEventType.OSTICKET_LINKED,
                source='OSTICKET_GATEWAY',
                description=f"Auto-linked osTicket {ticket_number} from peer circuit incident {origin_incident.incident_number}",
                data={
                    'ticket_id_osticket': ticket_number,
                    'circuit_id': cid,
                    'cat_tts': tts_id,
                    'peer_incident': origin_incident.incident_number,
                    'reused': is_reused,
                }
            )
            updated_count += 1
            logger.info(
                f"OSTicketClient: Auto-propagated osTicket {ticket_number} "
                f"to peer Incident {peer.incident_number} (Circuit: {cid})"
            )
        return updated_count

    def open_ticket(
        self,
        incident: Incident,
        circuit_id: Optional[str] = None,
        cat_tts: Optional[str] = None,
        action_summary: Optional[str] = None,
        force: bool = False,
    ) -> Dict[str, Any]:
        """
        Creates a ticket in osTicket adhering to the 5-layered deduplication strategy.
        """
        cid = (circuit_id or incident.circuit_id or '').strip()
        tts_id = (cat_tts or incident.ticket_id_tss or '').strip()

        # Precondition: Must have NT TTS ticket unless force=True
        if not tts_id and not force:
            return {
                "success": False,
                "error": "NT TTS Ticket (CAT TTS) is required before opening osTicket",
                "code": "MISSING_NT_TTS"
            }

        # Layer 1 & 3: Check database state with select_for_update
        with transaction.atomic():
            locked_inc = Incident.objects.select_for_update().get(id=incident.id)

            if locked_inc.ticket_id_osticket:
                logger.info(
                    f"OSTicketClient: Incident {locked_inc.incident_number} already has "
                    f"osTicket {locked_inc.ticket_id_osticket}"
                )
                return {
                    "success": True,
                    "already_exists": True,
                    "ticket_id": locked_inc.ticket_id_osticket,
                    "status": locked_inc.osticket_status or "Open",
                    "message": f"osTicket already linked: {locked_inc.ticket_id_osticket}"
                }

            if locked_inc.osticket_status == 'PENDING_CREATION' and not force:
                return {
                    "success": False,
                    "error": "osTicket creation is already in progress for this incident",
                    "code": "IN_PROGRESS"
                }

            # Layer 4: Check if same circuit has an active osTicket in another incident
            if cid:
                active_ticket = self.find_active_circuit_ticket(cid, exclude_incident_id=locked_inc.id)
                if active_ticket and not force:
                    locked_inc.ticket_id_osticket = active_ticket
                    locked_inc.osticket_status = 'Open'
                    locked_inc.save(update_fields=['ticket_id_osticket', 'osticket_status', 'updated_at'])

                    locked_inc.add_timeline_entry(
                        event_type=TimelineEventType.OSTICKET_LINKED,
                        source='OSTICKET_GATEWAY',
                        description=f"Reused active osTicket {active_ticket} from circuit {cid}",
                        data={'ticket_id_osticket': active_ticket, 'circuit_id': cid, 'reused': True}
                    )
                    self.propagate_ticket_to_peers(locked_inc, active_ticket, circuit_id=cid, cat_tts=tts_id, is_reused=True)
                    return {
                        "success": True,
                        "reused": True,
                        "ticket_id": active_ticket,
                        "status": "Open",
                        "message": f"Reused active osTicket {active_ticket} for circuit {cid}"
                    }

            # Mark state as PENDING_CREATION
            locked_inc.osticket_status = 'PENDING_CREATION'
            locked_inc.save(update_fields=['osticket_status', 'updated_at'])

        # Layer 2: Redis Distributed Lock across circuit and incident
        lock_circuit_key = f"lock:osticket_open:circuit:{cid or locked_inc.id}"
        with self._redis_lock(lock_circuit_key, expire=60) as acquired:
            if not acquired:
                return {
                    "success": False,
                    "error": f"Another process is currently creating osTicket for circuit {cid}",
                    "code": "CONCURRENT_LOCK"
                }

            # Layer 4.5: Search osTicket directly to see if NOC already opened it
            if tts_id and not force:
                try:
                    searcher = OSTicketSearcher()
                    existing_remote = searcher.find_ticket_by_tts(tts_id)
                    if existing_remote:
                        remote_ticket = existing_remote['ticket_number']
                        logger.info(
                            f"OSTicketClient: Discovered existing remote osTicket {remote_ticket} "
                            f"for CAT TTS {tts_id}. Linking instead of creating duplicate."
                        )
                        with transaction.atomic():
                            inc = Incident.objects.select_for_update().get(id=incident.id)
                            inc.ticket_id_osticket = remote_ticket
                            inc.osticket_status = 'Open'
                            inc.save(update_fields=['ticket_id_osticket', 'osticket_status', 'updated_at'])

                            inc.add_timeline_entry(
                                event_type=TimelineEventType.OSTICKET_LINKED,
                                source='OSTICKET_GATEWAY',
                                description=f"Discovered and linked existing osTicket {remote_ticket} created by NOC (CAT TTS: {tts_id})",
                                data={
                                    'ticket_id_osticket': remote_ticket,
                                    'cat_tts': tts_id,
                                    'circuit_id': cid,
                                    'reused': True,
                                    'manual_noc_detected': True,
                                }
                            )

                        self.propagate_ticket_to_peers(inc, remote_ticket, circuit_id=cid, cat_tts=tts_id, is_reused=True)

                        return {
                            "success": True,
                            "reused": True,
                            "manual_noc_detected": True,
                            "ticket_id": remote_ticket,
                            "status": "Open",
                            "url": f"{self.web_url}/osticket/scp/tickets.php?number={remote_ticket}",
                            "message": f"ตรวจพบตั๋ว {remote_ticket} ที่เปิดไว้แล้วใน osTicket สำหรับใบงาน {tts_id} (ผูกตั๋วเดิมให้อัตโนมัติ)"
                        }
                except Exception as e:
                    logger.warning(f"OSTicketClient: Failed external search check: {e}")

            # Build Payload & send request
            try:
                payload = OSTicketPayloadBuilder.build_payload(
                    incident=incident,
                    circuit_id=cid,
                    cat_tts=tts_id,
                    custom_action_summary=action_summary,
                    name=self.sender_name,
                    email=self.sender_email,
                    topic_id=self.topic_id,
                    sla_id=self.sla_id
                )

                headers = {
                    "X-API-Key": self.api_key,
                    "Content-Type": "application/json; charset=utf-8"
                }

                logger.info(
                    f"OSTicketClient: Sending POST to {self.api_url} for Incident {incident.incident_number} "
                    f"(CAT TTS: {tts_id}, Circuit: {cid})"
                )

                response = requests.post(
                    self.api_url,
                    data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                    headers=headers,
                    timeout=self.timeout
                )
            except requests.exceptions.Timeout:
                logger.error(f"OSTicketClient: Timeout calling osTicket API for incident {incident.incident_number}")
                with transaction.atomic():
                    inc = Incident.objects.select_for_update().get(id=incident.id)
                    inc.osticket_status = 'FAILED_NEEDS_VERIFY'
                    inc.save(update_fields=['osticket_status', 'updated_at'])
                return {
                    "success": False,
                    "error": "Request to osTicket timed out. Ticket may have been created; please verify before retrying.",
                    "code": "TIMEOUT_NEEDS_VERIFY"
                }
            except Exception as e:
                logger.error(f"OSTicketClient: Network error: {e}")
                with transaction.atomic():
                    inc = Incident.objects.select_for_update().get(id=incident.id)
                    inc.osticket_status = 'FAILED'
                    inc.save(update_fields=['osticket_status', 'updated_at'])
                return {
                    "success": False,
                    "error": str(e),
                    "code": "NETWORK_ERROR"
                }

            # Handle osTicket response
            if response.status_code in (200, 201):
                raw_body = response.text.strip()
                # osTicket API returns ticket number or ID in response body (e.g. 11613 or NT002830)
                ticket_number = raw_body.replace('"', '').strip()
                logger.info(f"OSTicketClient: Successfully created ticket '{ticket_number}'")

                with transaction.atomic():
                    inc = Incident.objects.select_for_update().get(id=incident.id)
                    inc.ticket_id_osticket = ticket_number
                    inc.osticket_status = 'Open'
                    inc.save(update_fields=['ticket_id_osticket', 'osticket_status', 'updated_at'])

                    inc.add_timeline_entry(
                        event_type=TimelineEventType.OSTICKET_LINKED,
                        source='OSTICKET_GATEWAY',
                        description=f"Created Trouble Ticket {ticket_number} on osTicket (CAT TTS: {tts_id})",
                        data={
                            'ticket_id_osticket': ticket_number,
                            'cat_tts': tts_id,
                            'circuit_id': cid,
                            'topic_id': self.topic_id,
                            'sla_id': self.sla_id,
                        }
                    )

                self.propagate_ticket_to_peers(inc, ticket_number, circuit_id=cid, cat_tts=tts_id, is_reused=False)

                return {
                    "success": True,
                    "ticket_id": ticket_number,
                    "status": "Open",
                    "url": f"{self.web_url}/osticket/scp/tickets.php?number={ticket_number}",
                }
            else:
                error_msg = response.text.strip() or f"HTTP {response.status_code}"
                logger.error(f"OSTicketClient: Failed to create ticket: {response.status_code} - {error_msg}")
                with transaction.atomic():
                    inc = Incident.objects.select_for_update().get(id=incident.id)
                    inc.osticket_status = 'FAILED'
                    inc.save(update_fields=['osticket_status', 'updated_at'])

                return {
                    "success": False,
                    "status_code": response.status_code,
                    "error": error_msg,
                    "code": "API_ERROR"
                }
