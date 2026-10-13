"""
Payload builder for AIT osTicket REST API.
Adheres to Help Topic CATMA TTS (topicId: 27, SLA: 10, Form ID: 2)
matching production reference ticket NT002829.
"""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Dict, Any, Optional

from incidents.models import Incident
from incidents.services.ticket_policy_service import TicketPolicyService

logger = logging.getLogger(__name__)
BANGKOK_TZ = ZoneInfo('Asia/Bangkok')
UTC_TZ = ZoneInfo('UTC')


class OSTicketPayloadBuilder:
    @staticmethod
    def format_down_time(dt: Optional[datetime]) -> str:
        """
        Formats datetime into UTC YYYY-MM-DD HH:mm:ss for osTicket API.
        osTicket PHP core runs in UTC and applies the staff's timezone (Asia/Bangkok, +7)
        when displaying in the web interface.
        Sending in UTC ensures the displayed time equals the actual incident down time in Bangkok.
        """
        if not dt:
            dt = datetime.now(UTC_TZ)
        elif dt.tzinfo is None:
            # If naive datetime, assume it was Bangkok local time and convert to UTC
            dt = dt.replace(tzinfo=BANGKOK_TZ).astimezone(UTC_TZ)
        else:
            dt = dt.astimezone(UTC_TZ)
        return dt.strftime('%Y-%m-%d %H:%M:%S')

    @classmethod
    def build_payload(
        cls,
        incident: Incident,
        circuit_id: Optional[str] = None,
        cat_tts: Optional[str] = None,
        custom_action_summary: Optional[str] = None,
        name: str = "พงศธร พันสนิท",
        email: str = "p.pansanit@gmail.com",
        topic_id: int = 27,
        sla_id: int = 10,
    ) -> Dict[str, Any]:
        """
        Builds the dictionary payload for osTicket POST /api/tickets.json
        """
        cid = (circuit_id or incident.circuit_id or '').strip()
        tts_id = (cat_tts or incident.ticket_id_tss or '').strip()

        # Build action summary if not provided
        if not custom_action_summary:
            try:
                policy = TicketPolicyService()
                eval_res = policy.evaluate_eligibility(incident, force_refresh=False)
                action_summary = policy.build_ticket_description(
                    incident, eval_res.get('matched_alarm'), cid
                )
            except Exception as e:
                logger.warning(f"Failed to build dynamic ticket description: {e}")
                action_summary = (
                    f"พบ Link Down CAT ID : {cid}\n"
                    f"Device: {incident.primary_device.name if incident.primary_device else '-'}\n"
                    f"Interface: {incident.interface_name}\n"
                    f"Site: {incident.site_name}"
                )
        else:
            action_summary = custom_action_summary

        down_time_str = cls.format_down_time(incident.down_time)
        subject = f"พบ Link Down CAT ID : {cid}" if cid else f"พบ Link Down : {incident.incident_number}"
        message = f"พบ Link Down CAT ID : {cid} กรุณาตรวจสอบ" if cid else f"พบ Link Down {incident.incident_number} กรุณาตรวจสอบ"

        dev_name = incident.primary_device.name if incident.primary_device else ''
        dev_ip = incident.primary_device.management_ip if incident.primary_device else ''

        payload = {
            "alert": False,
            "autorespond": False,
            "source": "API",
            "topicId": int(topic_id),
            "slaId": int(sla_id),
            "priority": 2,  # Normal (3) priority level ID
            "name": name,
            "email": email,
            "subject": subject,
            "message": message,
            "cat_tts": tts_id,
            "customer_case": cid,
            "down_time": down_time_str,
            "action_summary": action_summary,
            "ip_nms": dev_ip,
            "device_name": dev_name,
            # Mandatory form validation fields for Form 2 (Ticket Details)
            "cust_priority": 449,          # Customer Priority: Normal
            "case_type_addon": 388,        # Case Type Addon: Incident
            "type_of_problem_cat": 128,    # Type of Problem (CAT): Media
            "assign_aot": "AIT NOC Engineer", # Assign AIT agent
            "case_type": "Incident",
            "service_outage": "Yes",
            "in_contract": "No",
            "escalation": "Yes",
            "cat_location": "กรุงเทพ",
        }
        return payload
