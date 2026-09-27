from datetime import timedelta
from django.db.models import Count, Avg, F, Q
from django.utils import timezone
from rest_framework import generics, filters, status
from rest_framework.views import APIView
from rest_framework.response import Response

from common.constants import IncidentStatus, Classification, IncidentType
from incidents.models import Incident, EventTimeline, IncidentEvent
from verification.models import Verification
from devices.models import Device
from devices.province_mapping import get_region_for_province, REGIONS_ORDER, PROVINCE_MAP
from incidents.serializers import (
    IncidentListSerializer, IncidentDetailSerializer,
    EventTimelineSerializer, IncidentEventSerializer
)
from incidents.services.report_service import IncidentReportService, ReportFilterParams
from verification.serializers import VerificationSerializer


class IncidentListView(generics.ListAPIView):
    """
    List incidents with filtering, search, and ordering.
    Filters:
      - ?incident_type=DEVICE | LINK
      - ?status=DOWN | FLAPPING | STABILIZING | RECOVERY_CHECK | RECOVERED | VERIFICATION_FAILED | MANUAL_REVIEW_REQUIRED
      - ?classification=...
      - ?device=<device_id>
      - ?active=true | false
      - ?search=<keyword>
    """
    serializer_class = IncidentListSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['incident_number', 'primary_device__name', 'primary_device__management_ip', 'interface_name']
    ordering_fields = ['down_time', 'up_time', 'created_at', 'incident_number']
    ordering = ['-down_time']

    def get_queryset(self):
        queryset = Incident.objects.select_related('primary_device').prefetch_related(
            'verifications', 'incident_events'
        ).all()

        incident_type_param = self.request.query_params.get('incident_type')
        status_param = self.request.query_params.get('status')
        classification_param = self.request.query_params.get('classification')
        device_param = self.request.query_params.get('device')
        active_param = self.request.query_params.get('active')

        if incident_type_param:
            queryset = queryset.filter(incident_type__iexact=incident_type_param)
        if status_param:
            queryset = queryset.filter(status__iexact=status_param)
        if classification_param:
            queryset = queryset.filter(classification__iexact=classification_param)
        if device_param:
            queryset = queryset.filter(primary_device_id=device_param)
        if active_param is not None:
            if active_param.lower() in ('true', '1'):
                queryset = queryset.filter(status__in=IncidentStatus.ACTIVE_STATUSES)
            elif active_param.lower() in ('false', '0'):
                queryset = queryset.filter(status__in=IncidentStatus.TERMINAL_STATUSES)

        return queryset


class IncidentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or delete incident (including cascade deletion of timeline/verifications)."""
    queryset = Incident.objects.select_related('primary_device').prefetch_related(
        'timeline', 'verifications', 'verifications__device',
        'incident_events', 'incident_events__event', 'incident_events__event__source',
        'primary_device__source_mappings', 'primary_device__source_mappings__source'
    ).all()
    serializer_class = IncidentDetailSerializer


class IncidentTimelineListView(generics.ListAPIView):
    """List timeline entries for an incident."""
    serializer_class = EventTimelineSerializer

    def get_queryset(self):
        incident_id = self.kwargs.get('pk')
        return EventTimeline.objects.filter(incident_id=incident_id).order_by('timestamp')


class IncidentVerificationsListView(generics.ListAPIView):
    """List verification attempts for an incident."""
    serializer_class = VerificationSerializer

    def get_queryset(self):
        incident_id = self.kwargs.get('pk')
        return Verification.objects.filter(incident_id=incident_id).order_by('attempt_number')


class IncidentEventsListView(generics.ListAPIView):
    """List raw/normalized events associated with an incident."""
    serializer_class = IncidentEventSerializer

    def get_queryset(self):
        incident_id = self.kwargs.get('pk')
        return IncidentEvent.objects.filter(incident_id=incident_id).select_related('event', 'event__source', 'event__device').order_by('-created_at')


class DashboardSummaryView(APIView):
    """
    Dashboard metrics summary endpoint.
    Aggregates incident counts by status and classification, device counts, and recent items.
    Differentiates Device reachability vs Link/interface outages and flapping.
    """

    def get(self, request):
        now = timezone.now()

        # Status counts
        total_incidents = Incident.objects.count()
        device_down = Incident.objects.filter(incident_type=IncidentType.DEVICE, status=IncidentStatus.DOWN).count()
        link_down = Incident.objects.filter(incident_type=IncidentType.LINK, status=IncidentStatus.DOWN).count()
        flapping = Incident.objects.filter(status=IncidentStatus.FLAPPING).count()
        stabilizing = Incident.objects.filter(status=IncidentStatus.STABILIZING).count()
        recovery_check = Incident.objects.filter(status=IncidentStatus.RECOVERY_CHECK).count()
        recovered = Incident.objects.filter(status=IncidentStatus.RECOVERED).count()
        verification_failed = Incident.objects.filter(status=IncidentStatus.VERIFICATION_FAILED).count()
        manual_review = Incident.objects.filter(status=IncidentStatus.MANUAL_REVIEW_REQUIRED).count()

        total_active = device_down + link_down + flapping + stabilizing + recovery_check + verification_failed

        # Classification counts
        reboot_related = Incident.objects.filter(classification=Classification.DEVICE_REBOOT_RELATED).count()
        reboot_suspected = Incident.objects.filter(classification=Classification.DEVICE_REBOOT_SUSPECTED).count()
        connectivity_loss = Incident.objects.filter(classification=Classification.CONNECTIVITY_LOSS).count()
        unable_to_verify = Incident.objects.filter(classification=Classification.UNABLE_TO_VERIFY).count()
        link_flapping_count = Incident.objects.filter(classification=Classification.LINK_FLAPPING).count()
        parent_device_down_count = Incident.objects.filter(classification=Classification.PARENT_DEVICE_DOWN).count()
        physical_link_failure_count = Incident.objects.filter(classification=Classification.PHYSICAL_LINK_FAILURE).count()

        # Devices count (strictly for DEVICE incidents, avoiding false alerts from single interface drops)
        total_devices = Device.objects.count()
        devices_down = Device.objects.filter(
            incidents__incident_type=IncidentType.DEVICE,
            incidents__status=IncidentStatus.DOWN
        ).distinct().count()

        # Average downtime (for recovered incidents)
        recovered_incidents = Incident.objects.filter(status=IncidentStatus.RECOVERED, up_time__isnull=False)
        downtimes = [
            inc.downtime_seconds for inc in recovered_incidents
            if inc.downtime_seconds is not None
        ]
        avg_downtime = round(sum(downtimes) / len(downtimes), 1) if downtimes else 0

        # Recent incidents (top 6)
        recent_qs = Incident.objects.select_related('primary_device').prefetch_related(
            'verifications', 'incident_events'
        ).order_by('-created_at')[:6]
        recent_serialized = IncidentListSerializer(recent_qs, many=True).data

        # Recent timeline audits
        recent_audit_qs = EventTimeline.objects.filter(incident__isnull=True).order_by('-timestamp')[:5]
        recent_audits = EventTimelineSerializer(recent_audit_qs, many=True).data

        return Response({
            "status": "success",
            "timestamp": now.isoformat(),
            "counts": {
                "total_incidents": total_incidents,
                "active_down": device_down + link_down,
                "device_down": device_down,
                "link_down": link_down,
                "flapping": flapping,
                "stabilizing": stabilizing,
                "recovery_check": recovery_check,
                "recovered": recovered,
                "verification_failed": verification_failed,
                "manual_review_required": manual_review,
                "total_active": total_active
            },
            "classifications": {
                "device_reboot_related": reboot_related,
                "device_reboot_suspected": reboot_suspected,
                "connectivity_loss": connectivity_loss,
                "unable_to_verify": unable_to_verify,
                "link_flapping": link_flapping_count,
                "parent_device_down": parent_device_down_count,
                "physical_link_failure": physical_link_failure_count,
            },
            "devices": {
                "total_devices": total_devices,
                "devices_down": devices_down,
                "healthy_devices": max(0, total_devices - devices_down)
            },
            "metrics": {
                "avg_downtime_seconds": avg_downtime,
                "recovery_rate_percent": round((recovered / total_incidents * 100), 1) if total_incidents > 0 else 0
            },
            "recent_incidents": recent_serialized,
            "standalone_audits": recent_audits
        })


class IncidentReportView(APIView):
    """
    Comprehensive Incident Reporting API.
    Delegates report aggregation and metrics computation to IncidentReportService.
    """

    def get(self, request):
        filters = ReportFilterParams.from_request(request)
        service = IncidentReportService(filters)
        report_data = service.generate_report()
        return Response(report_data, status=status.HTTP_200_OK)
