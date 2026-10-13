import os
import logging
import requests
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class TTSClient:
    """
    HTTP Client communicating with the dedicated tts-service sub-container.
    """
    def __init__(self, base_url: Optional[str] = None, timeout: int = 120):
        self.base_url = (base_url or os.getenv('TTS_SERVICE_URL', 'http://tts-service:8088')).rstrip('/')
        self.timeout = timeout

    def check_health(self) -> Dict[str, Any]:
        try:
            r = requests.get(f"{self.base_url}/health", timeout=5)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.error(f"TTSClient check_health error: {e}")
            return {"status": "error", "message": str(e)}

    def open_ticket(
        self,
        circuit_id: str,
        description: str,
        assignment_group: str = "ขทค. DATACOM [ Tier 1 ]",
        title: str = "Down",
        contact_name: str = "catma",
        contact_phone: str = "0909070641",
        contact_email: str = "catma@ait.co.th",
        source_latitude: str = "",
        source_longitude: str = "",
        dest_latitude: str = "",
        dest_longitude: str = ""
    ) -> Dict[str, Any]:
        """
        Sends request to tts-service to open a trouble ticket on NT TTS.
        """
        payload = {
            "circuit_id": circuit_id,
            "description": description,
            "assignment_group": assignment_group,
            "title": title,
            "contact_name": contact_name,
            "contact_phone": contact_phone,
            "contact_email": contact_email,
            "source_latitude": source_latitude,
            "source_longitude": source_longitude,
            "dest_latitude": dest_latitude,
            "dest_longitude": dest_longitude
        }
        url = f"{self.base_url}/api/v1/tts/open-ticket"
        try:
            logger.info(f"TTSClient: Calling open-ticket for Circuit {circuit_id} at {url}")
            r = requests.post(url, json=payload, timeout=self.timeout)
            data = r.json()
            if r.status_code == 200 and data.get("success"):
                logger.info(f"TTSClient: Successfully opened ticket for {circuit_id} -> {data.get('incident_id')}")
                return data
            else:
                logger.error(f"TTSClient: Failed to open ticket: status={r.status_code}, data={data}")
                return {
                    "success": False,
                    "error": data.get("error") or f"HTTP {r.status_code}",
                    "raw": data
                }
        except Exception as e:
            logger.error(f"TTSClient open_ticket exception: {e}")
            return {"success": False, "error": str(e)}

    def check_existing_ticket(self, circuit_id: str) -> Dict[str, Any]:
        """
        Checks if circuit already has active open tickets on NT TTS.
        """
        url = f"{self.base_url}/api/v1/tts/check-ticket"
        try:
            r = requests.post(url, json={"circuit_id": circuit_id}, timeout=self.timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.error(f"TTSClient check_existing_ticket exception: {e}")
            return {"has_open_ticket": False, "error": str(e), "tickets": []}
