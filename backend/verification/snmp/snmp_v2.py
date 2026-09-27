"""
SNMP v2c Client implementation using pysnmp.
Queries sysUpTime (OID 1.3.6.1.2.1.1.3.0) and converts timeticks to seconds.
"""
import asyncio
import logging
from typing import Optional

from django.conf import settings
from pysnmp.hlapi.asyncio import (
    SnmpEngine, CommunityData, UdpTransportTarget,
    ContextData, ObjectType, ObjectIdentity, getCmd
)

from common.settings_helper import get_setting
from .base import BaseSNMPClient, SNMPResult

logger = logging.getLogger(__name__)

SYS_UP_TIME_OID = '1.3.6.1.2.1.1.3.0'
WHY_RELOAD_OID = '1.3.6.1.4.1.9.2.1.2.0'


class SNMPv2Client(BaseSNMPClient):
    """SNMP v2c Client implementation."""

    def __init__(self, default_community: Optional[str] = None):
        self._default_community = default_community

    @property
    def default_community(self) -> str:
        return self._default_community or get_setting('SNMP_COMMUNITY', 'public')

    def get_sysuptime(
        self,
        host: str,
        community: Optional[str] = None,
        timeout: int = 5,
        retries: int = 1
    ) -> SNMPResult:
        """
        Synchronous wrapper that runs the async SNMP query in an event loop.
        Safe for use inside Celery worker threads.
        """
        target_community = community or self.default_community
        try:
            return asyncio.run(
                self._async_get_sysuptime(host, target_community, timeout, retries)
            )
        except Exception as e:
            logger.error(f"SNMP_ASYNCIO_RUN_ERROR: host={host} error={str(e)}")
            return SNMPResult(
                success=False,
                error_message=f"Runtime error: {str(e)}",
                snmp_version='v2c'
            )

    async def _async_get_sysuptime(
        self,
        host: str,
        community: Optional[str] = None,
        timeout: int = 5,
        retries: int = 1
    ) -> SNMPResult:
        """Execute async SNMP GET request for sysUpTime."""
        target_community = community or self.default_community
        snmp_engine = SnmpEngine()

        try:
            logger.info(f"SNMP_GET_INIT: host={host} community={target_community[:2]}*** timeout={timeout} retries={retries}")
            transport = UdpTransportTarget((host, 161), timeout=timeout, retries=retries)
            auth_data = CommunityData(target_community, mpModel=1)  # mpModel=1 -> SNMPv2c
            var_bind = ObjectType(ObjectIdentity(SYS_UP_TIME_OID))

            err_ind, err_stat, err_idx, var_binds = await getCmd(
                snmp_engine,
                auth_data,
                transport,
                ContextData(),
                var_bind,
                lookupMib=False
            )

            if err_ind:
                logger.warning(f"SNMP_GET_FAILED: host={host} indication={err_ind}")
                return SNMPResult(
                    success=False,
                    error_message=str(err_ind),
                    snmp_version='v2c'
                )

            if err_stat:
                msg = f"SNMP Error: {err_stat.prettyPrint()} at index {err_idx}"
                logger.warning(f"SNMP_GET_STATUS_ERROR: host={host} error={msg}")
                return SNMPResult(
                    success=False,
                    error_message=msg,
                    snmp_version='v2c'
                )

            if not var_binds:
                return SNMPResult(
                    success=False,
                    error_message="No varbinds returned",
                    snmp_version='v2c'
                )

            oid, val = var_binds[0]
            raw_val_str = str(val)

            # sysUpTime is TimeTicks: hundredths of a second (1/100s)
            try:
                raw_int = int(val)
                uptime_seconds = raw_int / 100.0
            except (ValueError, TypeError):
                logger.error(f"SNMP_PARSE_ERROR: Cannot convert timeticks to int: {raw_val_str}")
                return SNMPResult(
                    success=False,
                    raw_sysuptime=raw_val_str,
                    error_message=f"Invalid timeticks value: {raw_val_str}",
                    snmp_version='v2c'
                )

            logger.info(
                f"SNMP_GET_SUCCESS: host={host} raw={raw_int} uptime_seconds={uptime_seconds:.2f}"
            )

            # Query whyReload for Classic IOS & IOS-XE devices
            why_reload_str = None
            try:
                why_transport = UdpTransportTarget((host, 161), timeout=2, retries=1)
                why_vb = ObjectType(ObjectIdentity(WHY_RELOAD_OID))
                _, _, _, why_binds = await getCmd(
                    snmp_engine, auth_data, why_transport, ContextData(), why_vb, lookupMib=False
                )
                if why_binds:
                    raw_why = str(why_binds[0][1]).strip()
                    if raw_why and "No Such" not in raw_why:
                        why_reload_str = raw_why
                        logger.info(f"SNMP_WHY_RELOAD_FOUND: host={host} reason='{why_reload_str}'")
            except Exception as e_why:
                logger.debug(f"SNMP_WHY_RELOAD_IGNORE: host={host} error={e_why}")

            return SNMPResult(
                success=True,
                raw_sysuptime=str(raw_int),
                router_uptime_seconds=uptime_seconds,
                why_reload=why_reload_str,
                snmp_version='v2c'
            )

        except Exception as e:
            logger.error(f"SNMP_EXCEPTION: host={host} error={str(e)}")
            return SNMPResult(
                success=False,
                error_message=str(e),
                snmp_version='v2c'
            )
        finally:
            try:
                snmp_engine.closeDispatcher()
            except Exception:
                pass
