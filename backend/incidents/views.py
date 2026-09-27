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
    Comprehensive Incident Reporting API:
    - Time-range filtering (preset: 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'custom')
    - Incident Type filtering (?incident_type=all | device | link)
    - Breakdown by Thailand Geographical Region (ภาค)
    - Drill-down to Province level (จังหวัด), Device, and Interface level
    - Root Cause Classification breakdown (both Device and Link root causes)
    - Flapping cycles & Net Downtime statistics
    - Top impacted devices & Top unstable links / interfaces
    """

    def get(self, request):
        now = timezone.now()
        preset = request.query_params.get('preset', 'all').lower()
        incident_type = request.query_params.get('incident_type', 'all').lower()
        start_date_str = request.query_params.get('start_date')
        end_date_str = request.query_params.get('end_date')
        region_filter = request.query_params.get('region')
        province_filter = request.query_params.get('province')
        classification_filter = request.query_params.get('classification')

        start_time = None
        end_time = None

        if preset == 'today':
            start_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
            end_time = now
        elif preset == 'yesterday':
            yesterday = now - timedelta(days=1)
            start_time = yesterday.replace(hour=0, minute=0, second=0, microsecond=0)
            end_time = yesterday.replace(hour=23, minute=59, second=59, microsecond=999999)
        elif preset == '7d':
            start_time = now - timedelta(days=7)
            end_time = now
        elif preset == '30d':
            start_time = now - timedelta(days=30)
            end_time = now
        elif preset == 'custom' or start_date_str or end_date_str:
            if start_date_str:
                try:
                    s_clean = start_date_str.replace('Z', '+00:00')
                    if len(s_clean) == 10:  # YYYY-MM-DD
                        s_clean += "T00:00:00"
                    st = timezone.datetime.fromisoformat(s_clean)
                    start_time = timezone.make_aware(st) if timezone.is_naive(st) else st
                except Exception:
                    pass
            if end_date_str:
                try:
                    e_clean = end_date_str.replace('Z', '+00:00')
                    if len(e_clean) == 10:  # YYYY-MM-DD
                        e_clean += "T23:59:59"
                    et = timezone.datetime.fromisoformat(e_clean)
                    end_time = timezone.make_aware(et) if timezone.is_naive(et) else et
                except Exception:
                    pass

        qs = Incident.objects.select_related('primary_device').all()
        if incident_type == 'device':
            qs = qs.filter(incident_type=IncidentType.DEVICE)
        elif incident_type == 'link':
            qs = qs.filter(incident_type=IncidentType.LINK)

        if start_time:
            qs = qs.filter(down_time__gte=start_time)
        if end_time:
            qs = qs.filter(down_time__lte=end_time)
        if classification_filter:
            qs = qs.filter(classification__iexact=classification_filter)

        incidents_list = list(qs.order_by('-down_time'))

        def create_causes_dict():
            return {
                'device_reboot_related': 0,
                'device_reboot_suspected': 0,
                'connectivity_loss': 0,
                'unable_to_verify': 0,
                'link_flapping': 0,
                'physical_link_failure': 0,
                'parent_device_down': 0,
                'admin_shutdown': 0,
                'connectivity_recovered': 0,
                'stabilizing_link': 0,
                'ongoing_down': 0,
            }

        # Prepare regions bucket
        regions = {r: {
            'region': r,
            'total_down': 0,
            'recovered_count': 0,
            'stabilizing_count': 0,
            'ongoing_count': 0,
            'total_flap_count': 0,
            'downtimes': [],
            'causes': create_causes_dict(),
            'provinces': {}
        } for r in REGIONS_ORDER}

        all_downtimes = []
        all_net_downtimes = []
        recovered_total = 0
        stabilizing_total = 0
        ongoing_total = 0
        total_flaps_accumulated = 0
        flapping_incidents_count = 0
        device_down_counts = {}
        link_unstable_counts = {}
        serialized_incidents = []

        for inc in incidents_list:
            dev = inc.primary_device
            prov_code = (dev.province_code or '').upper().strip()
            prov_name = dev.province or PROVINCE_MAP.get(prov_code, 'ไม่ระบุจังหวัด')
            if not prov_code and not prov_name:
                prov_name = 'ไม่ระบุจังหวัด'
                prov_code = 'UN'

            reg_name = get_region_for_province(prov_code, dev.sys_name or dev.name)
            if reg_name not in regions:
                regions[reg_name] = {
                    'region': reg_name,
                    'total_down': 0,
                    'recovered_count': 0,
                    'stabilizing_count': 0,
                    'ongoing_count': 0,
                    'total_flap_count': 0,
                    'downtimes': [],
                    'causes': create_causes_dict(),
                    'provinces': {}
                }

            # Optional filter by region/province
            if region_filter and reg_name != region_filter:
                continue
            if province_filter and prov_code != province_filter.upper():
                continue

            raw_cls = inc.classification or ''
            cause_key = 'ongoing_down'
            if inc.incident_type == IncidentType.LINK:
                if inc.status == IncidentStatus.STABILIZING:
                    cause_key = 'stabilizing_link'
                elif raw_cls == Classification.LINK_FLAPPING or (inc.flap_count and inc.flap_count >= 2):
                    cause_key = 'link_flapping'
                elif raw_cls == Classification.PHYSICAL_LINK_FAILURE:
                    cause_key = 'physical_link_failure'
                elif raw_cls == Classification.PARENT_DEVICE_DOWN:
                    cause_key = 'parent_device_down'
                elif raw_cls == Classification.ADMIN_SHUTDOWN:
                    cause_key = 'admin_shutdown'
                elif raw_cls == Classification.CONNECTIVITY_RECOVERED or inc.status == IncidentStatus.RECOVERED:
                    cause_key = 'connectivity_recovered'
                else:
                    cause_key = 'ongoing_down'
            else:
                if raw_cls == Classification.DEVICE_REBOOT_RELATED:
                    cause_key = 'device_reboot_related'
                elif raw_cls == Classification.DEVICE_REBOOT_SUSPECTED:
                    cause_key = 'device_reboot_suspected'
                elif raw_cls == Classification.CONNECTIVITY_LOSS:
                    cause_key = 'connectivity_loss'
                elif raw_cls == Classification.UNABLE_TO_VERIFY:
                    cause_key = 'unable_to_verify'
                elif inc.status == IncidentStatus.RECOVERED:
                    cause_key = 'connectivity_loss'
                else:
                    cause_key = 'ongoing_down'

            # Downtime calculation
            if inc.incident_type == IncidentType.LINK and inc.net_downtime_seconds and inc.net_downtime_seconds > 0:
                dt = inc.net_downtime_seconds
            else:
                dt = inc.downtime_seconds

            net_dt = inc.net_downtime_seconds if inc.net_downtime_seconds is not None else (dt or 0.0)

            flaps = inc.flap_count or 0
            total_flaps_accumulated += flaps
            if flaps >= 2 or raw_cls == Classification.LINK_FLAPPING:
                flapping_incidents_count += 1

            is_rec = inc.status == IncidentStatus.RECOVERED and dt is not None
            is_stabilizing = inc.status == IncidentStatus.STABILIZING
            if is_rec:
                all_downtimes.append(dt)
                if net_dt:
                    all_net_downtimes.append(net_dt)
                recovered_total += 1
            elif is_stabilizing:
                stabilizing_total += 1
            else:
                ongoing_total += 1

            reg = regions[reg_name]
            reg['total_down'] += 1
            reg['total_flap_count'] += flaps
            if is_rec:
                reg['recovered_count'] += 1
                reg['downtimes'].append(dt)
            elif is_stabilizing:
                reg['stabilizing_count'] += 1
            else:
                reg['ongoing_count'] += 1
            reg['causes'][cause_key] += 1

            if prov_code not in reg['provinces']:
                reg['provinces'][prov_code] = {
                    'province_code': prov_code,
                    'province_name': prov_name,
                    'total_down': 0,
                    'recovered_count': 0,
                    'stabilizing_count': 0,
                    'ongoing_count': 0,
                    'total_flap_count': 0,
                    'downtimes': [],
                    'causes': create_causes_dict(),
                    'devices': {}
                }

            p_entry = reg['provinces'][prov_code]
            p_entry['total_down'] += 1
            p_entry['total_flap_count'] += flaps
            if is_rec:
                p_entry['recovered_count'] += 1
                p_entry['downtimes'].append(dt)
            elif is_stabilizing:
                p_entry['stabilizing_count'] += 1
            else:
                p_entry['ongoing_count'] += 1
            p_entry['causes'][cause_key] += 1

            if dev.id not in p_entry['devices']:
                p_entry['devices'][dev.id] = {
                    'id': dev.id,
                    'device_id': dev.id,
                    'name': dev.name,
                    'sys_name': dev.sys_name or dev.name,
                    'ip': dev.management_ip,
                    'hardware_model': dev.hardware_model,
                    'down_count': 0,
                    'recovered_count': 0,
                    'stabilizing_count': 0,
                    'ongoing_count': 0,
                    'total_flap_count': 0,
                    'downtimes': [],
                    'causes': create_causes_dict(),
                    'total_downtime': 0,
                    'avg_downtime_seconds': 0,
                    'interfaces': {}
                }
            dev_entry = p_entry['devices'][dev.id]
            dev_entry['down_count'] += 1
            dev_entry['total_flap_count'] += flaps
            if is_rec:
                dev_entry['recovered_count'] += 1
                dev_entry['downtimes'].append(dt)
                dev_entry['total_downtime'] += dt
            elif is_stabilizing:
                dev_entry['stabilizing_count'] += 1
            else:
                dev_entry['ongoing_count'] += 1
            dev_entry['causes'][cause_key] += 1

            # Sub-interfaces tracking for devices
            if inc.interface_name:
                if inc.interface_name not in dev_entry['interfaces']:
                    dev_entry['interfaces'][inc.interface_name] = {
                        'interface_name': inc.interface_name,
                        'down_count': 0,
                        'recovered_count': 0,
                        'stabilizing_count': 0,
                        'ongoing_count': 0,
                        'flap_count': 0,
                        'total_downtime_seconds': 0.0,
                        'avg_downtime_seconds': 0.0,
                        'downtimes': [],
                        'last_status': inc.status,
                        'last_classification': inc.classification,
                    }
                if_item = dev_entry['interfaces'][inc.interface_name]
                if_item['down_count'] += 1
                if_item['flap_count'] += flaps
                if is_rec:
                    if_item['recovered_count'] += 1
                    if dt:
                        if_item['downtimes'].append(dt)
                        if_item['total_downtime_seconds'] += dt
                elif is_stabilizing:
                    if_item['stabilizing_count'] += 1
                else:
                    if_item['ongoing_count'] += 1

            if dev.id not in device_down_counts:
                device_down_counts[dev.id] = {
                    'id': dev.id,
                    'device_id': dev.id,
                    'name': dev.name,
                    'sys_name': dev.sys_name or dev.name,
                    'ip': dev.management_ip,
                    'hardware_model': dev.hardware_model,
                    'province_code': prov_code,
                    'province': prov_name,
                    'region': reg_name,
                    'down_count': 0,
                    'total_flap_count': 0,
                    'total_downtime_seconds': 0
                }
            device_down_counts[dev.id]['down_count'] += 1
            device_down_counts[dev.id]['total_flap_count'] += flaps
            if dt:
                device_down_counts[dev.id]['total_downtime_seconds'] += dt

            # Track links for Top Unstable Links
            if inc.incident_type == IncidentType.LINK and inc.interface_name:
                link_key = (dev.id, inc.interface_name)
                if link_key not in link_unstable_counts:
                    link_unstable_counts[link_key] = {
                        'device_id': dev.id,
                        'device_name': dev.name,
                        'sys_name': dev.sys_name or dev.name,
                        'management_ip': dev.management_ip,
                        'province': prov_name,
                        'region': reg_name,
                        'interface_name': inc.interface_name,
                        'down_count': 0,
                        'total_flap_count': 0,
                        'total_net_downtime_seconds': 0.0,
                        'status': inc.status,
                        'classification': inc.classification
                    }
                link_unstable_counts[link_key]['down_count'] += 1
                link_unstable_counts[link_key]['total_flap_count'] += flaps
                link_unstable_counts[link_key]['total_net_downtime_seconds'] += (net_dt or 0.0)
                link_unstable_counts[link_key]['status'] = inc.status
                link_unstable_counts[link_key]['classification'] = inc.classification

            serialized_incidents.append({
                'id': inc.id,
                'incident_number': inc.incident_number,
                'incident_type': inc.incident_type,
                'interface_name': inc.interface_name or '',
                'flap_count': inc.flap_count or 0,
                'net_downtime_seconds': inc.net_downtime_seconds,
                'soak_until': inc.soak_until.isoformat() if inc.soak_until else None,
                'device_id': dev.id,
                'device_name': dev.name,
                'sys_name': dev.sys_name or dev.name,
                'device_ip': dev.management_ip,
                'hardware_model': dev.hardware_model,
                'serial_number': dev.serial_number,
                'province': prov_name,
                'province_code': prov_code,
                'region': reg_name,
                'status': inc.status,
                'classification': inc.classification,
                'confidence': inc.confidence,
                'down_time': inc.down_time.isoformat() if inc.down_time else None,
                'up_time': inc.up_time.isoformat() if inc.up_time else None,
                'downtime_seconds': dt,
            })

        # Format regions output
        regions_list = []
        for r_name, r_data in regions.items():
            if region_filter and r_name != region_filter:
                continue
            if not region_filter and r_data['total_down'] == 0:
                continue

            prov_list = []
            for p_code, p_data in r_data['provinces'].items():
                if province_filter and p_code != province_filter.upper():
                    continue
                devs_list = []
                for d_item in p_data['devices'].values():
                    d_avg = round(sum(d_item['downtimes']) / len(d_item['downtimes']), 1) if d_item.get('downtimes') else 0
                    d_item_copy = dict(d_item)
                    d_item_copy['avg_downtime_seconds'] = d_avg
                    d_item_copy['total_downtime_seconds'] = d_item.get('total_downtime', 0)
                    d_item_copy.pop('downtimes', None)
                    # Convert interfaces dictionary to sorted array
                    if_list = list(d_item_copy.get('interfaces', {}).values())
                    for if_obj in if_list:
                        if_obj['avg_downtime_seconds'] = round(sum(if_obj['downtimes']) / len(if_obj['downtimes']), 1) if if_obj.get('downtimes') else 0
                        if_obj.pop('downtimes', None)
                    if_list.sort(key=lambda x: (x['flap_count'], x['down_count']), reverse=True)
                    d_item_copy['interfaces'] = if_list
                    devs_list.append(d_item_copy)

                devs_list.sort(key=lambda x: (x.get('total_flap_count', 0), x['down_count']), reverse=True)
                p_avg = round(sum(p_data['downtimes']) / len(p_data['downtimes']), 1) if p_data['downtimes'] else 0
                prov_list.append({
                    'province_code': p_code,
                    'province_name': p_data['province_name'],
                    'total_down': p_data['total_down'],
                    'recovered_count': p_data['recovered_count'],
                    'stabilizing_count': p_data['stabilizing_count'],
                    'ongoing_count': p_data['ongoing_count'],
                    'total_flap_count': p_data['total_flap_count'],
                    'avg_downtime_seconds': p_avg,
                    'causes': p_data['causes'],
                    'devices': devs_list
                })

            prov_list.sort(key=lambda x: x['total_down'], reverse=True)
            r_avg = round(sum(r_data['downtimes']) / len(r_data['downtimes']), 1) if r_data['downtimes'] else 0
            regions_list.append({
                'region': r_name,
                'total_down': r_data['total_down'],
                'recovered_count': r_data['recovered_count'],
                'stabilizing_count': r_data['stabilizing_count'],
                'ongoing_count': r_data['ongoing_count'],
                'total_flap_count': r_data['total_flap_count'],
                'avg_downtime_seconds': r_avg,
                'causes': r_data['causes'],
                'provinces': prov_list
            })

        regions_list.sort(key=lambda x: x['total_down'], reverse=True)

        # Global Root Cause Summary
        total_incidents_count = len(serialized_incidents)
        causes_summary = {k: sum(r['causes'][k] for r in regions_list) for k in create_causes_dict().keys()}

        if incident_type == 'link':
            root_causes_breakdown = [
                {
                    'key': 'link_flapping',
                    'label': 'Link Flapping (พอร์ตกระพริบซ้ำๆ)',
                    'count': causes_summary['link_flapping'],
                    'color': '#a855f7'
                },
                {
                    'key': 'physical_link_failure',
                    'label': 'Physical Link Failure (สายขาด/พอร์ตดับ)',
                    'count': causes_summary['physical_link_failure'],
                    'color': '#ef4444'
                },
                {
                    'key': 'parent_device_down',
                    'label': 'Parent Device Down (เราเตอร์หลักดับ)',
                    'count': causes_summary['parent_device_down'],
                    'color': '#f97316'
                },
                {
                    'key': 'admin_shutdown',
                    'label': 'Admin Shutdown (ปิดพอร์ตโดยผู้ดูแล)',
                    'count': causes_summary['admin_shutdown'],
                    'color': '#64748b'
                },
                {
                    'key': 'connectivity_recovered',
                    'label': 'Connectivity Recovered (กู้คืนปกติ)',
                    'count': causes_summary['connectivity_recovered'],
                    'color': '#10b981'
                },
                {
                    'key': 'stabilizing_link',
                    'label': 'Stabilizing (รอดูอาการ 45 นาที)',
                    'count': causes_summary['stabilizing_link'],
                    'color': '#06b6d4'
                },
                {
                    'key': 'ongoing_down',
                    'label': 'Active Down (อยู่ระหว่างดับ)',
                    'count': causes_summary['ongoing_down'],
                    'color': '#f43f5e'
                }
            ]
        elif incident_type == 'device':
            root_causes_breakdown = [
                {
                    'key': 'device_reboot_related',
                    'label': 'Device Reboot (ยืนยัน Reboot)',
                    'count': causes_summary['device_reboot_related'],
                    'color': '#ef4444'
                },
                {
                    'key': 'device_reboot_suspected',
                    'label': 'Suspected Reboot (สงสัย Reboot)',
                    'count': causes_summary['device_reboot_suspected'],
                    'color': '#f97316'
                },
                {
                    'key': 'connectivity_loss',
                    'label': 'Connectivity Loss (เครือข่ายขัดข้อง)',
                    'count': causes_summary['connectivity_loss'],
                    'color': '#0ea5e9'
                },
                {
                    'key': 'unable_to_verify',
                    'label': 'Unable to Verify (ตรวจไม่สำเร็จ)',
                    'count': causes_summary['unable_to_verify'],
                    'color': '#a855f7'
                },
                {
                    'key': 'ongoing_down',
                    'label': 'Ongoing / Awaiting Recovery (อยู่ระหว่าง Down)',
                    'count': causes_summary['ongoing_down'],
                    'color': '#f43f5e'
                }
            ]
        else:  # all
            root_causes_breakdown = [
                {
                    'key': 'link_flapping',
                    'label': 'Link Flapping (พอร์ตกระพริบ)',
                    'count': causes_summary['link_flapping'],
                    'color': '#a855f7'
                },
                {
                    'key': 'physical_link_failure',
                    'label': 'Physical Link Failure (สายขาด/พอร์ตดับ)',
                    'count': causes_summary['physical_link_failure'],
                    'color': '#ef4444'
                },
                {
                    'key': 'device_reboot_related',
                    'label': 'Device Reboot (ยืนยัน Reboot)',
                    'count': causes_summary['device_reboot_related'],
                    'color': '#dc2626'
                },
                {
                    'key': 'device_reboot_suspected',
                    'label': 'Suspected Reboot (สงสัย Reboot)',
                    'count': causes_summary['device_reboot_suspected'],
                    'color': '#f97316'
                },
                {
                    'key': 'parent_device_down',
                    'label': 'Parent Device Down (เราเตอร์หลักดับ)',
                    'count': causes_summary['parent_device_down'],
                    'color': '#ea580c'
                },
                {
                    'key': 'connectivity_loss',
                    'label': 'Connectivity Loss (เครือข่ายขัดข้อง)',
                    'count': causes_summary['connectivity_loss'],
                    'color': '#0ea5e9'
                },
                {
                    'key': 'unable_to_verify',
                    'label': 'Unable to Verify (ตรวจไม่สำเร็จ)',
                    'count': causes_summary['unable_to_verify'],
                    'color': '#8b5cf6'
                },
                {
                    'key': 'admin_shutdown',
                    'label': 'Admin Shutdown (ปิดพอร์ตโดยผู้ดูแล)',
                    'count': causes_summary['admin_shutdown'],
                    'color': '#64748b'
                },
                {
                    'key': 'connectivity_recovered',
                    'label': 'Connectivity Recovered (กู้คืนปกติ)',
                    'count': causes_summary['connectivity_recovered'],
                    'color': '#10b981'
                },
                {
                    'key': 'stabilizing_link',
                    'label': 'Stabilizing (รอดูอาการ)',
                    'count': causes_summary['stabilizing_link'],
                    'color': '#06b6d4'
                },
                {
                    'key': 'ongoing_down',
                    'label': 'Ongoing Down (อยู่ระหว่างดับ)',
                    'count': causes_summary['ongoing_down'],
                    'color': '#f43f5e'
                }
            ]

        for rc in root_causes_breakdown:
            rc['percentage'] = round(rc['count'] / total_incidents_count * 100, 1) if total_incidents_count else 0

        # Top Impacted Devices & Unstable Links
        top_devices = sorted(device_down_counts.values(), key=lambda x: (x['down_count'], x['total_downtime_seconds']), reverse=True)[:10]
        top_unstable_links = sorted(link_unstable_counts.values(), key=lambda x: (x['total_flap_count'], x['down_count'], x['total_net_downtime_seconds']), reverse=True)[:10]

        # Summary KPIs
        most_affected_reg = regions_list[0]['region'] if regions_list else '-'
        most_affected_prov = '-'
        if regions_list and regions_list[0]['provinces']:
            most_affected_prov = f"{regions_list[0]['provinces'][0]['province_name']} ({regions_list[0]['provinces'][0]['province_code']})"

        top_cause_entry = max(root_causes_breakdown, key=lambda x: x['count']) if root_causes_breakdown else None
        top_cause_str = f"{top_cause_entry['label']} ({top_cause_entry['count']} ครั้ง)" if top_cause_entry and top_cause_entry['count'] > 0 else 'ไม่มีเหตุการณ์'

        top_unstable_interface_str = f"{top_unstable_links[0]['sys_name']} - {top_unstable_links[0]['interface_name']} (Flap {top_unstable_links[0]['total_flap_count']} รอบ)" if top_unstable_links and top_unstable_links[0]['total_flap_count'] > 0 else '-'

        avg_dt = round(sum(all_downtimes) / len(all_downtimes), 1) if all_downtimes else 0
        avg_net_dt = round(sum(all_net_downtimes) / len(all_net_downtimes), 1) if all_net_downtimes else 0

        return Response({
            'status': 'success',
            'query': {
                'preset': preset,
                'incident_type': incident_type,
                'start_time': start_time.isoformat() if start_time else None,
                'end_time': end_time.isoformat() if end_time else None,
                'region_filter': region_filter,
                'province_filter': province_filter,
                'classification_filter': classification_filter,
            },
            'summary': {
                'incident_type': incident_type,
                'total_incidents': total_incidents_count,
                'recovered_count': recovered_total,
                'stabilizing_count': stabilizing_total,
                'ongoing_count': ongoing_total,
                'recovery_rate_percent': round((recovered_total / total_incidents_count * 100), 1) if total_incidents_count else 0,
                'avg_downtime_seconds': avg_dt,
                'total_downtime_seconds': sum(all_downtimes),
                'avg_net_downtime_seconds': avg_net_dt,
                'total_net_downtime_seconds': sum(all_net_downtimes),
                'total_flap_cycles': total_flaps_accumulated,
                'flapping_incident_count': flapping_incidents_count,
                'most_affected_region': most_affected_reg,
                'most_affected_province': most_affected_prov,
                'top_root_cause': top_cause_str,
                'top_unstable_interface': top_unstable_interface_str,
                'affected_devices_count': len(device_down_counts),
                'affected_interfaces_count': len(link_unstable_counts),
            },
            'by_region': regions_list,
            'by_root_cause': root_causes_breakdown,
            'top_devices': top_devices,
            'top_unstable_links': top_unstable_links,
            'incidents': serialized_incidents
        })

