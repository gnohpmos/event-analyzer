"""
osTicket Searcher: Real-time search in osTicket staff portal.
Used to detect if a ticket has already been opened manually by NOC
matching the NT TTS ticket ID (e.g. SD26100799) or Circuit ID.
"""
import os
import re
import logging
import requests
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class OSTicketSearcher:
    SESSION_CACHE_KEY = "osticket:staff_session_cookie"

    def __init__(
        self,
        base_url: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        timeout: int = 5,
    ):
        self.base_url = (base_url or os.getenv('OSTICKET_INTERNAL_BASE_URL', 'http://192.168.243.127/osticket')).rstrip('/')
        self.username = username or os.getenv('OSTICKET_USER') or os.getenv('OSTICKET_STAFF_USER', 'somphong')
        self.password = password or os.getenv('OSTICKET_PASSWORD') or os.getenv('OSTICKET_STAFF_PASS', 'Phong@1797')
        self.timeout = timeout
        self.session = requests.Session()

    @staticmethod
    def _get_redis():
        try:
            import redis
            redis_host = os.getenv('REDIS_HOST', 'redis')
            return redis.Redis(host=redis_host, port=6379, db=1, socket_timeout=2)
        except Exception as e:
            logger.debug(f"OSTicketSearcher: Redis unavailable: {e}")
            return None

    def _get_cached_cookie(self) -> Optional[str]:
        r = self._get_redis()
        if r:
            try:
                cookie = r.get(self.SESSION_CACHE_KEY)
                if cookie:
                    return cookie.decode('utf-8')
            except Exception:
                pass
        return None

    def _set_cached_cookie(self, cookie_val: str, expire: int = 3600):
        r = self._get_redis()
        if r:
            try:
                r.setex(self.SESSION_CACHE_KEY, expire, cookie_val)
            except Exception:
                pass

    def authenticate(self) -> bool:
        """
        Logs into osTicket SCP using staff credentials.
        """
        login_url = f"{self.base_url}/scp/login.php"
        try:
            res = self.session.get(login_url, timeout=self.timeout)
            csrf_match = re.search(r'name=[\"\']__CSRFToken__[\"\']\s+value=[\"\']([^\"\']+)[\"\']', res.text)
            csrf_token = csrf_match.group(1) if csrf_match else ''

            login_data = {
                '__CSRFToken__': csrf_token,
                'userid': self.username,
                'passwd': self.password,
                'submit': 'Log In'
            }
            res_login = self.session.post(login_url, data=login_data, timeout=self.timeout)
            
            # Check if login succeeded
            cookie_val = self.session.cookies.get('OSTSESSID')
            if cookie_val and ('tickets.php' in res_login.text or res_login.status_code == 200):
                self._set_cached_cookie(cookie_val, expire=3600)
                return True
        except Exception as e:
            logger.warning(f"OSTicketSearcher: Failed to authenticate to osTicket: {e}")
        return False

    def _prepare_session(self):
        cached_cookie = self._get_cached_cookie()
        if cached_cookie:
            self.session.cookies.set('OSTSESSID', cached_cookie, domain='192.168.243.127', path='/osticket/')

    def find_ticket_by_tts(self, tts_id: str) -> Optional[Dict[str, Any]]:
        """
        Searches osTicket for existing ticket by NT TTS ticket ID (e.g. SD26100799).
        Returns dict with ticket_number (e.g. NT002840) and ticket_id (e.g. 11646) if found.
        """
        clean_tts = (tts_id or '').strip()
        if not clean_tts:
            return None

        self._prepare_session()
        search_url = f"{self.base_url}/scp/tickets.php?a=search&query={clean_tts}"

        try:
            res = self.session.get(search_url, timeout=self.timeout)
            
            # If redirected to login page, re-authenticate and retry once
            if 'login.php' in res.url or 'login-box' in res.text:
                if self.authenticate():
                    res = self.session.get(search_url, timeout=self.timeout)
                else:
                    return None

            if res.status_code != 200:
                logger.warning(f"OSTicketSearcher: Search returned status {res.status_code}")
                return None

            # Pattern: <a ... href="tickets.php?id=(\d+)" ...>(NT\d+)</a>
            matches = re.findall(r'href=[\"\'][^\"\']*tickets\.php\?id=(\d+)[\"\'][^>]*>(NT\d+)</a>', res.text)
            if matches:
                # Get the latest ticket match (first one in table or highest number)
                db_id, ticket_number = matches[0]
                logger.info(f"OSTicketSearcher: Found existing osTicket {ticket_number} (DB ID {db_id}) for TTS {clean_tts}")
                return {
                    "ticket_number": ticket_number,
                    "db_id": int(db_id),
                    "tts_id": clean_tts
                }
        except Exception as e:
            logger.warning(f"OSTicketSearcher: Error during search for {clean_tts}: {e}")

        return None
