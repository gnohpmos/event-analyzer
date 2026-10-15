export type IncidentStatus = 
  | 'DOWN' 
  | 'FLAPPING'
  | 'STABILIZING'
  | 'RECOVERY_CHECK' 
  | 'RECOVERED' 
  | 'VERIFICATION_FAILED' 
  | 'MANUAL_REVIEW_REQUIRED';

export type ClassificationType = 
  | 'POWER_OUTAGE_REBOOT'
  | 'DEVICE_REBOOT_RELATED' 
  | 'DEVICE_REBOOT_SUSPECTED' 
  | 'MANUAL_RELOAD'
  | 'SOFTWARE_CRASH'
  | 'CONNECTIVITY_LOSS' 
  | 'UNABLE_TO_VERIFY'
  | 'PARENT_DEVICE_DOWN'
  | 'PHYSICAL_LINK_FAILURE'
  | 'ADMIN_SHUTDOWN'
  | 'LINK_FLAPPING'
  | 'TRANSIENT_GLITCH'
  | 'CONNECTIVITY_RECOVERED';

export type ConfidenceType = 'HIGH' | 'MEDIUM' | 'LOW' | null;

export interface SourceMapping {
  id: number;
  source: number;
  source_name: string;
  source_device_id: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface Device {
  id: number;
  name: string;
  management_ip: string;
  device_type: string;
  enabled: boolean;
  metadata?: Record<string, any>;
  sys_name?: string;
  province_code?: string;
  province?: string;
  hardware_model?: string;
  serial_number?: string;
  os_family?: string;
  os_version?: string;
  rca_strategy?: string;
  last_snmp_synced_at?: string | null;
  active_incidents_count: number;
  total_incidents_count: number;
  source_mappings: SourceMapping[];
  created_at: string;
  updated_at: string;
}

export interface NetworkEvent {
  id: number;
  source: number;
  source_name: string;
  source_event_id: string | null;
  device: number;
  device_name: string;
  device_ip: string;
  event_type: string;
  event_status: string;
  severity: string;
  event_time: string;
  received_time: string;
  message: string;
  metadata: Record<string, any>;
  idempotency_key: string;
  created_at: string;
}

export interface VerificationEvidence {
  raw_sysuptime?: string;
  router_uptime_seconds?: number;
  reload_reason?: string;
  reload_method?: string;
  reload_category?: string;
  snmp_checked_at?: string;
  estimated_boot_time?: string;
  snmp_version?: string;
}

export interface Verification {
  id: number;
  incident: number;
  device: number;
  device_name: string;
  device_ip: string;
  verification_type: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  check_time: string;
  result: Record<string, any>;
  evidence: VerificationEvidence;
  error_message: string | null;
  attempt_number: number;
  created_at: string;
}

export interface TimelineEntry {
  id: number;
  incident: number | null;
  event_type: string;
  source: string;
  description: string;
  data: Record<string, any>;
  timestamp: string;
  created_at: string;
}

export interface IncidentEventLink {
  id: number;
  relationship_type: string;
  event: NetworkEvent;
  created_at: string;
}

export interface IncidentListItem {
  id: number;
  incident_number: string;
  incident_type: 'DEVICE' | 'LINK';
  primary_device: number;
  device_name: string;
  device_ip: string;
  device_type: string;
  interface_name?: string;
  link_description?: string;
  ticket_id_tss?: string | null;
  ticket_id_osticket?: string | null;
  osticket_status?: string | null;
  circuit_id?: string | null;
  remote_device?: string | null;
  site_name?: string | null;
  tts_status?: string | null;
  repair_team?: string | null;
  prtg_sensor_id?: string;
  status: IncidentStatus;
  classification: ClassificationType | null;
  confidence: ConfidenceType;
  flap_count?: number;
  soak_until?: string | null;
  net_downtime_seconds?: number;
  down_time: string;
  up_time: string | null;
  last_down_time?: string | null;
  last_up_time?: string | null;
  last_seen: string;
  downtime_seconds: number | null;
  is_active: boolean;
  verifications_count: number;
  events_count: number;
  created_at: string;
  updated_at: string;
}

export interface IncidentDetail extends IncidentListItem {
  primary_device_detail?: Device;
  remote_interface?: string | null;
  response_department?: string | null;
  actual_cause?: string | null;
  resolution?: string | null;
  source_gps?: string | null;
  dest_gps?: string | null;
  timeline: TimelineEntry[];
  verifications: Verification[];
  incident_events: IncidentEventLink[];
}

export interface DashboardSummary {
  status: string;
  timestamp: string;
  counts: {
    total_incidents: number;
    active_down: number;
    device_down?: number;
    link_down?: number;
    flapping?: number;
    stabilizing?: number;
    recovery_check: number;
    recovered: number;
    verification_failed: number;
    manual_review_required: number;
    total_active: number;
  };
  classifications: {
    power_outage_reboot?: number;
    device_reboot_related: number;
    device_reboot_suspected: number;
    manual_reload?: number;
    software_crash?: number;
    connectivity_loss: number;
    unable_to_verify: number;
    link_flapping?: number;
    parent_device_down?: number;
    physical_link_failure?: number;
  };
  devices: {
    total_devices: number;
    devices_down: number;
    healthy_devices: number;
  };
  metrics: {
    avg_downtime_seconds: number;
    recovery_rate_percent: number;
  };
  recent_incidents: IncidentListItem[];
  standalone_audits: TimelineEntry[];
}

export interface SystemSetting {
  id: number;
  key: string;
  value: string;
  display_value: string;
  category: 'SNMP' | 'SSH' | 'THRESHOLD' | 'INTEGRATION' | 'GENERAL';
  description: string;
  is_secret: boolean;
  updated_at: string;
}

export interface SNMPTestResult {
  host: string;
  community_used?: string;
  success: boolean;
  router_uptime_seconds?: number | null;
  raw_sysuptime?: string | null;
  why_reload?: string | null;
  error_message?: string | null;
  snmp_version?: string;
}

export interface SSHTestResult {
  success: boolean;
  host: string;
  parsed_reason?: string;
  timestamp?: string;
  category?: string;
  summary_line?: string;
  raw_output?: string;
  error_message?: string | null;
}

export interface ReportSummary {
  incident_type?: string;
  total_incidents: number;
  recovered_count: number;
  stabilizing_count?: number;
  ongoing_count: number;
  recovery_rate_percent: number;
  avg_downtime_seconds: number;
  total_downtime_seconds: number;
  avg_net_downtime_seconds?: number;
  total_net_downtime_seconds?: number;
  total_flap_cycles?: number;
  flapping_incident_count?: number;
  most_affected_region: string;
  most_affected_province: string;
  top_root_cause: string;
  top_unstable_interface?: string;
  affected_devices_count: number;
  affected_interfaces_count?: number;
}

export interface ReportCauses {
  power_outage_reboot?: number;
  device_reboot_related?: number;
  device_reboot_suspected?: number;
  manual_reload?: number;
  software_crash?: number;
  connectivity_loss?: number;
  unable_to_verify?: number;
  link_flapping?: number;
  physical_link_failure?: number;
  parent_device_down?: number;
  admin_shutdown?: number;
  connectivity_recovered?: number;
  stabilizing_link?: number;
  ongoing_down?: number;
}

export interface ReportInterfaceImpact {
  interface_name: string;
  down_count: number;
  flap_count: number;
  recovered_count: number;
  stabilizing_count: number;
  ongoing_count: number;
  total_downtime_seconds: number;
  avg_downtime_seconds: number;
  last_status: string;
  last_classification?: string | null;
}

export interface ReportDeviceImpact {
  device_id: number;
  id?: number;
  name: string;
  sys_name: string;
  ip: string;
  hardware_model: string;
  province?: string;
  province_code?: string;
  region?: string;
  down_count: number;
  recovered_count?: number;
  stabilizing_count?: number;
  ongoing_count?: number;
  total_flap_count?: number;
  avg_downtime_seconds?: number;
  causes?: ReportCauses;
  total_downtime_seconds: number;
  interfaces?: ReportInterfaceImpact[];
}

export interface ReportTopUnstableLink {
  device_id: number;
  device_name: string;
  sys_name: string;
  management_ip: string;
  province: string;
  region: string;
  interface_name: string;
  link_description?: string;
  down_count: number;
  total_flap_count: number;
  total_net_downtime_seconds: number;
  status: string;
  classification?: string | null;
}

export interface ProvinceReport {
  province_code: string;
  province_name: string;
  total_down: number;
  recovered_count: number;
  stabilizing_count?: number;
  ongoing_count: number;
  total_flap_count?: number;
  avg_downtime_seconds: number;
  causes: ReportCauses;
  devices: ReportDeviceImpact[];
}

export interface RegionReport {
  region: string;
  total_down: number;
  recovered_count: number;
  stabilizing_count?: number;
  ongoing_count: number;
  total_flap_count?: number;
  avg_downtime_seconds: number;
  causes: ReportCauses;
  provinces: ProvinceReport[];
}

export interface RootCauseBreakdownItem {
  key: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface SerializedReportIncident {
  id: number;
  incident_number: string;
  incident_type?: 'DEVICE' | 'LINK';
  interface_name?: string;
  link_description?: string;
  ticket_id_tss?: string | null;
  circuit_id?: string | null;
  site_name?: string | null;
  tts_status?: string | null;
  repair_team?: string | null;
  actual_cause?: string | null;
  resolution?: string | null;
  flap_count?: number;
  net_downtime_seconds?: number | null;
  soak_until?: string | null;
  device_id: number;
  device_name: string;
  sys_name: string;
  device_ip: string;
  hardware_model: string;
  serial_number: string;
  province: string;
  province_code: string;
  region: string;
  status: IncidentStatus;
  classification: ClassificationType | null;
  confidence: ConfidenceType;
  down_time: string | null;
  up_time: string | null;
  downtime_seconds: number | null;
}

export interface IncidentReportData {
  status: string;
  query: {
    preset: string;
    incident_type?: string;
    start_time: string | null;
    end_time: string | null;
    region_filter: string | null;
    province_filter: string | null;
    classification_filter: string | null;
  };
  summary: ReportSummary;
  by_region: RegionReport[];
  by_root_cause: RootCauseBreakdownItem[];
  top_devices: ReportDeviceImpact[];
  top_unstable_links?: ReportTopUnstableLink[];
  incidents: SerializedReportIncident[];
}

export interface Wan2Lo0Node {
  ip_nms: string;
  hostname: string;
  model: string;
  location: string;
  area: string;
}

export interface Wan2Lo0ActiveIncident {
  id: number;
  incident_number: string;
  incident_type: 'DEVICE' | 'LINK';
  status: IncidentStatus;
  node_name: string;
  device_ip: string;
  interface_name?: string;
  circuit_id?: string;
  osticket_id?: string;
  tts_id?: string;
  down_time?: string | null;
}

export interface Wan2Lo0Record {
  ip_address: string;
  ip_loopback: string;
  interface: string;
  subnet: string;
  description: string;
  time: string;
  is_auto_peer: boolean;
  direction: 'forward' | 'return' | 'both' | 'general';
  rtt_ms?: number | null;
  hostname: string;
  model: string;
  area: string;
  circuit: string;
  hop_label?: string;
  active_incidents: Wan2Lo0ActiveIncident[];
}

export interface Wan2Lo0Device {
  loopback: string;
  hostname: string;
  model: string;
  area: string;
  interfaces: Wan2Lo0Record[];
  active_incidents: Wan2Lo0ActiveIncident[];
}

export interface Wan2Lo0Link {
  type: 'p2p' | 'standalone';
  direction: 'forward' | 'return' | 'general';
  dev_a: string;
  hostname_a: string;
  ip_a: string;
  intf_a: string;
  dev_b?: string | null;
  hostname_b?: string | null;
  ip_b?: string | null;
  intf_b?: string | null;
  rtt_ms?: number | null;
  circuit: string;
  description: string;
  active_incidents: Wan2Lo0ActiveIncident[];
}

export interface Wan2Lo0TopologyInterface {
  ip_loopback: string;
  hostname: string;
  model: string;
  area: string;
  interface: string;
  ip_address: string;
  role: string;
  direction: string;
  link_index: number;
  circuit: string;
  description: string;
}

export interface Wan2Lo0JsEdge {
  index: number;
  source: string;
  target: string;
  direction: string;
  dev_a?: string | null;
  intf_a?: string | null;
  ip_a?: string | null;
  dev_b?: string | null;
  intf_b?: string | null;
  ip_b?: string | null;
}

export interface Wan2Lo0AnalysisResult {
  mode: 'general' | 'asymmetric';
  auto_peer: boolean;
  exec_time: number;
  stats: {
    input_ips_count: number;
    matched_interfaces_count: number;
    routers_count: number;
    links_count: number;
    not_found_count: number;
    active_incidents_count: number;
  };
  not_found_ips: string[];
  devices: Wan2Lo0Device[];
  dev_node_map: Record<string, string>;
  links: Wan2Lo0Link[];
  records_fwd: Wan2Lo0Record[];
  records_ret: Wan2Lo0Record[];
  records_gen: Wan2Lo0Record[];
  records_all: Wan2Lo0Record[];
  topology_interfaces: Wan2Lo0TopologyInterface[];
  active_incidents: Wan2Lo0ActiveIncident[];
  mermaid_code: string;
  js_edges: Wan2Lo0JsEdge[];
}

export interface SingleTraceExecution {
  success: boolean;
  method: 'router_ssh' | 'server_os';
  source_router: string;
  target_ip: string;
  command?: string;
  error?: string;
  elapsed_seconds: number;
  hops: Array<{
    hop: number;
    ip: string;
    rtt_ms?: number | null;
    raw: string;
  }>;
  formatted_text: string;
  raw_output: string;
}

export interface LiveTracerouteResponse {
  trace_type: 'router_ssh' | 'server_os';
  forward_trace: SingleTraceExecution;
  return_trace?: SingleTraceExecution | null;
  analysis: Wan2Lo0AnalysisResult;
}

export interface SegmentedOAMHop {
  hop: number;
  segment_index: number;
  ip: string;
  code: string;
  status: string;
  labels: (number | string)[];
  rtt_ms?: number | null;
  is_domain_border: boolean;
  raw: string;
}

export interface SegmentedOAMDomain {
  domain_index: number;
  domain_name: string;
  source_router: string;
  source_hostname: string;
  source_model: string;
  target_router: string;
  target_hostname: string;
  target_model: string;
  driver_os: string;
  nexthop?: string | null;
  bgp_label?: number | string | null;
  local_label?: number | string | null;
  is_final_segment: boolean;
  elapsed_seconds: number;
  bgp_command?: string;
  trace_command?: string;
  hops: Array<{
    hop: number;
    ip: string;
    code: string;
    status: string;
    labels: (number | string)[];
    rtt_ms?: number | null;
    raw: string;
  }>;
  raw_trace?: string;
  error?: string;
}

export interface SegmentedMPLSTraceResponse {
  success: boolean;
  method: 'segmented_mpls_oam';
  source_router: string;
  source_hostname: string;
  target_ip: string;
  target_hostname: string;
  total_domains: number;
  total_elapsed_seconds: number;
  segments: SegmentedOAMDomain[];
  return_segments?: SegmentedOAMDomain[];
  stitched_hops: SegmentedOAMHop[];
  return_stitched_hops?: SegmentedOAMHop[];
  formatted_text: string;
  return_formatted_text?: string;
  analysis: Wan2Lo0AnalysisResult;
  error?: string;
}

export interface InterfaceHealthItem {
  ip_loopback: string;
  hostname: string;
  model: string;
  area: string;
  interface: string;
  ip_address: string;
  role: string;
  direction: string;
  link_index: number;
  circuit: string;
  reachable: boolean;
  collection_method: 'SSH_CLI' | 'SNMP_V2C' | 'NONE';
  health_status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNREACHABLE';
  is_active_loss: boolean;
  issues: string[];
  admin_status: string;
  oper_status: string;
  mtu_bytes?: number | null;
  bw_kbps?: number | null;
  rx_mbps: number;
  tx_mbps: number;
  rx_pps: number;
  tx_pps: number;
  rx_load_pct: number;
  tx_load_pct: number;
  in_errors: number;
  out_errors: number;
  crc_errors: number;
  frame_errors: number;
  runts: number;
  giants: number;
  in_drops: number;
  out_drops: number;
  delta_crc: number;
  delta_in_errors: number;
  delta_out_errors: number;
  delta_in_drops: number;
  delta_out_drops: number;
  carrier_transitions: number;
  last_flapped: string;
  tx_power_dbm?: number | null;
  rx_power_dbm?: number | null;
  is_bundle?: boolean;
  bundle_summary?: BundleSummary | null;
  members?: BundleMemberDiagnostic[];
}

export interface BundleMemberDiagnostic {
  member_interface: string;
  lag_state: string;
  admin_status: string;
  oper_status: string;
  health_status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNREACHABLE';
  bw_kbps?: number | null;
  rx_mbps: number;
  tx_mbps: number;
  rx_load_pct: number;
  tx_load_pct: number;
  in_errors: number;
  out_errors: number;
  crc_errors: number;
  in_drops: number;
  out_drops: number;
  delta_crc: number;
  delta_in_errors: number;
  delta_out_errors: number;
  delta_in_drops: number;
  delta_out_drops: number;
  rx_power_dbm?: number | null;
  tx_power_dbm?: number | null;
  issues: string[];
}

export interface BundleSummary {
  bundle_type: 'bundle_ether' | 'port_channel';
  parent_interface: string;
  sub_interface?: string | null;
  total_members: number;
  active_members: number;
  down_members: number;
  standby_members: number;
  capacity_loss_pct: number;
  min_active_links: number;
  min_links_met: boolean;
  total_bw_kbps?: number | null;
  effective_bw_kbps?: number | null;
}

export interface InterfaceInspectionResponse {
  elapsed_seconds: number;
  measure_delta: boolean;
  delta_interval_sec: number;
  summary: {
    total_checked: number;
    healthy_count: number;
    warning_count: number;
    critical_count: number;
    unreachable_count: number;
    total_bundles?: number;
    degraded_bundles?: number;
    mtu_consistent: boolean;
    min_mtu?: number | null;
    max_mtu?: number | null;
  };
  results: InterfaceHealthItem[];
  by_key: Record<string, InterfaceHealthItem>;
}
