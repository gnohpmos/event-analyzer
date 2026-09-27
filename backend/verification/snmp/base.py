"""
SNMP Base Client and Data Structures.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class SNMPResult:
    """Structured result from an SNMP query."""
    success: bool
    raw_sysuptime: Optional[str] = None
    router_uptime_seconds: Optional[float] = None
    why_reload: Optional[str] = None
    error_message: Optional[str] = None
    snmp_version: str = 'v2c'
    community: Optional[str] = None


class BaseSNMPClient(ABC):
    """Abstract interface for SNMP clients."""

    @abstractmethod
    def get_sysuptime(self, host: str, community: Optional[str] = None, timeout: int = 5, retries: int = 1) -> SNMPResult:
        """Query sysUpTime (OID 1.3.6.1.2.1.1.3.0) and return SNMPResult."""
        pass
