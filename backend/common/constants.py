"""
Shared constants, enums, and type definitions for Event Analyzer Platform.

These constants are source-agnostic and used across the entire system.
PRTG-specific values belong in integrations/prtg/, not here.
"""


# ==============================================================================
# Event Types — Generic, not tied to any specific source
# ==============================================================================

class EventType:
    DEVICE_REACHABILITY = 'DEVICE_REACHABILITY'
    LINK_STATUS = 'LINK_STATUS'

    CHOICES = [
        (DEVICE_REACHABILITY, 'Device Reachability'),
        (LINK_STATUS, 'Link / Interface Status'),
    ]


# ==============================================================================
# Event Status — What happened
# ==============================================================================

class EventStatus:
    DOWN = 'DOWN'
    UP = 'UP'

    CHOICES = [
        (DOWN, 'Down'),
        (UP, 'Up'),
    ]


# ==============================================================================
# Severity Levels
# ==============================================================================

class Severity:
    CRITICAL = 'CRITICAL'
    WARNING = 'WARNING'
    INFO = 'INFO'

    CHOICES = [
        (CRITICAL, 'Critical'),
        (WARNING, 'Warning'),
        (INFO, 'Info'),
    ]


# ==============================================================================
# Incident Types
# ==============================================================================

class IncidentType:
    DEVICE = 'DEVICE'
    LINK = 'LINK'

    CHOICES = [
        (DEVICE, 'Device Reachability'),
        (LINK, 'Link / Interface Status'),
    ]


# ==============================================================================
# Incident Status — State Machine
# ==============================================================================

class IncidentStatus:
    DOWN = 'DOWN'
    FLAPPING = 'FLAPPING'
    STABILIZING = 'STABILIZING'
    RECOVERY_CHECK = 'RECOVERY_CHECK'
    RECOVERED = 'RECOVERED'
    VERIFICATION_FAILED = 'VERIFICATION_FAILED'
    MANUAL_REVIEW_REQUIRED = 'MANUAL_REVIEW_REQUIRED'

    CHOICES = [
        (DOWN, 'Down'),
        (FLAPPING, 'Flapping'),
        (STABILIZING, 'Stabilizing (Hold-down)'),
        (RECOVERY_CHECK, 'Recovery Check'),
        (RECOVERED, 'Recovered'),
        (VERIFICATION_FAILED, 'Verification Failed'),
        (MANUAL_REVIEW_REQUIRED, 'Manual Review Required'),
    ]

    # Active statuses (incident is still open)
    ACTIVE_STATUSES = [DOWN, FLAPPING, STABILIZING, RECOVERY_CHECK, VERIFICATION_FAILED]

    # Terminal statuses (incident is closed)
    TERMINAL_STATUSES = [RECOVERED, MANUAL_REVIEW_REQUIRED]


# ==============================================================================
# Classification — INFERENCE, not FACT
# ==============================================================================

class Classification:
    DEVICE_REBOOT_RELATED = 'DEVICE_REBOOT_RELATED'
    DEVICE_REBOOT_SUSPECTED = 'DEVICE_REBOOT_SUSPECTED'
    CONNECTIVITY_LOSS = 'CONNECTIVITY_LOSS'
    UNABLE_TO_VERIFY = 'UNABLE_TO_VERIFY'
    # Link specific classifications
    PARENT_DEVICE_DOWN = 'PARENT_DEVICE_DOWN'
    PHYSICAL_LINK_FAILURE = 'PHYSICAL_LINK_FAILURE'
    ADMIN_SHUTDOWN = 'ADMIN_SHUTDOWN'
    LINK_FLAPPING = 'LINK_FLAPPING'
    TRANSIENT_GLITCH = 'TRANSIENT_GLITCH'
    CONNECTIVITY_RECOVERED = 'CONNECTIVITY_RECOVERED'

    CHOICES = [
        (DEVICE_REBOOT_RELATED, 'Device Reboot Related'),
        (DEVICE_REBOOT_SUSPECTED, 'Device Reboot Suspected'),
        (CONNECTIVITY_LOSS, 'Connectivity Loss'),
        (UNABLE_TO_VERIFY, 'Unable to Verify'),
        (PARENT_DEVICE_DOWN, 'Parent Device Down'),
        (PHYSICAL_LINK_FAILURE, 'Physical Link Failure'),
        (ADMIN_SHUTDOWN, 'Admin Shutdown'),
        (LINK_FLAPPING, 'Link Flapping'),
        (TRANSIENT_GLITCH, 'Transient Glitch'),
        (CONNECTIVITY_RECOVERED, 'Connectivity Recovered'),
    ]


# ==============================================================================
# Confidence Level
# ==============================================================================

class Confidence:
    HIGH = 'HIGH'
    MEDIUM = 'MEDIUM'
    LOW = 'LOW'

    CHOICES = [
        (HIGH, 'High'),
        (MEDIUM, 'Medium'),
        (LOW, 'Low'),
    ]


# ==============================================================================
# Timeline Event Types — For EventTimeline entries
# ==============================================================================

class TimelineEventType:
    DOWN = 'DOWN'
    DOWN_REPEAT = 'DOWN_REPEAT'
    UP_RECEIVED = 'UP_RECEIVED'
    UP_WITHOUT_ACTIVE_INCIDENT = 'UP_WITHOUT_ACTIVE_INCIDENT'
    SNMP_VERIFY_START = 'SNMP_VERIFY_START'
    SNMP_VERIFY_SUCCESS = 'SNMP_VERIFY_SUCCESS'
    SNMP_VERIFY_FAILED = 'SNMP_VERIFY_FAILED'
    SNMP_VERIFY_RETRY = 'SNMP_VERIFY_RETRY'
    CLASSIFICATION_COMPLETED = 'CLASSIFICATION_COMPLETED'
    RECOVERED = 'RECOVERED'
    MANUAL_REVIEW_REQUIRED = 'MANUAL_REVIEW_REQUIRED'
    # Link specific timeline events
    LINK_DOWN = 'LINK_DOWN'
    LINK_UP = 'LINK_UP'
    LINK_FLAP_DETECTED = 'LINK_FLAP_DETECTED'
    SOAK_TIMER_START = 'SOAK_TIMER_START'
    SOAK_TIMER_RESET = 'SOAK_TIMER_RESET'
    SOAK_TIMER_COMPLETED = 'SOAK_TIMER_COMPLETED'
    TICKET_LINKED = 'TICKET_LINKED'

    CHOICES = [
        (DOWN, 'Down'),
        (DOWN_REPEAT, 'Down Repeat'),
        (UP_RECEIVED, 'Up Received'),
        (UP_WITHOUT_ACTIVE_INCIDENT, 'Up Without Active Incident'),
        (SNMP_VERIFY_START, 'SNMP Verify Start'),
        (SNMP_VERIFY_SUCCESS, 'SNMP Verify Success'),
        (SNMP_VERIFY_FAILED, 'SNMP Verify Failed'),
        (SNMP_VERIFY_RETRY, 'SNMP Verify Retry'),
        (CLASSIFICATION_COMPLETED, 'Classification Completed'),
        (RECOVERED, 'Recovered'),
        (MANUAL_REVIEW_REQUIRED, 'Manual Review Required'),
        (LINK_DOWN, 'Link Down'),
        (LINK_UP, 'Link Up'),
        (LINK_FLAP_DETECTED, 'Link Flap Detected'),
        (SOAK_TIMER_START, 'Soak Timer Start'),
        (SOAK_TIMER_RESET, 'Soak Timer Reset'),
        (SOAK_TIMER_COMPLETED, 'Soak Timer Completed'),
        (TICKET_LINKED, 'Ticket Linked'),
    ]


# ==============================================================================
# Incident-Event Relationship Types
# ==============================================================================

class RelationshipType:
    PRIMARY = 'PRIMARY'
    RELATED = 'RELATED'
    SUPPORTING = 'SUPPORTING'
    RECOVERY = 'RECOVERY'

    CHOICES = [
        (PRIMARY, 'Primary'),
        (RELATED, 'Related'),
        (SUPPORTING, 'Supporting'),
        (RECOVERY, 'Recovery'),
    ]


# ==============================================================================
# Verification Types
# ==============================================================================

class VerificationType:
    SNMP_SYSUPTIME = 'SNMP_SYSUPTIME'

    CHOICES = [
        (SNMP_SYSUPTIME, 'SNMP sysUpTime'),
    ]


# ==============================================================================
# Verification Status
# ==============================================================================

class VerificationStatus:
    PENDING = 'PENDING'
    SUCCESS = 'SUCCESS'
    FAILED = 'FAILED'
    TIMEOUT = 'TIMEOUT'

    CHOICES = [
        (PENDING, 'Pending'),
        (SUCCESS, 'Success'),
        (FAILED, 'Failed'),
        (TIMEOUT, 'Timeout'),
    ]


# ==============================================================================
# Source Types — For EventSource model
# ==============================================================================

class SourceType:
    PRTG = 'PRTG'
    NMS = 'NMS'
    SYSLOG = 'SYSLOG'
    EMS = 'EMS'
    SNMP_TRAP = 'SNMP_TRAP'
    CUSTOM_API = 'CUSTOM_API'

    CHOICES = [
        (PRTG, 'PRTG Network Monitor'),
        (NMS, 'Network Management System'),
        (SYSLOG, 'Syslog Platform'),
        (EMS, 'Element Management System'),
        (SNMP_TRAP, 'SNMP Trap Receiver'),
        (CUSTOM_API, 'Custom API'),
    ]
