"""
Incident Reporting Service.
Extracts business calculations, geographical aggregation, and KPI metrics out of Views.
Follows Single Responsibility Principle and Clean Architecture.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from django.utils import timezone

from common.constants import IncidentStatus, Classification, IncidentType
from devices.province_mapping import get_region_for_province, REGIONS_ORDER, PROVINCE_MAP
from incidents.models import Incident


@dataclass(frozen=True)
class ReportFilterParams:
    """Encapsulates report filter parameters."""
    preset: str = 'all'
    incident_type: str = 'all'
    start_date_str: Optional[str] = None
    end_date_str: Optional[str] = None
    region_filter: Optional[str] = None
    province_filter: Optional[str] = None
    classification_filter: Optional[str] = None

    @classmethod
    def from_request(cls, request) -> 'ReportFilterParams':
        query = request.query_params
        return cls(
            preset=query.get('preset', 'all').lower(),
            incident_type=query.get('incident_type', 'all').lower(),
            start_date_str=query.get('start_date'),
            end_date_str=query.get('end_date'),
            region_filter=query.get('region'),
            province_filter=query.get('province'),
            classification_filter=query.get('classification')
        )


class IncidentReportService:
    """
    Domain service for aggregating incident metrics, geographical breakdown,
    and root causes across device and link incidents.
    """

    def __init__(self, filters: ReportFilterParams):
        self.filters = filters
        self.start_time, self.end_time = self._resolve_time_boundaries()

    @staticmethod
    def create_empty_causes_dict() -> Dict[str, int]:
        """Provides a standardized root cause counter dictionary."""
        return {
            'power_outage_reboot': 0,
            'device_reboot_related': 0,
            'device_reboot_suspected': 0,
            'manual_reload': 0,
            'software_crash': 0,
            'connectivity_loss': 0,
            'unable_to_verify': 0,
            'link_flapping': 0,
            'physical_link_failure': 0,
            'transient_glitch': 0,
            'parent_device_down': 0,
            'admin_shutdown': 0,
            'connectivity_recovered': 0,
            'stabilizing_link': 0,
            'ongoing_down': 0,
        }

    def _resolve_time_boundaries(self):
        """Calculates aware datetime boundaries from preset or custom strings."""
        now = timezone.now()
        preset = self.filters.preset
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
        elif preset == 'custom' or self.filters.start_date_str or self.filters.end_date_str:
            if self.filters.start_date_str:
                try:
                    s_clean = self.filters.start_date_str.replace('Z', '+00:00')
                    if len(s_clean) == 10:
                        s_clean += "T00:00:00"
                    st = datetime.fromisoformat(s_clean)
                    start_time = timezone.make_aware(st) if timezone.is_naive(st) else st
                except Exception:
                    pass
            if self.filters.end_date_str:
                try:
                    e_clean = self.filters.end_date_str.replace('Z', '+00:00')
                    if len(e_clean) == 10:
                        e_clean += "T23:59:59"
                    et = datetime.fromisoformat(e_clean)
                    end_time = timezone.make_aware(et) if timezone.is_naive(et) else et
                except Exception:
                    pass

        return start_time, end_time

    def _build_queryset(self):
        """Constructs filtered Incident queryset."""
        qs = Incident.objects.select_related('primary_device').all()

        if self.filters.incident_type == 'device':
            qs = qs.filter(incident_type=IncidentType.DEVICE)
        elif self.filters.incident_type == 'link':
            qs = qs.filter(incident_type=IncidentType.LINK)

        if self.start_time:
            qs = qs.filter(down_time__gte=self.start_time)
        if self.end_time:
            qs = qs.filter(down_time__lte=self.end_time)
        if self.filters.classification_filter:
            qs = qs.filter(classification__iexact=self.filters.classification_filter)

        return qs.order_by('-down_time')

    @classmethod
    def determine_cause_key(cls, inc: Incident) -> str:
        """Classifies incident into a standardized reporting cause key."""
        raw_cls = inc.classification or ''
        if inc.incident_type == IncidentType.LINK:
            if inc.status == IncidentStatus.STABILIZING:
                return 'stabilizing_link'
            if raw_cls == Classification.LINK_FLAPPING or (inc.flap_count and inc.flap_count >= 2):
                return 'link_flapping'
            if raw_cls == Classification.PHYSICAL_LINK_FAILURE:
                return 'physical_link_failure'
            if raw_cls == Classification.TRANSIENT_GLITCH:
                return 'transient_glitch'
            if raw_cls == Classification.PARENT_DEVICE_DOWN:
                return 'parent_device_down'
            if raw_cls == Classification.ADMIN_SHUTDOWN:
                return 'admin_shutdown'
            if raw_cls == Classification.CONNECTIVITY_RECOVERED or inc.status == IncidentStatus.RECOVERED:
                # Differentiate sustained physical outage (>= 15 min / 900s) vs momentary glitch (< 15 min)
                dt = inc.net_downtime_seconds or inc.downtime_seconds or 0
                if dt >= 900:
                    return 'physical_link_failure'
                return 'transient_glitch'
            return 'ongoing_down'
        else:
            if raw_cls == Classification.POWER_OUTAGE_REBOOT:
                return 'power_outage_reboot'
            if raw_cls == Classification.MANUAL_RELOAD:
                return 'manual_reload'
            if raw_cls == Classification.SOFTWARE_CRASH:
                return 'software_crash'
            if raw_cls == Classification.DEVICE_REBOOT_RELATED:
                return 'device_reboot_related'
            if raw_cls == Classification.DEVICE_REBOOT_SUSPECTED:
                return 'device_reboot_suspected'
            if raw_cls == Classification.CONNECTIVITY_LOSS:
                return 'connectivity_loss'
            if raw_cls == Classification.UNABLE_TO_VERIFY:
                return 'unable_to_verify'
            if inc.status == IncidentStatus.RECOVERED:
                return 'connectivity_loss'
            return 'ongoing_down'

    def generate_report(self) -> Dict[str, Any]:
        """
        Executes aggregation and builds the complete structured report.
        Maintains 100% backward compatibility with API consumers.
        """
        incidents_list = list(self._build_queryset())

        # Initialize regional accumulator
        regions = {
            r: {
                'region': r,
                'total_down': 0,
                'recovered_count': 0,
                'stabilizing_count': 0,
                'ongoing_count': 0,
                'total_flap_count': 0,
                'downtimes': [],
                'causes': self.create_empty_causes_dict(),
                'provinces': {}
            }
            for r in REGIONS_ORDER
        }

        all_downtimes: List[float] = []
        all_net_downtimes: List[float] = []
        recovered_total = 0
        stabilizing_total = 0
        ongoing_total = 0
        total_flaps_accumulated = 0
        flapping_incidents_count = 0

        device_down_counts: Dict[int, Dict[str, Any]] = {}
        link_unstable_counts: Dict[tuple, Dict[str, Any]] = {}
        serialized_incidents: List[Dict[str, Any]] = []

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
                    'causes': self.create_empty_causes_dict(),
                    'provinces': {}
                }

            # Filter conditions
            if self.filters.region_filter and reg_name != self.filters.region_filter:
                continue
            if self.filters.province_filter and prov_code != self.filters.province_filter.upper():
                continue

            cause_key = self.determine_cause_key(inc)

            # Downtime resolution
            if inc.incident_type == IncidentType.LINK and inc.net_downtime_seconds and inc.net_downtime_seconds > 0:
                dt = inc.net_downtime_seconds
            else:
                dt = inc.downtime_seconds

            net_dt = inc.net_downtime_seconds if inc.net_downtime_seconds is not None else (dt or 0.0)

            flaps = inc.flap_count or 0
            total_flaps_accumulated += flaps
            if flaps >= 2 or (inc.classification == Classification.LINK_FLAPPING):
                flapping_incidents_count += 1

            is_rec = (inc.status == IncidentStatus.RECOVERED and dt is not None)
            is_stabilizing = (inc.status == IncidentStatus.STABILIZING)
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
                    'causes': self.create_empty_causes_dict(),
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
                    'causes': self.create_empty_causes_dict(),
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

            # Sub-interfaces tracking
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

            # Global device tracking
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
                        'link_description': inc.link_description or '',
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
                if inc.link_description and not link_unstable_counts[link_key].get('link_description'):
                    link_unstable_counts[link_key]['link_description'] = inc.link_description

            serialized_incidents.append({
                'id': inc.id,
                'incident_number': inc.incident_number,
                'incident_type': inc.incident_type,
                'interface_name': inc.interface_name or '',
                'link_description': inc.link_description or '',
                'ticket_id_tss': inc.ticket_id_tss or '',
                'circuit_id': inc.circuit_id or '',
                'site_name': inc.site_name or '',
                'tts_status': inc.tts_status or '',
                'repair_team': inc.repair_team or '',
                'actual_cause': inc.actual_cause or '',
                'resolution': inc.resolution or '',
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
            if self.filters.region_filter and r_name != self.filters.region_filter:
                continue
            if not self.filters.region_filter and r_data['total_down'] == 0:
                continue

            prov_list = []
            for p_code, p_data in r_data['provinces'].items():
                if self.filters.province_filter and p_code != self.filters.province_filter.upper():
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
        causes_summary = {k: sum(r['causes'][k] for r in regions_list) for k in self.create_empty_causes_dict().keys()}

        incident_type = self.filters.incident_type
        if incident_type == 'link':
            root_causes_breakdown = [
                {
                    'key': 'physical_link_failure',
                    'label': 'Physical Link Failure (สายขาด/อุปกรณ์ชำรุด > 15 นาที)',
                    'count': causes_summary['physical_link_failure'],
                    'color': '#ef4444'
                },
                {
                    'key': 'transient_glitch',
                    'label': 'Transient Glitch (สัญญาณสะดุดชั่วคราว < 15 นาที)',
                    'count': causes_summary['transient_glitch'],
                    'color': '#10b981'
                },
                {
                    'key': 'link_flapping',
                    'label': 'Link Flapping (พอร์ตกระพริบซ้ำๆ)',
                    'count': causes_summary['link_flapping'],
                    'color': '#8b5cf6'
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
                    'key': 'power_outage_reboot',
                    'label': 'Power Outage (ไฟฟ้าดับ/ขัดข้อง)',
                    'count': causes_summary['power_outage_reboot'],
                    'color': '#f59e0b'
                },
                {
                    'key': 'device_reboot_related',
                    'label': 'Device Reboot (เครื่องรีบูตทั่วไป)',
                    'count': causes_summary['device_reboot_related'],
                    'color': '#ef4444'
                },
                {
                    'key': 'device_reboot_suspected',
                    'label': 'Suspected Reboot (สงสัยว่ารีบูต)',
                    'count': causes_summary['device_reboot_suspected'],
                    'color': '#fbbf24'
                },
                {
                    'key': 'connectivity_loss',
                    'label': 'Connectivity Loss (สูญเสียการเชื่อมต่อ)',
                    'count': causes_summary['connectivity_loss'],
                    'color': '#3b82f6'
                },
                {
                    'key': 'unable_to_verify',
                    'label': 'Unable to Verify (ตรวจไม่สำเร็จ)',
                    'count': causes_summary['unable_to_verify'],
                    'color': '#8b5cf6'
                },
                {
                    'key': 'ongoing_down',
                    'label': 'Active Down (อยู่ระหว่างดับ)',
                    'count': causes_summary['ongoing_down'],
                    'color': '#f43f5e'
                }
            ]
        else:
            root_causes_breakdown = [
                {
                    'key': 'power_outage_reboot',
                    'label': 'Power Outage (ไฟฟ้าดับ/ขัดข้อง)',
                    'count': causes_summary['power_outage_reboot'],
                    'color': '#f59e0b'
                },
                {
                    'key': 'physical_link_failure',
                    'label': 'Physical Link Failure (สายขาด/พอร์ตเสีย)',
                    'count': causes_summary['physical_link_failure'],
                    'color': '#ef4444'
                },
                {
                    'key': 'transient_glitch',
                    'label': 'Transient Glitch (สัญญาณสะดุดชั่วคราว)',
                    'count': causes_summary['transient_glitch'],
                    'color': '#10b981'
                },
                {
                    'key': 'link_flapping',
                    'label': 'Link Flapping (พอร์ตกระพริบซ้ำๆ)',
                    'count': causes_summary['link_flapping'],
                    'color': '#8b5cf6'
                },
                {
                    'key': 'device_reboot_related',
                    'label': 'Device Reboot (เครื่องรีบูตทั่วไป)',
                    'count': causes_summary['device_reboot_related'],
                    'color': '#dc2626'
                },
                {
                    'key': 'device_reboot_suspected',
                    'label': 'Suspected Reboot (สงสัยว่ารีบูต)',
                    'count': causes_summary['device_reboot_suspected'],
                    'color': '#fbbf24'
                },
                {
                    'key': 'connectivity_loss',
                    'label': 'Connectivity Loss (สัญญาณขาดหาย)',
                    'count': causes_summary['connectivity_loss'],
                    'color': '#3b82f6'
                },
                {
                    'key': 'parent_device_down',
                    'label': 'Parent Device Down (เราเตอร์หลักดับ)',
                    'count': causes_summary['parent_device_down'],
                    'color': '#f97316'
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

        return {
            'status': 'success',
            'query': {
                'preset': self.filters.preset,
                'incident_type': incident_type,
                'start_time': self.start_time.isoformat() if self.start_time else None,
                'end_time': self.end_time.isoformat() if self.end_time else None,
                'region_filter': self.filters.region_filter,
                'province_filter': self.filters.province_filter,
                'classification_filter': self.filters.classification_filter,
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
        }
