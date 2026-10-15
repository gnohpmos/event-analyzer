"""
osTicket Client for creating incident tickets via Internal REST API.
Includes 5-layered deduplication and concurrency protection.
"""
import os
import json
import logging
from contextlib import contextmanager
from typing import Dict, Any, Optional, Tuple

import redis
import requests
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from common.constants import TimelineEventType, IncidentStatus
from common.settings_helper import get_setting, get_setting_int
from incidents.models import Incident
from .builder import OSTicketPayloadBuilder
from .searcher import OSTicketSearcher

logger = logging.getLogger(__name__)

DEFAULT_API_URL = 'http://192.168.243.127/osticket/api/tickets.json'
DEFAULT_API_KEY = 'D20FF17FB93ED8CA1B863ECF9636A8EB'
DEFAULT_WEB_URL = 'https://msticket.catbb.net/'
DEFAULT_TOPIC_ID = 27
DEFAULT_SLA_ID = 10
DEFAULT_SENDER_NAME = 'พงศธร พันสนิท'
DEFAULT_SENDER_EMAIL = 'p.pansanit@gmail.com'


class OSTicketClient:
    STATUS_OPEN = 'Open'
    STATUS_PENDING = 'PENDING_CREATION'
    STATUS_FAILED = 'FAILED'
    STATUS_FAILED_VERIFY = 'FAILED_NEEDS_VERIFY'
    TIMELINE_SOURCE = 'OSTICKET_GATEWAY'

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
        self.api_url = (api_url or os.getenv('OSTICKET_API_URL', DEFAULT_API_URL)).strip()
        self.api_key = (api_key or os.getenv('OSTICKET_API_KEY', DEFAULT_API_KEY)).strip()
        self.web_url = os.getenv('OSTICKET_WEB_URL', DEFAULT_WEB_URL).rstrip('/')

        default_topic = int(os.getenv('OSTICKET_TOPIC_ID', str(DEFAULT_TOPIC_ID)))
        default_sla = int(os.getenv('OSTICKET_SLA_ID', str(DEFAULT_SLA_ID)))
        self.topic_id = int(topic_id if topic_id is not None else get_setting_int('OSTICKET_TOPIC_ID', default_topic))
        self.sla_id = int(sla_id if sla_id is not None else get_setting_int('OSTICKET_SLA_ID', default_sla))

        self.sender_name = (
            sender_name
            or get_setting('OSTICKET_SENDER_NAME', os.getenv('OSTICKET_SENDER_NAME', DEFAULT_SENDER_NAME))
        )
        self.sender_email = (
            sender_email
            or get_setting('OSTICKET_SENDER_EMAIL', os.getenv('OSTICKET_SENDER_EMAIL', DEFAULT_SENDER_EMAIL))
        )
        self.timeout = timeout

    @staticmethod
    def is_auto_create_enabled() -> bool:
        """Checks dynamic setting to see if automated osTicket creation is turned on."""
        val = get_setting('OSTICKET_AUTO_CREATE', 'False')
        return str(val).strip().lower() in ('true', '1', 'yes', 'on')

    @staticmethod
    def get_auto_create_delay_seconds() -> int:
        """Returns the delay in seconds before auto-creating an osTicket."""
        return get_setting_int('OSTICKET_AUTO_CREATE_DELAY_SECONDS', 0)

    def can_auto_open(self, incident: Incident) -> Tuple[bool, str]:
        """
        Validates whether an incident is currently eligible for automated osTicket creation.
        """
        if not self.is_auto_create_enabled():
            return False, "Automated osTicket creation is disabled in system settings"

        if incident.status not in IncidentStatus.ACTIVE_STATUSES:
            return False, f"Incident status '{incident.status}' is not active"

        if incident.ticket_id_osticket:
            return False, f"Incident already has osTicket: {incident.ticket_id_osticket}"

        if incident.osticket_status == self.STATUS_PENDING:
            return False, "osTicket creation is already pending"

        if not incident.ticket_id_tss:
            return False, "Incident does not have an NT TTS ticket linked yet"

        delay = self.get_auto_create_delay_seconds()
        if delay > 0 and incident.down_time:
            elapsed = (timezone.now() - incident.down_time).total_seconds()
            if elapsed < delay:
                return False, f"Elapsed downtime ({elapsed:.0f}s) is less than required auto-create delay ({delay}s)"

        return True, "Eligible for automated osTicket creation"

    def auto_open_ticket_if_eligible(self, incident: Incident) -> Optional[Dict[str, Any]]:
        """
        Safely attempts to create or link an osTicket for an eligible incident.
        Returns result dict if attempted, or None if skipped.
        """
        eligible, reason = self.can_auto_open(incident)
        if not eligible:
            logger.debug(f"OSTicketClient: Incident {incident.incident_number} not eligible for auto-open: {reason}")
            return None

        logger.info(
            f"OSTicketClient: Automatically opening osTicket for Incident {incident.incident_number} "
            f"(TTS: {incident.ticket_id_tss}, Circuit: {incident.circuit_id})"
        )
        return self.open_ticket(
            incident=incident,
            circuit_id=incident.circuit_id,
            cat_tts=incident.ticket_id_tss,
            force=False,
        )

    def _build_ticket_url(self, ticket_number: str) -> str:
        return f"{self.web_url}/osticket/scp/tickets.php?number={ticket_number}"

    @staticmethod
    def _get_redis() -> Optional[redis.Redis]:
        try:
            redis_host = os.getenv('REDIS_HOST', 'redis')
            return redis.Redis(host=redis_host, port=6379, db=1, socket_timeout=2)
        except Exception as e:
            logger.warning(f"OSTicketClient: Failed to connect to Redis: {e}")
            return None

    @contextmanager
    def _redis_lock(self, lock_key: str, expire: int = 60):
        """
        Distributed lock context manager using Redis.
        Fails fast if lock cannot be acquired; proceeds gracefully if Redis is unavailable.
        """
        r = self._get_redis()
        lock = None
        acquired = False
        if r:
            try:
                lock = r.lock(lock_key, timeout=expire)
                acquired = bool(lock.acquire(blocking=False))
            except Exception as e:
                logger.warning(f"OSTicketClient: Error acquiring redis lock {lock_key}: {e}")
                acquired = True
        else:
            acquired = True

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

        qs = Incident.objects.filter(
            circuit_id=circuit_id,
            status__in=IncidentStatus.ACTIVE_STATUSES,
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
        is_reused: bool = False,
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
            peer.osticket_status = self.STATUS_OPEN
            update_fields = ['ticket_id_osticket', 'osticket_status', 'updated_at']
            if tts_id and not peer.ticket_id_tss:
                peer.ticket_id_tss = tts_id
                update_fields.append('ticket_id_tss')
            peer.save(update_fields=update_fields)

            peer.add_timeline_entry(
                event_type=TimelineEventType.OSTICKET_LINKED,
                source=self.TIMELINE_SOURCE,
                description=f"Auto-linked osTicket {ticket_number} from peer circuit incident {origin_incident.incident_number}",
                data={
                    'ticket_id_osticket': ticket_number,
                    'circuit_id': cid,
                    'cat_tts': tts_id,
                    'peer_incident': origin_incident.incident_number,
                    'reused': is_reused,
                },
            )
            updated_count += 1
            logger.info(
                f"OSTicketClient: Auto-propagated osTicket {ticket_number} "
                f"to peer Incident {peer.incident_number} (Circuit: {cid})"
            )
        return updated_count

    def _update_osticket_status(self, incident_id: int, status: str) -> None:
        """Atomically updates only the osticket_status of an incident."""
        with transaction.atomic():
            inc = Incident.objects.select_for_update().get(id=incident_id)
            inc.osticket_status = status
            inc.save(update_fields=['osticket_status', 'updated_at'])

    def _link_ticket_and_propagate(
        self,
        incident_id: int,
        ticket_number: str,
        circuit_id: str,
        cat_tts: str,
        timeline_description: str,
        timeline_data: Dict[str, Any],
        is_reused: bool,
    ) -> Incident:
        """
        Atomically assigns the osTicket number to the incident, records a timeline entry,
        and propagates the ticket to active peer incidents on the same circuit.
        """
        with transaction.atomic():
            inc = Incident.objects.select_for_update().get(id=incident_id)
            inc.ticket_id_osticket = ticket_number
            inc.osticket_status = self.STATUS_OPEN
            inc.save(update_fields=['ticket_id_osticket', 'osticket_status', 'updated_at'])

            inc.add_timeline_entry(
                event_type=TimelineEventType.OSTICKET_LINKED,
                source=self.TIMELINE_SOURCE,
                description=timeline_description,
                data=timeline_data,
            )

        self.propagate_ticket_to_peers(
            origin_incident=inc,
            ticket_number=ticket_number,
            circuit_id=circuit_id,
            cat_tts=cat_tts,
            is_reused=is_reused,
        )
        return inc

    def _claim_incident_or_reuse(
        self,
        incident_id: int,
        circuit_id: str,
        cat_tts: str,
        force: bool,
    ) -> Optional[Dict[str, Any]]:
        """
        Layers 1, 3, and 4:
        Locks the incident row, checks if a ticket already exists or is pending,
        reuses an active circuit peer ticket if available, or marks status as PENDING_CREATION.
        Returns a response dict if resolved/aborted early, or None to proceed with creation.
        """
        with transaction.atomic():
            locked_inc = Incident.objects.select_for_update().get(id=incident_id)

            if locked_inc.ticket_id_osticket:
                logger.info(
                    f"OSTicketClient: Incident {locked_inc.incident_number} already has "
                    f"osTicket {locked_inc.ticket_id_osticket}"
                )
                return {
                    "success": True,
                    "already_exists": True,
                    "ticket_id": locked_inc.ticket_id_osticket,
                    "status": locked_inc.osticket_status or self.STATUS_OPEN,
                    "url": self._build_ticket_url(locked_inc.ticket_id_osticket),
                    "message": f"osTicket already linked: {locked_inc.ticket_id_osticket}",
                }

            if locked_inc.osticket_status == self.STATUS_PENDING and not force:
                return {
                    "success": False,
                    "error": "osTicket creation is already in progress for this incident",
                    "code": "IN_PROGRESS",
                }

            # Layer 4: Reuse active ticket from peer incident on the same circuit
            if circuit_id and not force:
                active_ticket = self.find_active_circuit_ticket(circuit_id, exclude_incident_id=locked_inc.id)
                if active_ticket:
                    locked_inc.ticket_id_osticket = active_ticket
                    locked_inc.osticket_status = self.STATUS_OPEN
                    locked_inc.save(update_fields=['ticket_id_osticket', 'osticket_status', 'updated_at'])

                    locked_inc.add_timeline_entry(
                        event_type=TimelineEventType.OSTICKET_LINKED,
                        source=self.TIMELINE_SOURCE,
                        description=f"Reused active osTicket {active_ticket} from circuit {circuit_id}",
                        data={'ticket_id_osticket': active_ticket, 'circuit_id': circuit_id, 'reused': True},
                    )
                    self.propagate_ticket_to_peers(
                        locked_inc, active_ticket, circuit_id=circuit_id, cat_tts=cat_tts, is_reused=True
                    )
                    return {
                        "success": True,
                        "reused": True,
                        "ticket_id": active_ticket,
                        "status": self.STATUS_OPEN,
                        "url": self._build_ticket_url(active_ticket),
                        "message": f"Reused active osTicket {active_ticket} for circuit {circuit_id}",
                    }

            # Layer 3: Mark state as PENDING_CREATION
            locked_inc.osticket_status = self.STATUS_PENDING
            locked_inc.save(update_fields=['osticket_status', 'updated_at'])

        return None

    def _try_reuse_remote_noc_ticket(
        self,
        incident_id: int,
        circuit_id: str,
        cat_tts: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Layer 4.5: Searches osTicket Staff Portal to check if NOC already opened a ticket
        for the given CAT TTS number. Links and propagates if found.
        """
        try:
            searcher = OSTicketSearcher()
            existing_remote = searcher.find_ticket_by_tts(cat_tts)
            if not existing_remote:
                return None

            remote_ticket = existing_remote['ticket_number']
            logger.info(
                f"OSTicketClient: Discovered existing remote osTicket {remote_ticket} "
                f"for CAT TTS {cat_tts}. Linking instead of creating duplicate."
            )
            self._link_ticket_and_propagate(
                incident_id=incident_id,
                ticket_number=remote_ticket,
                circuit_id=circuit_id,
                cat_tts=cat_tts,
                timeline_description=(
                    f"Discovered and linked existing osTicket {remote_ticket} created by NOC (CAT TTS: {cat_tts})"
                ),
                timeline_data={
                    'ticket_id_osticket': remote_ticket,
                    'cat_tts': cat_tts,
                    'circuit_id': circuit_id,
                    'reused': True,
                    'manual_noc_detected': True,
                },
                is_reused=True,
            )
            return {
                "success": True,
                "reused": True,
                "manual_noc_detected": True,
                "ticket_id": remote_ticket,
                "status": self.STATUS_OPEN,
                "url": self._build_ticket_url(remote_ticket),
                "message": (
                    f"ตรวจพบตั๋ว {remote_ticket} ที่เปิดไว้แล้วใน osTicket "
                    f"สำหรับใบงาน {cat_tts} (ผูกตั๋วเดิมให้อัตโนมัติ)"
                ),
            }
        except Exception as e:
            logger.warning(f"OSTicketClient: Failed external search check: {e}")
            return None

    def _send_create_ticket_request(
        self,
        incident: Incident,
        circuit_id: str,
        cat_tts: str,
        action_summary: Optional[str],
    ) -> requests.Response:
        """Builds payload and sends HTTP POST request to the osTicket REST API."""
        payload = OSTicketPayloadBuilder.build_payload(
            incident=incident,
            circuit_id=circuit_id,
            cat_tts=cat_tts,
            custom_action_summary=action_summary,
            name=self.sender_name,
            email=self.sender_email,
            topic_id=self.topic_id,
            sla_id=self.sla_id,
        )
        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json; charset=utf-8",
        }
        logger.info(
            f"OSTicketClient: Sending POST to {self.api_url} for Incident {incident.incident_number} "
            f"(CAT TTS: {cat_tts}, Circuit: {circuit_id})"
        )
        return requests.post(
            self.api_url,
            data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            headers=headers,
            timeout=self.timeout,
        )

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

        if not tts_id and not force:
            return {
                "success": False,
                "error": "NT TTS Ticket (CAT TTS) is required before opening osTicket",
                "code": "MISSING_NT_TTS",
            }

        # Layers 1, 3, and 4: Check DB state, reuse active circuit ticket, or set PENDING_CREATION
        early_result = self._claim_incident_or_reuse(
            incident_id=incident.id,
            circuit_id=cid,
            cat_tts=tts_id,
            force=force,
        )
        if early_result is not None:
            return early_result

        # Layer 2: Redis Distributed Lock across circuit and incident
        lock_circuit_key = f"lock:osticket_open:circuit:{cid or incident.id}"
        with self._redis_lock(lock_circuit_key, expire=60) as acquired:
            if not acquired:
                # Reset PENDING_CREATION so the incident is not left stuck if the peer lock holder fails
                self._update_osticket_status(incident.id, '')
                return {
                    "success": False,
                    "error": f"Another process is currently creating osTicket for circuit {cid}",
                    "code": "CONCURRENT_LOCK",
                }

            # Layer 4.5: Check if NOC already opened a ticket on osTicket Staff Portal
            if tts_id and not force:
                remote_reuse_result = self._try_reuse_remote_noc_ticket(
                    incident_id=incident.id,
                    circuit_id=cid,
                    cat_tts=tts_id,
                )
                if remote_reuse_result is not None:
                    return remote_reuse_result

            # Execute API call to create ticket
            try:
                response = self._send_create_ticket_request(
                    incident=incident,
                    circuit_id=cid,
                    cat_tts=tts_id,
                    action_summary=action_summary,
                )
            except requests.exceptions.Timeout:
                logger.error(f"OSTicketClient: Timeout calling osTicket API for incident {incident.incident_number}")
                self._update_osticket_status(incident.id, self.STATUS_FAILED_VERIFY)
                return {
                    "success": False,
                    "error": "Request to osTicket timed out. Ticket may have been created; please verify before retrying.",
                    "code": "TIMEOUT_NEEDS_VERIFY",
                }
            except Exception as e:
                logger.error(f"OSTicketClient: Network/build error for incident {incident.incident_number}: {e}")
                self._update_osticket_status(incident.id, self.STATUS_FAILED)
                return {
                    "success": False,
                    "error": str(e),
                    "code": "NETWORK_ERROR",
                }

            if response.status_code in (200, 201):
                ticket_number = response.text.strip().replace('"', '').strip()
                logger.info(f"OSTicketClient: Successfully created ticket '{ticket_number}'")

                self._link_ticket_and_propagate(
                    incident_id=incident.id,
                    ticket_number=ticket_number,
                    circuit_id=cid,
                    cat_tts=tts_id,
                    timeline_description=f"Created Trouble Ticket {ticket_number} on osTicket (CAT TTS: {tts_id})",
                    timeline_data={
                        'ticket_id_osticket': ticket_number,
                        'cat_tts': tts_id,
                        'circuit_id': cid,
                        'topic_id': self.topic_id,
                        'sla_id': self.sla_id,
                    },
                    is_reused=False,
                )
                return {
                    "success": True,
                    "ticket_id": ticket_number,
                    "status": self.STATUS_OPEN,
                    "url": self._build_ticket_url(ticket_number),
                }

            error_msg = response.text.strip() or f"HTTP {response.status_code}"
            logger.error(f"OSTicketClient: Failed to create ticket: {response.status_code} - {error_msg}")
            self._update_osticket_status(incident.id, self.STATUS_FAILED)
            return {
                "success": False,
                "status_code": response.status_code,
                "error": error_msg,
                "code": "API_ERROR",
            }

