from datetime import timedelta
from django.db.models import Count, Avg, F, Q
from django.utils import timezone
from rest_framework import generics, filters, status
from rest_framework.views import APIView
from rest_framework.response import Response

from common.constants import IncidentStatus, Classification, IncidentType, TimelineEventType
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
    search_fields = [
        'incident_number', 'primary_device__name', 'primary_device__management_ip',
        'interface_name', 'ticket_id_tss', 'circuit_id', 'remote_device',
        'site_name', 'repair_team', 'tts_status'
    ]
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

    def perform_update(self, serializer):
        old_cls = serializer.instance.classification
        old_conf = serializer.instance.confidence
        instance = serializer.save()

        # Audit timeline entry on manual classification / confidence update
        cls_changed = 'classification' in serializer.validated_data and serializer.validated_data['classification'] != old_cls
        conf_changed = 'confidence' in serializer.validated_data and serializer.validated_data['confidence'] != old_conf

        if cls_changed or conf_changed:
            instance.add_timeline_entry(
                event_type=TimelineEventType.CLASSIFICATION_COMPLETED,
                source='MANUAL_OVERRIDE',
                description=f"RCA classification manually updated to {instance.classification} ({instance.confidence or 'HIGH'})",
                data={
                    'classification': instance.classification,
                    'confidence': instance.confidence,
                    'previous_classification': old_cls,
                    'previous_confidence': old_conf,
                }
            )


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


class IncidentSyncTicketView(APIView):
    """
    On-demand trigger to sync TSS Trouble Ticket & Circuit info from IPGET for a specific incident.
    POST /api/v1/incidents/{pk}/sync-ticket/
    """
    def post(self, request, pk):
        try:
            incident = Incident.objects.select_related('primary_device').get(pk=pk)
        except Incident.DoesNotExist:
            return Response({'status': 'error', 'message': 'Incident not found'}, status=status.HTTP_404_NOT_FOUND)

        force_refresh = request.data.get('force_refresh', False) if (hasattr(request, 'data') and isinstance(request.data, dict)) else False
        from incidents.tasks import sync_single_incident_ticket_task
        res = sync_single_incident_ticket_task(incident.id, force_refresh=force_refresh)
        incident.refresh_from_db()
        return Response({
            'status': 'success',
            'sync_result': res,
            'ticket_id_tss': incident.ticket_id_tss,
            'ticket_id_osticket': incident.ticket_id_osticket,
            'osticket_status': incident.osticket_status,
            'circuit_id': incident.circuit_id,
            'remote_device': incident.remote_device,
            'remote_interface': incident.remote_interface,
            'site_name': incident.site_name,
            'tts_status': incident.tts_status,
            'repair_team': incident.repair_team,
            'response_department': incident.response_department,
            'actual_cause': incident.actual_cause,
            'resolution': incident.resolution,
            'source_gps': incident.source_gps,
            'dest_gps': incident.dest_gps,
        })


class IncidentTicketEligibilityView(APIView):
    """
    Evaluates the 4 strict conditions for opening a ticket for an incident:
    1. Confirmed down info from IPGET API 1 (/device/alarm/interface/)
    2. Circuit ID present from IPGET API 1
    3. Continuous downtime >= 15 minutes (900 seconds)
    4. No existing ticket already opened
    GET /api/v1/incidents/{pk}/ticket-eligibility/
    """
    def get(self, request, pk):
        try:
            incident = Incident.objects.select_related('primary_device').get(pk=pk)
        except Incident.DoesNotExist:
            return Response({'status': 'error', 'message': 'Incident not found'}, status=status.HTTP_404_NOT_FOUND)

        force_refresh = request.query_params.get('force_refresh', 'false').lower() in ('true', '1')
        from incidents.services import TicketPolicyService
        policy = TicketPolicyService()
        result = policy.evaluate_eligibility(incident, force_refresh=force_refresh)
        desc = policy.build_ticket_description(incident, result.get('matched_alarm'), result.get('circuit_id'))
        result['proposed_description'] = desc
        return Response(result)


class IncidentOpenTicketView(APIView):
    """
    Opens an incident ticket on NT TTS via tts-service sub-container after validating the 4 strict conditions.
    POST /api/v1/incidents/{pk}/open-ticket/
    """
    def post(self, request, pk):
        try:
            incident = Incident.objects.select_related('primary_device').get(pk=pk)
        except Incident.DoesNotExist:
            return Response({'status': 'error', 'message': 'Incident not found'}, status=status.HTTP_404_NOT_FOUND)

        from incidents.services import TicketPolicyService
        from integrations.tts import TTSClient
        policy = TicketPolicyService()
        eval_result = policy.evaluate_eligibility(incident)

        force = request.data.get('force', False)
        if not eval_result['is_eligible'] and not force:
            return Response({
                'status': 'error',
                'message': 'Incident does not meet the 4 required conditions for opening a ticket',
                'reasons': eval_result['reasons'],
                'evaluation': eval_result
            }, status=status.HTTP_400_BAD_REQUEST)

        circuit_id = request.data.get('circuit_id') or eval_result.get('circuit_id') or incident.circuit_id
        if not circuit_id:
            return Response({'status': 'error', 'message': 'Circuit ID is required'}, status=status.HTTP_400_BAD_REQUEST)

        description = request.data.get('description') or policy.build_ticket_description(
            incident, eval_result.get('matched_alarm'), circuit_id
        )
        assignment_group = request.data.get('assignment_group') or "ขทค. DATACOM [ Tier 1 ]"
        title = request.data.get('title') or "Down"

        # Resolve GPS coordinates from NTSite API or existing incident attributes
        matched = eval_result.get('matched_alarm') or {}
        src_site_id = matched.get('site_id')
        dest_site_id = matched.get('dest_site_id')
        src_info = policy.ipget.fetch_site_info(src_site_id) if src_site_id else None
        dest_info = policy.ipget.fetch_site_info(dest_site_id) if dest_site_id else None

        source_lat = (src_info.get('latitude') if src_info else None) or (incident.source_gps.split(',')[0].strip() if incident.source_gps and ',' in incident.source_gps else '')
        source_lon = (src_info.get('longitude') if src_info else None) or (incident.source_gps.split(',')[1].strip() if incident.source_gps and ',' in incident.source_gps else '')
        dest_lat = (dest_info.get('latitude') if dest_info else None) or (incident.dest_gps.split(',')[0].strip() if incident.dest_gps and ',' in incident.dest_gps else '')
        dest_lon = (dest_info.get('longitude') if dest_info else None) or (incident.dest_gps.split(',')[1].strip() if incident.dest_gps and ',' in incident.dest_gps else '')

        tts_client = TTSClient()
        res = tts_client.open_ticket(
            circuit_id=circuit_id,
            description=description,
            assignment_group=assignment_group,
            title=title,
            source_latitude=source_lat,
            source_longitude=source_lon,
            dest_latitude=dest_lat,
            dest_longitude=dest_lon
        )

        if not res.get('success'):
            return Response({
                'status': 'error',
                'message': 'Failed to open ticket on NT TTS',
                'error': res.get('error'),
                'details': res
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Update Incident in Database (prioritize SD... interaction_id to match IPGET standard)
        interaction_id = res.get('interaction_id')
        incident_id = res.get('incident_id')

        # Fallback verification: If interaction_id is missing or doesn't start with 'SD', query IPGET API 3
        if not interaction_id or not str(interaction_id).startswith('SD'):
            try:
                from integrations.ipget import IPGETClient
                ipget = IPGETClient()
                tts_list = ipget.fetch_tts_by_ntids([circuit_id], prefer_cache=False, force_refresh=True)
                if tts_list and tts_list[0].get('INCIDENT_ID') and str(tts_list[0]['INCIDENT_ID']).startswith('SD'):
                    interaction_id = tts_list[0]['INCIDENT_ID']
                    logger.info(f"Resolved interaction_id {interaction_id} from IPGET API 3 for circuit {circuit_id}")
            except Exception as e:
                logger.warning(f"Failed to resolve interaction_id from IPGET: {e}")

        ticket_id = interaction_id or incident_id or incident.ticket_id_tss
        incident.ticket_id_tss = ticket_id
        incident.circuit_id = circuit_id
        incident.tts_status = 'Open'
        incident.repair_team = assignment_group
        up_fields = ['ticket_id_tss', 'circuit_id', 'tts_status', 'repair_team', 'updated_at']
        if source_lat and source_lon and not incident.source_gps:
            incident.source_gps = f"{source_lat}, {source_lon}"
            up_fields.append('source_gps')
        if dest_lat and dest_lon and not incident.dest_gps:
            incident.dest_gps = f"{dest_lat}, {dest_lon}"
            up_fields.append('dest_gps')
        incident.save(update_fields=up_fields)

        # Add Timeline Entry
        from common.constants import TimelineEventType
        incident.add_timeline_entry(
            event_type=TimelineEventType.TICKET_LINKED,
            source='NT_TTS_GATEWAY',
            description=f"Opened Trouble Ticket {ticket_id} on NT TTS (Incident ID: {incident_id or '-'})",
            data={
                'incident_id': incident_id,
                'interaction_id': interaction_id,
                'ticket_id_tss': ticket_id,
                'circuit_id': circuit_id,
                'fault_time': res.get('fault_time'),
                'assignment_group': assignment_group
            }
        )

        # Trigger osTicket creation automatically right after NT TTS ticket is obtained
        osticket_res = None
        try:
            from integrations.osticket import OSTicketClient
            osticket_client = OSTicketClient()
            osticket_res = osticket_client.open_ticket(
                incident=incident,
                circuit_id=circuit_id,
                cat_tts=ticket_id,
                action_summary=description
            )
            logger.info(f"Auto osTicket creation result for {incident.incident_number}: {osticket_res}")
        except Exception as e:
            logger.error(f"Failed auto osTicket creation for {incident.incident_number}: {e}")

        # Refresh incident in memory to get updated osticket fields
        incident.refresh_from_db()

        return Response({
            'status': 'success',
            'incident_id': incident_id,
            'interaction_id': interaction_id,
            'ticket_id_tss': ticket_id,
            'ticket_id_osticket': incident.ticket_id_osticket,
            'osticket_status': incident.osticket_status,
            'osticket_result': osticket_res,
            'circuit_id': circuit_id,
            'tts_status': 'Open',
            'fault_time': res.get('fault_time'),
        })


class IncidentOpenOSTicketView(APIView):
    """
    Manually creates or links an osTicket for an incident.
    POST /api/v1/incidents/{pk}/open-osticket/
    """
    def post(self, request, pk):
        try:
            incident = Incident.objects.select_related('primary_device').get(pk=pk)
        except Incident.DoesNotExist:
            return Response({'status': 'error', 'message': 'Incident not found'}, status=status.HTTP_404_NOT_FOUND)

        force = request.data.get('force', False)
        circuit_id = request.data.get('circuit_id') or incident.circuit_id
        cat_tts = request.data.get('cat_tts') or incident.ticket_id_tss
        action_summary = request.data.get('action_summary')

        from integrations.osticket import OSTicketClient
        client = OSTicketClient()
        res = client.open_ticket(
            incident=incident,
            circuit_id=circuit_id,
            cat_tts=cat_tts,
            action_summary=action_summary,
            force=force
        )

        if not res.get('success'):
            return Response({
                'status': 'error',
                'message': res.get('error') or 'Failed to create osTicket',
                'details': res
            }, status=status.HTTP_400_BAD_REQUEST)

        incident.refresh_from_db()
        return Response({
            'status': 'success',
            'ticket_id_osticket': incident.ticket_id_osticket,
            'osticket_status': incident.osticket_status,
            'details': res
        })


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
        power_outage_count = Incident.objects.filter(classification=Classification.POWER_OUTAGE_REBOOT).count()
        reboot_related = Incident.objects.filter(classification=Classification.DEVICE_REBOOT_RELATED).count()
        reboot_suspected = Incident.objects.filter(classification=Classification.DEVICE_REBOOT_SUSPECTED).count()
        manual_reload_count = Incident.objects.filter(classification=Classification.MANUAL_RELOAD).count()
        software_crash_count = Incident.objects.filter(classification=Classification.SOFTWARE_CRASH).count()
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
                "power_outage_reboot": power_outage_count,
                "device_reboot_related": reboot_related,
                "device_reboot_suspected": reboot_suspected,
                "manual_reload": manual_reload_count,
                "software_crash": software_crash_count,
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
