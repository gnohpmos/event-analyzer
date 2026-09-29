import { IncidentReportData } from '../../../types';

/**
 * Format seconds to human readable duration (Thai).
 */
export const formatDuration = (seconds: number | null | undefined): string => {
  if (!seconds && seconds !== 0) return '-';
  if (seconds < 60) return `${Math.round(seconds)} วินาที`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins} นาที ${secs > 0 ? `${secs} วิ` : ''}`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours} ชม. ${remMins > 0 ? `${remMins} นาที` : ''}`;
};

/**
 * Format ISO datetime string to localized Thai format.
 */
export const formatDateTime = (isoString: string | null): string => {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
};

/**
 * Export incident report data to CSV with UTF-8 BOM for Thai Excel compatibility.
 */
export const exportReportToCSV = (
  reportData: IncidentReportData,
  incidentType: string,
  preset: string
): void => {
  if (!reportData || !reportData.incidents.length) {
    alert('ไม่มีข้อมูลสำหรับส่งออก CSV');
    return;
  }

  const headers = [
    'Incident ID',
    'Incident Type',
    'TSS Trouble Ticket',
    'TTS Status',
    'Repair Team',
    'Site Name',
    'Circuit ID',
    'Interface Name',
    'Link Description',
    'Device Name',
    'Hostname',
    'Management IP',
    'Hardware Model',
    'Region',
    'Province',
    'Province Code',
    'Status',
    'Classification',
    'Confidence',
    'Actual Root Cause (TTS)',
    'Resolution (TTS)',
    'Flap Count',
    'Down Time',
    'Up Time',
    'Downtime Seconds',
    'Net Downtime Seconds',
    'Downtime Formatted'
  ];

  const rows = reportData.incidents.map((inc) => [
    `"${inc.incident_number}"`,
    `"${inc.incident_type || 'DEVICE'}"`,
    `"${inc.ticket_id_tss || '-'}"`,
    `"${inc.tts_status || '-'}"`,
    `"${inc.repair_team || '-'}"`,
    `"${inc.site_name || '-'}"`,
    `"${inc.circuit_id || '-'}"`,
    `"${inc.interface_name || '-'}"`,
    `"${inc.link_description || '-'}"`,
    `"${inc.device_name}"`,
    `"${inc.sys_name || inc.device_name}"`,
    `"${inc.device_ip}"`,
    `"${inc.hardware_model || '-'}"`,
    `"${inc.region}"`,
    `"${inc.province}"`,
    `"${inc.province_code}"`,
    `"${inc.status}"`,
    `"${inc.classification || '-'}"`,
    `"${inc.confidence || '-'}"`,
    `"${inc.actual_cause || '-'}"`,
    `"${inc.resolution || '-'}"`,
    inc.flap_count ?? 0,
    `"${inc.down_time ? new Date(inc.down_time).toLocaleString('th-TH') : '-'}"`,
    `"${inc.up_time ? new Date(inc.up_time).toLocaleString('th-TH') : '-'}"`,
    inc.downtime_seconds ?? 0,
    inc.net_downtime_seconds ?? 0,
    `"${formatDuration(inc.net_downtime_seconds ?? inc.downtime_seconds)}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  link.setAttribute('href', url);
  link.setAttribute('download', `incident_report_${incidentType}_${preset}_${timestamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
