"""
Base Source Adapter interface.
Every external event source must implement this contract.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class NormalizedEventData:
    """
    The universal event contract. Core Engine processes ONLY this structure.
    No source-specific fields allowed here — those go into metadata.
    """
    # Source identification
    source: str                             # "PRTG", "NMS", "SYSLOG"
    source_event_id: Optional[str] = None   # Source-specific event ID

    # Event classification
    event_type: str = ''                    # "DEVICE_REACHABILITY"
    event_status: str = ''                  # "DOWN", "UP"
    severity: str = 'CRITICAL'             # "CRITICAL", "WARNING", "INFO"

    # Device identification
    device_name: str = ''                   # "BKK-PE-01"
    device_ip: str = ''                     # "10.10.10.1"

    # Timing (timezone-aware)
    event_time: Optional[datetime] = None   # Timestamp from source
    received_time: Optional[datetime] = None  # When system received event

    # Content
    message: str = ''                       # Human-readable message

    # Extensible data
    metadata: dict = field(default_factory=dict)     # Source-specific (prtg_device_id, etc.)
    raw_payload: dict = field(default_factory=dict)   # Original untouched payload for audit


class BaseSourceAdapter(ABC):
    """
    Abstract base adapter. Every Event Source must implement this.
    Adding a new source = subclass this + implement 4 methods + register endpoint.
    """

    @abstractmethod
    def get_source_name(self) -> str:
        """Return source identifier string (e.g., 'PRTG')."""
        pass

    @abstractmethod
    def validate_payload(self, raw_payload: dict) -> tuple[bool, str]:
        """
        Validate raw payload from source.
        Returns (is_valid, error_message).
        """
        pass

    @abstractmethod
    def normalize(self, raw_payload: dict, received_time: datetime) -> NormalizedEventData:
        """
        Convert raw source payload into NormalizedEventData.
        This is the ONLY place where source-specific field mapping happens.
        """
        pass

    @abstractmethod
    def authenticate(self, token: Optional[str]) -> bool:
        """
        Validate source authentication (e.g., API token, shared secret).
        """
        pass
