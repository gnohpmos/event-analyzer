import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart3, 
  Calendar, 
  Clock, 
  Download, 
  Printer, 
  RefreshCw, 
  MapPin, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronDown, 
  ChevronRight, 
  Layers, 
  Zap, 
  WifiOff, 
  HelpCircle, 
  ShieldAlert, 
  Server, 
  ArrowUpDown,
  Filter,
  Search,
  ExternalLink,
  Info,
  Network,
  Repeat,
  Activity
} from 'lucide-react';
import { api } from '../services/api';
import { 
  IncidentReportData, 
  RegionReport, 
  ProvinceReport, 
  ReportDeviceImpact, 
  ReportInterfaceImpact,
  ReportTopUnstableLink,
  SerializedReportIncident 
} from '../types';
import { StatusBadge, ClassificationBadge } from './StatusBadge';

interface ReportViewProps {
  onSelectIncident?: (id: number) => void;
}

export const ReportView: React.FC<ReportViewProps> = ({ onSelectIncident }) => {
  const [reportData, setReportData] = useState<IncidentReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Mode state: 'link' | 'device' | 'all'
  const [incidentType, setIncidentType] = useState<'link' | 'device' | 'all'>('link');

  // Filter states
  const [preset, setPreset] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [selectedClassification, setSelectedClassification] = useState<string>('');

  // Tab state for Combined mode top ranking
  const [topRankTab, setTopRankTab] = useState<'links' | 'devices'>('links');

  // Expand states for drill-down
  const [expandedRegions, setExpandedRegions] = useState<Record<string, boolean>>({});
  const [expandedProvinces, setExpandedProvinces] = useState<Record<string, boolean>>({});
  const [expandedDevices, setExpandedDevices] = useState<Record<string, boolean>>({});

  // Table search for incidents tab
  const [searchIncident, setSearchIncident] = useState<string>('');

  // Load report data
  const loadReport = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getIncidentReport({
        preset,
        incident_type: incidentType,
        start_date: preset === 'custom' ? startDate : undefined,
        end_date: preset === 'custom' ? endDate : undefined,
        region: selectedRegion || undefined,
        classification: selectedClassification || undefined,
      });
      setReportData(data);

      // Auto expand regions that have incidents
      const initialExpanded: Record<string, boolean> = {};
      data.by_region.forEach((r) => {
        initialExpanded[r.region] = true;
      });
      setExpandedRegions(initialExpanded);
    } catch (err: any) {
      console.error('Failed to load report:', err);
      setError(err.message || 'ไม่สามารถโหลดข้อมูลรายงานได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [preset, incidentType, selectedRegion, selectedClassification]);

  // Handle custom date apply
  const handleApplyCustomDates = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      alert('กรุณาระบุทั้งวันเริ่มต้นและวันสิ้นสุด');
      return;
    }
    loadReport();
  };

  // Toggle region accordion
  const toggleRegion = (regionName: string) => {
    setExpandedRegions((prev) => ({
      ...prev,
      [regionName]: !prev[regionName],
    }));
  };

  // Toggle province accordion
  const toggleProvince = (provinceKey: string) => {
    setExpandedProvinces((prev) => ({
      ...prev,
      [provinceKey]: !prev[provinceKey],
    }));
  };

  // Toggle device accordion to show interfaces
  const toggleDevice = (devKey: string) => {
    setExpandedDevices((prev) => ({
      ...prev,
      [devKey]: !prev[devKey],
    }));
  };

  // Expand or collapse all regions and provinces
  const toggleAllRegions = (expand: boolean) => {
    if (!reportData) return;
    const newState: Record<string, boolean> = {};
    const newProvState: Record<string, boolean> = {};
    const newDevState: Record<string, boolean> = {};
    reportData.by_region.forEach((r) => {
      newState[r.region] = expand;
      r.provinces.forEach((p) => {
        const provKey = `${r.region}_${p.province_code}`;
        newProvState[provKey] = expand;
        p.devices.forEach((d) => {
          newDevState[`${provKey}_${d.device_id}`] = expand;
        });
      });
    });
    setExpandedRegions(newState);
    setExpandedProvinces(expand ? newProvState : {});
    setExpandedDevices(expand ? newDevState : {});
  };

  // Format seconds to human readable
  const formatDuration = (seconds: number | null | undefined): string => {
    if (!seconds && seconds !== 0) return '-';
    if (seconds < 60) return `${Math.round(seconds)} วินาที`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) return `${mins} นาที ${secs > 0 ? `${secs} วิ` : ''}`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours} ชม. ${remMins > 0 ? `${remMins} นาที` : ''}`;
  };

  // Format datetime
  const formatDateTime = (isoString: string | null): string => {
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

  // Export to CSV with UTF-8 BOM for Excel compatibility
  const exportToCSV = () => {
    if (!reportData || !reportData.incidents.length) {
      alert('ไม่มีข้อมูลสำหรับส่งออก CSV');
      return;
    }

    const headers = [
      'Incident ID',
      'Incident Type',
      'Interface Name',
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
      `"${inc.interface_name || '-'}"`,
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

  // Filtered regions based on selected region
  const displayRegions = useMemo(() => {
    if (!reportData?.by_region) return [];
    if (!selectedRegion) return reportData.by_region;
    return reportData.by_region.filter((r) => r.region === selectedRegion);
  }, [reportData, selectedRegion]);

  // Filtered incidents for table
  const filteredIncidents = useMemo(() => {
    if (!reportData) return [];
    let list = reportData.incidents;
    if (selectedRegion) {
      list = list.filter((inc) => inc.region === selectedRegion);
    }
    if (selectedClassification) {
      list = list.filter((inc) => inc.classification === selectedClassification);
    }
    if (!searchIncident.trim()) return list;
    const term = searchIncident.toLowerCase().trim();
    return list.filter((inc) => 
      inc.incident_number.toLowerCase().includes(term) ||
      inc.device_name.toLowerCase().includes(term) ||
      inc.sys_name.toLowerCase().includes(term) ||
      (inc.interface_name && inc.interface_name.toLowerCase().includes(term)) ||
      inc.device_ip.toLowerCase().includes(term) ||
      inc.province.toLowerCase().includes(term) ||
      inc.region.toLowerCase().includes(term)
    );
  }, [reportData, searchIncident, selectedRegion, selectedClassification]);

  return (
    <div className="space-y-6 pb-12">
      
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border border-border p-6 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                รายงานสถิติการขัดข้อง (Incident & Downtime Reports)
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                รายงานสรุปเหตุการณ์ขัดข้องของสายสัญญาณ (Link Incident) และเราเตอร์ แยกตามสาเหตุ (RCA) ตามภูมิภาค และเจาะลึกระดับพอร์ต
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={loadReport}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border transition-all disabled:opacity-50"
            title="รีเฟรชข้อมูลล่าสุด"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </button>

          <button
            onClick={exportToCSV}
            disabled={!reportData || reportData.incidents.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-sm disabled:opacity-50"
            title="ดาวน์โหลดข้อมูลเป็นไฟล์ Excel / CSV พร้อมรองรับภาษาไทย"
          >
            <Download className="w-3.5 h-3.5" />
            ส่งออก CSV
          </button>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-card text-foreground hover:bg-muted border border-border transition-all"
            title="พิมพ์หน้ารายงาน หรือบันทึกเป็น PDF"
          >
            <Printer className="w-3.5 h-3.5 text-muted-foreground" />
            พิมพ์ / บันทึก PDF
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2 overflow-x-auto">
        <button
          onClick={() => { setIncidentType('link'); setSelectedClassification(''); }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            incidentType === 'link'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60'
          }`}
        >
          <Network className="w-4 h-4" />
          <span>รายงานสายสัญญาณและพอร์ต (Link & Port Outages)</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
            incidentType === 'link' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>
            Link Engine
          </span>
        </button>

        <button
          onClick={() => { setIncidentType('device'); setSelectedClassification(''); }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            incidentType === 'device'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>รายงานเราเตอร์และอุปกรณ์หลัก (Device Outages)</span>
        </button>

        <button
          onClick={() => { setIncidentType('all'); setSelectedClassification(''); }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            incidentType === 'all'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>ภาพรวมการขัดข้องทั้งหมด (Combined Overview)</span>
        </button>
      </div>

      {/* Filter & Period Selection Bar */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Preset Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              ช่วงเวลา:
            </span>

            {[
              { id: 'today', label: 'วันนี้ (Today)' },
              { id: 'yesterday', label: 'เมื่อวาน (Yesterday)' },
              { id: '7d', label: '7 วันล่าสุด' },
              { id: '30d', label: '30 วันล่าสุด' },
              { id: 'all', label: 'ทั้งหมด (All Time)' },
              { id: 'custom', label: 'กำหนดเอง (Custom)' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  preset === p.id
                    ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
                    : 'bg-muted/70 text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Region and Cause Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">ภาค:</span>
              <select
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">ทุกภาค (All Regions)</option>
                <option value="ภาคกลางและกรุงเทพฯ">ภาคกลางและกรุงเทพฯ</option>
                <option value="ภาคเหนือ">ภาคเหนือ</option>
                <option value="ภาคตะวันออกเฉียงเหนือ">ภาคตะวันออกเฉียงเหนือ</option>
                <option value="ภาคตะวันออก">ภาคตะวันออก</option>
                <option value="ภาคใต้">ภาคใต้</option>
                <option value="ภาคตะวันตก">ภาคตะวันตก</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">สาเหตุ:</span>
              <select
                value={selectedClassification}
                onChange={(e) => setSelectedClassification(e.target.value)}
                className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">ทุกสาเหตุ (All Causes)</option>
                {incidentType === 'link' ? (
                  <>
                    <option value="LINK_FLAPPING">Link Flapping (พอร์ตกระพริบ)</option>
                    <option value="PHYSICAL_LINK_FAILURE">Physical Failure (สายขาด/พอร์ตดับ)</option>
                    <option value="PARENT_DEVICE_DOWN">Parent Device Down (เราเตอร์หลักดับ)</option>
                    <option value="ADMIN_SHUTDOWN">Admin Shutdown (ปิดพอร์ตโดยผู้ดูแล)</option>
                    <option value="CONNECTIVITY_RECOVERED">Recovered (กู้คืนปกติ)</option>
                  </>
                ) : incidentType === 'device' ? (
                  <>
                    <option value="DEVICE_REBOOT_RELATED">Device Reboot (ยืนยัน)</option>
                    <option value="DEVICE_REBOOT_SUSPECTED">Suspected Reboot (สงสัย)</option>
                    <option value="CONNECTIVITY_LOSS">Connectivity Loss (เครือข่าย)</option>
                    <option value="UNABLE_TO_VERIFY">Unable to Verify (ตรวจไม่สำเร็จ)</option>
                  </>
                ) : (
                  <>
                    <option value="LINK_FLAPPING">Link Flapping (พอร์ตกระพริบ)</option>
                    <option value="PHYSICAL_LINK_FAILURE">Physical Link Failure (สายขาด)</option>
                    <option value="DEVICE_REBOOT_RELATED">Device Reboot (ยืนยัน)</option>
                    <option value="DEVICE_REBOOT_SUSPECTED">Suspected Reboot (สงสัย)</option>
                    <option value="PARENT_DEVICE_DOWN">Parent Device Down (เราเตอร์หลักดับ)</option>
                    <option value="CONNECTIVITY_LOSS">Connectivity Loss (เครือข่าย)</option>
                    <option value="UNABLE_TO_VERIFY">Unable to Verify (ตรวจไม่สำเร็จ)</option>
                    <option value="ADMIN_SHUTDOWN">Admin Shutdown (ปิดพอร์ต)</option>
                  </>
                )}
              </select>
            </div>
          </div>
        </div>

        {/* Custom Date Range Selector */}
        {preset === 'custom' && (
          <form onSubmit={handleApplyCustomDates} className="pt-2 border-t border-border flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">ตั้งแต่วันที่:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="bg-background border border-border rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">ถึงวันที่:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="bg-background border border-border rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <button
              type="submit"
              className="px-3 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all shadow-sm"
            >
              นำไปใช้ (Apply)
            </button>
          </form>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary KPI Cards */}
      {reportData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {incidentType === 'link' ? (
            <>
              {/* Card 1: Total Link Incidents */}
              <div className="p-5 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    พอร์ต/สายสัญญาณดับ (Link Downs)
                  </span>
                  <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
                    <Network className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-3xl font-bold font-mono text-foreground tracking-tight">
                  {reportData.summary.total_incidents} <span className="text-sm font-normal text-muted-foreground">เหตุการณ์</span>
                </div>
                <div className="mt-2 text-xs flex items-center justify-between text-muted-foreground pt-1 border-t border-border/50">
                  <span className="text-emerald-500 font-medium">กู้คืน: {reportData.summary.recovered_count}</span>
                  {reportData.summary.stabilizing_count ? (
                    <span className="text-cyan-400 font-medium">รอดูอาการ: {reportData.summary.stabilizing_count}</span>
                  ) : null}
                  <span className="text-rose-500 font-medium">ดับอยู่: {reportData.summary.ongoing_count}</span>
                </div>
              </div>

              {/* Card 2: Flapping Metrics */}
              <div className="p-5 rounded-2xl bg-card border border-border hover:border-purple-500/40 transition-all shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
                    สถิติการกระพริบ (Flapping Cycles)
                  </span>
                  <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <Repeat className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-3xl font-bold font-mono text-foreground tracking-tight">
                  {reportData.summary.total_flap_cycles ?? 0} <span className="text-sm font-normal text-muted-foreground">รอบสะสม</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2 truncate flex items-center justify-between pt-1 border-t border-border/50">
                  <span>พอร์ตกระพริบ:</span>
                  <span className="text-purple-400 font-semibold">{reportData.summary.flapping_incident_count ?? 0} เหตุการณ์</span>
                </p>
              </div>

              {/* Card 3: Net Downtime (MTTR) */}
              <div className="p-5 rounded-2xl bg-card border border-border hover:border-sky-500/40 transition-all shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-sky-500">
                    เวลาสายดับจริงเฉลี่ย (Net MTTR)
                  </span>
                  <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 border border-sky-500/20">
                    <Clock className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-foreground tracking-tight">
                  {formatDuration(reportData.summary.avg_net_downtime_seconds || reportData.summary.avg_downtime_seconds)}
                </div>
                <p className="text-xs text-muted-foreground mt-2 flex items-center justify-between pt-1 border-t border-border/50">
                  <span>ดับจริงสะสม:</span>
                  <span className="text-foreground font-mono">{formatDuration(reportData.summary.total_net_downtime_seconds || reportData.summary.total_downtime_seconds)}</span>
                </p>
              </div>

              {/* Card 4: Top Unstable Link */}
              <div className="p-5 rounded-2xl bg-card border border-border hover:border-amber-500/40 transition-all shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-500">
                    พอร์ตที่ไม่เสถียรที่สุด
                  </span>
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                    <Activity className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-sm font-bold text-foreground tracking-tight truncate" title={reportData.summary.top_unstable_interface}>
                  {reportData.summary.top_unstable_interface || '-'}
                </div>
                <p className="text-xs text-muted-foreground mt-2 flex items-center justify-between pt-1 border-t border-border/50">
                  <span>สาเหตุหลัก:</span>
                  <span className="text-foreground font-medium truncate max-w-[130px]">{reportData.summary.top_root_cause}</span>
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Device / Combined Cards */}
              <div className="p-5 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    การ Down ทั้งหมด (Total Downs)
                  </span>
                  <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-3xl font-bold font-mono text-foreground tracking-tight">
                  {reportData.summary.total_incidents} <span className="text-sm font-normal text-muted-foreground">ครั้ง</span>
                </div>
                <div className="mt-2 text-xs flex items-center justify-between text-muted-foreground pt-1 border-t border-border/50">
                  <span className="text-emerald-500 font-medium">กู้คืนแล้ว: {reportData.summary.recovered_count}</span>
                  <span className="text-rose-500 font-medium">ยังไม่หาย: {reportData.summary.ongoing_count}</span>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-card border border-border hover:border-amber-500/40 transition-all shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-500">
                    ภาคที่กระทบสูงสุด
                  </span>
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                    <MapPin className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl font-bold text-foreground tracking-tight truncate" title={reportData.summary.most_affected_region}>
                  {reportData.summary.most_affected_region}
                </div>
                <p className="text-xs text-muted-foreground mt-2 truncate flex items-center gap-1 pt-1 border-t border-border/50">
                  <span>จังหวัดสูงสุด:</span>
                  <span className="text-foreground font-medium">{reportData.summary.most_affected_province}</span>
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-card border border-border hover:border-indigo-500/40 transition-all shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-500">
                    สาเหตุหลักที่พบ
                  </span>
                  <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                    <Zap className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-sm font-bold text-foreground tracking-tight line-clamp-2 min-h-[2.5rem] flex items-center" title={reportData.summary.top_root_cause}>
                  {reportData.summary.top_root_cause}
                </div>
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5 pt-1 border-t border-border/50">
                  <span>อัตราการกู้คืน:</span>
                  <span className="text-emerald-500 font-semibold">{reportData.summary.recovery_rate_percent}%</span>
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-card border border-border hover:border-sky-500/40 transition-all shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-sky-500">
                    เวลาเฉลี่ยการ Down (MTTR)
                  </span>
                  <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 border border-sky-500/20">
                    <Clock className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-foreground tracking-tight">
                  {formatDuration(reportData.summary.avg_downtime_seconds)}
                </div>
                <p className="text-xs text-muted-foreground mt-2 flex items-center justify-between pt-1 border-t border-border/50">
                  <span>Down รวม:</span>
                  <span className="text-foreground font-mono">{formatDuration(reportData.summary.total_downtime_seconds)}</span>
                </p>
              </div>
            </>
          )}

        </div>
      )}

      {/* Main Section: Regional & Provincial Drill-down */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        
        {/* Table Header / Action */}
        <div className="p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {incidentType === 'link' 
                  ? 'จำนวนสายสัญญาณ/พอร์ตดับ แยกตามภาค จังหวัด เราเตอร์ และพอร์ต (Interface Drill-down)'
                  : incidentType === 'device'
                  ? 'จำนวนการ Down แยกตามสาเหตุตามภาคและเจาะลึกระดับจังหวัด (Device Drill-down)'
                  : 'ภาพรวมการขัดข้องโครงข่ายเจาะลึกระดับภูมิภาค จังหวัด และอุปกรณ์ (Hierarchical Drill-down)'
                }
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                คลิกแถวเพื่อขยายดูรายละเอียดระดับจังหวัด เราเตอร์ และพอร์ตย่อย
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => toggleAllRegions(true)}
              className="text-primary hover:underline font-medium"
            >
              ขยายทั้งหมด (Expand All)
            </button>
            <span className="text-muted-foreground">&bull;</span>
            <button
              onClick={() => toggleAllRegions(false)}
              className="text-muted-foreground hover:text-foreground font-medium"
            >
              ยุบทั้งหมด (Collapse All)
            </button>
          </div>
        </div>

        {/* Breakdown Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-muted/50 border-b border-border text-muted-foreground uppercase tracking-wider font-semibold text-[11px]">
                <th className="py-3 px-4 w-80">
                  {incidentType === 'link' 
                    ? 'ภูมิภาค / จังหวัด / เราเตอร์ / พอร์ต'
                    : 'ภูมิภาค / จังหวัด / อุปกรณ์'
                  }
                </th>
                <th className="py-3 px-3 text-center">Down รวม</th>
                {incidentType === 'link' && (
                  <th className="py-3 px-3 text-center">Flap สะสม</th>
                )}
                <th className="py-3 px-3 text-center">สถานะ</th>

                {incidentType === 'link' ? (
                  <>
                    <th className="py-3 px-3 text-center">
                      <span className="inline-flex items-center gap-1 text-purple-400">
                        <Repeat className="w-3 h-3" /> Flapping
                      </span>
                    </th>
                    <th className="py-3 px-3 text-center">
                      <span className="inline-flex items-center gap-1 text-rose-500">
                        <Zap className="w-3 h-3" /> สายขาด/ดับ
                      </span>
                    </th>
                    <th className="py-3 px-3 text-center">
                      <span className="inline-flex items-center gap-1 text-amber-500">
                        <Server className="w-3 h-3" /> เราเตอร์ดับ
                      </span>
                    </th>
                    <th className="py-3 px-3 text-center">
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <ShieldAlert className="w-3 h-3" /> Admin Down
                      </span>
                    </th>
                  </>
                ) : (
                  <>
                    <th className="py-3 px-3 text-center">
                      <span className="inline-flex items-center gap-1 text-rose-500">
                        <Zap className="w-3 h-3" /> Reboot ยืนยัน
                      </span>
                    </th>
                    <th className="py-3 px-3 text-center">
                      <span className="inline-flex items-center gap-1 text-amber-500">
                        <Zap className="w-3 h-3" /> สงสัย Reboot
                      </span>
                    </th>
                    <th className="py-3 px-3 text-center">
                      <span className="inline-flex items-center gap-1 text-sky-500">
                        <WifiOff className="w-3 h-3" /> เครือข่ายขัดข้อง
                      </span>
                    </th>
                    <th className="py-3 px-3 text-center">
                      <span className="inline-flex items-center gap-1 text-purple-400">
                        <HelpCircle className="w-3 h-3" /> ตรวจไม่สำเร็จ
                      </span>
                    </th>
                  </>
                )}

                <th className="py-3 px-3 text-center">
                  <span className="inline-flex items-center gap-1 text-rose-400">
                    <AlertTriangle className="w-3 h-3" /> อยู่ระหว่าง Down
                  </span>
                </th>
                <th className="py-3 px-4 text-right">เฉลี่ยเวลา Down</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayRegions.length > 0 ? (
                displayRegions.map((reg: RegionReport) => {
                  const isRegExpanded = !!expandedRegions[reg.region];
                  return (
                    <React.Fragment key={reg.region}>
                      {/* Region Parent Row */}
                      <tr 
                        onClick={() => toggleRegion(reg.region)}
                        className={`hover:bg-muted/40 cursor-pointer font-medium transition-colors ${
                          isRegExpanded ? 'bg-muted/20' : ''
                        }`}
                      >
                        <td className="py-3 px-4 flex items-center gap-2">
                          <span className="text-muted-foreground p-0.5 rounded hover:bg-muted">
                            {isRegExpanded ? (
                              <ChevronDown className="w-4 h-4 text-primary" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </span>
                          <span className="text-foreground font-bold text-sm">
                            {reg.region}
                          </span>
                          <span className="text-[11px] text-muted-foreground ml-1">
                            ({reg.provinces.length} จังหวัด)
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
                            {reg.total_down}
                          </span>
                        </td>
                        {incidentType === 'link' && (
                          <td className="py-3 px-3 text-center">
                            {(reg.total_flap_count ?? 0) > 0 ? (
                              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                {reg.total_flap_count} รอบ
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">-</span>
                            )}
                          </td>
                        )}
                        <td className="py-3 px-3 text-center text-xs">
                          <span className="text-emerald-500 font-medium">{reg.recovered_count} กู้คืน</span>
                          {reg.stabilizing_count ? (
                            <span className="text-cyan-400 font-bold ml-1.5">/ {reg.stabilizing_count} รอดู</span>
                          ) : null}
                          {reg.ongoing_count > 0 && (
                            <span className="text-rose-500 font-bold ml-1.5">/ {reg.ongoing_count} Down</span>
                          )}
                        </td>

                        {incidentType === 'link' ? (
                          <>
                            <td className="py-3 px-3 text-center font-mono">
                              {(reg.causes.link_flapping ?? 0) > 0 ? (
                                <span className="text-purple-400 font-bold px-1.5 py-0.5 rounded bg-purple-500/10">
                                  {reg.causes.link_flapping}
                                </span>
                              ) : <span className="text-muted-foreground/40">-</span>}
                            </td>
                            <td className="py-3 px-3 text-center font-mono">
                              {(reg.causes.physical_link_failure ?? 0) > 0 ? (
                                <span className="text-rose-500 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                                  {reg.causes.physical_link_failure}
                                </span>
                              ) : <span className="text-muted-foreground/40">-</span>}
                            </td>
                            <td className="py-3 px-3 text-center font-mono">
                              {(reg.causes.parent_device_down ?? 0) > 0 ? (
                                <span className="text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10">
                                  {reg.causes.parent_device_down}
                                </span>
                              ) : <span className="text-muted-foreground/40">-</span>}
                            </td>
                            <td className="py-3 px-3 text-center font-mono">
                              {(reg.causes.admin_shutdown ?? 0) > 0 ? (
                                <span className="text-slate-400 font-bold px-1.5 py-0.5 rounded bg-slate-500/10">
                                  {reg.causes.admin_shutdown}
                                </span>
                              ) : <span className="text-muted-foreground/40">-</span>}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-3 px-3 text-center font-mono">
                              {(reg.causes.device_reboot_related ?? 0) > 0 ? (
                                <span className="text-rose-500 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                                  {reg.causes.device_reboot_related}
                                </span>
                              ) : <span className="text-muted-foreground/40">-</span>}
                            </td>
                            <td className="py-3 px-3 text-center font-mono">
                              {(reg.causes.device_reboot_suspected ?? 0) > 0 ? (
                                <span className="text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10">
                                  {reg.causes.device_reboot_suspected}
                                </span>
                              ) : <span className="text-muted-foreground/40">-</span>}
                            </td>
                            <td className="py-3 px-3 text-center font-mono">
                              {(reg.causes.connectivity_loss ?? 0) > 0 ? (
                                <span className="text-sky-500 font-bold px-1.5 py-0.5 rounded bg-sky-500/10">
                                  {reg.causes.connectivity_loss}
                                </span>
                              ) : <span className="text-muted-foreground/40">-</span>}
                            </td>
                            <td className="py-3 px-3 text-center font-mono">
                              {(reg.causes.unable_to_verify ?? 0) > 0 ? (
                                <span className="text-purple-400 font-bold px-1.5 py-0.5 rounded bg-purple-500/10">
                                  {reg.causes.unable_to_verify}
                                </span>
                              ) : <span className="text-muted-foreground/40">-</span>}
                            </td>
                          </>
                        )}

                        <td className="py-3 px-3 text-center font-mono">
                          {(reg.causes.ongoing_down ?? 0) > 0 ? (
                            <span className="text-rose-400 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                              {reg.causes.ongoing_down}
                            </span>
                          ) : <span className="text-muted-foreground/40">-</span>}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-foreground">
                          {formatDuration(reg.avg_downtime_seconds)}
                        </td>
                      </tr>

                      {/* Province Child Rows */}
                      {isRegExpanded && reg.provinces.map((prov: ProvinceReport) => {
                        const provKey = `${reg.region}_${prov.province_code}`;
                        const isProvExpanded = !!expandedProvinces[provKey];
                        return (
                          <React.Fragment key={provKey}>
                            <tr 
                              onClick={() => toggleProvince(provKey)}
                              className={`bg-muted/10 hover:bg-muted/30 cursor-pointer transition-colors border-b border-border/50 ${
                                isProvExpanded ? 'bg-muted/20' : ''
                              }`}
                            >
                              <td className="py-2.5 px-4 pl-8 flex items-center gap-2">
                                <span className="text-muted-foreground p-0.5 rounded hover:bg-muted">
                                  {isProvExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-primary" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  )}
                                </span>
                                <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="text-foreground font-semibold text-xs">
                                  {prov.province_name}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  ({prov.province_code})
                                </span>
                                <span className="text-[10px] text-muted-foreground ml-1">
                                  &bull; {prov.devices.length} อุปกรณ์
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-center font-bold text-foreground">
                                {prov.total_down}
                              </td>
                              {incidentType === 'link' && (
                                <td className="py-2.5 px-3 text-center font-mono">
                                  {(prov.total_flap_count ?? 0) > 0 ? (
                                    <span className="text-purple-400 font-bold">{prov.total_flap_count}</span>
                                  ) : <span className="text-muted-foreground/50">-</span>}
                                </td>
                              )}
                              <td className="py-2.5 px-3 text-center text-[11px]">
                                <span className="text-emerald-500 font-medium">{prov.recovered_count} คืน</span>
                                {prov.stabilizing_count ? (
                                  <span className="text-cyan-400 font-bold ml-1">/ {prov.stabilizing_count} รอดู</span>
                                ) : null}
                                {prov.ongoing_count > 0 && (
                                  <span className="text-rose-500 font-bold ml-1">/ {prov.ongoing_count} Down</span>
                                )}
                              </td>

                              {incidentType === 'link' ? (
                                <>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.link_flapping ?? 0) > 0 ? (
                                      <span className="text-purple-400 font-bold">{prov.causes.link_flapping}</span>
                                    ) : <span className="text-muted-foreground/40">-</span>}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.physical_link_failure ?? 0) > 0 ? (
                                      <span className="text-rose-500 font-bold">{prov.causes.physical_link_failure}</span>
                                    ) : <span className="text-muted-foreground/40">-</span>}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.parent_device_down ?? 0) > 0 ? (
                                      <span className="text-amber-500 font-bold">{prov.causes.parent_device_down}</span>
                                    ) : <span className="text-muted-foreground/40">-</span>}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.admin_shutdown ?? 0) > 0 ? (
                                      <span className="text-slate-400 font-bold">{prov.causes.admin_shutdown}</span>
                                    ) : <span className="text-muted-foreground/40">-</span>}
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.device_reboot_related ?? 0) > 0 ? (
                                      <span className="text-rose-500 font-bold">{prov.causes.device_reboot_related}</span>
                                    ) : <span className="text-muted-foreground/40">-</span>}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.device_reboot_suspected ?? 0) > 0 ? (
                                      <span className="text-amber-500 font-bold">{prov.causes.device_reboot_suspected}</span>
                                    ) : <span className="text-muted-foreground/40">-</span>}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.connectivity_loss ?? 0) > 0 ? (
                                      <span className="text-sky-500 font-bold">{prov.causes.connectivity_loss}</span>
                                    ) : <span className="text-muted-foreground/40">-</span>}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.unable_to_verify ?? 0) > 0 ? (
                                      <span className="text-purple-400 font-bold">{prov.causes.unable_to_verify}</span>
                                    ) : <span className="text-muted-foreground/40">-</span>}
                                  </td>
                                </>
                              )}

                              <td className="py-2.5 px-3 text-center font-mono">
                                {(prov.causes.ongoing_down ?? 0) > 0 ? (
                                  <span className="text-rose-400 font-bold">{prov.causes.ongoing_down}</span>
                                ) : <span className="text-muted-foreground/40">-</span>}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">
                                {formatDuration(prov.avg_downtime_seconds)}
                              </td>
                            </tr>

                            {/* Device & Interface Child Rows */}
                            {isProvExpanded && prov.devices.map((dev: ReportDeviceImpact) => {
                              const devKey = `${provKey}_${dev.device_id}`;
                              const isDevExpanded = !!expandedDevices[devKey];
                              const hasInterfaces = !!(dev.interfaces && dev.interfaces.length > 0);

                              return (
                                <React.Fragment key={devKey}>
                                  <tr 
                                    onClick={() => hasInterfaces && toggleDevice(devKey)}
                                    className={`bg-card/40 hover:bg-muted/30 transition-colors border-b border-border/30 text-xs ${
                                      hasInterfaces ? 'cursor-pointer' : ''
                                    }`}
                                  >
                                    <td className="py-2 px-4 pl-12">
                                      <div className="flex items-center gap-2">
                                        {hasInterfaces ? (
                                          <span className="text-muted-foreground p-0.5 rounded hover:bg-muted">
                                            {isDevExpanded ? (
                                              <ChevronDown className="w-3 h-3 text-primary" />
                                            ) : (
                                              <ChevronRight className="w-3 h-3" />
                                            )}
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground/60 text-xs select-none">↳</span>
                                        )}
                                        <Server className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />
                                        <div className="flex flex-col min-w-0">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-semibold text-foreground text-xs truncate max-w-[220px]" title={dev.sys_name || dev.name}>
                                              {dev.sys_name || dev.name}
                                            </span>
                                            {dev.hardware_model && (
                                              <span className="text-[9px] px-1 py-0.2 rounded bg-muted/80 text-muted-foreground font-mono">
                                                {dev.hardware_model}
                                              </span>
                                            )}
                                            {hasInterfaces && (
                                              <span className="text-[9px] px-1 py-0.2 rounded bg-primary/10 text-primary font-semibold">
                                                {dev.interfaces?.length} พอร์ต
                                              </span>
                                            )}
                                          </div>
                                          <span className="font-mono text-[10px] text-muted-foreground">
                                            {dev.ip}
                                          </span>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-2 px-3 text-center font-semibold text-foreground">
                                      {dev.down_count}
                                    </td>
                                    {incidentType === 'link' && (
                                      <td className="py-2 px-3 text-center font-mono">
                                        {(dev.total_flap_count ?? 0) > 0 ? (
                                          <span className="text-purple-400 font-semibold">{dev.total_flap_count}</span>
                                        ) : <span className="text-muted-foreground/40">-</span>}
                                      </td>
                                    )}
                                    <td className="py-2 px-3 text-center text-[10px] text-muted-foreground">
                                      <span className="text-emerald-500 font-medium">{dev.recovered_count || 0} คืน</span>
                                      {dev.stabilizing_count ? (
                                        <span className="text-cyan-400 font-medium ml-1">/ {dev.stabilizing_count} รอดู</span>
                                      ) : null}
                                      {(dev.ongoing_count || 0) > 0 && (
                                        <span className="text-rose-500 font-medium ml-1">/ {dev.ongoing_count} Down</span>
                                      )}
                                    </td>

                                    {incidentType === 'link' ? (
                                      <>
                                        <td className="py-2 px-3 text-center font-mono">
                                          {dev.causes?.link_flapping ? (
                                            <span className="text-purple-400 font-bold px-1.5 py-0.5 rounded bg-purple-500/10">
                                              {dev.causes.link_flapping}
                                            </span>
                                          ) : <span className="text-muted-foreground/40">-</span>}
                                        </td>
                                        <td className="py-2 px-3 text-center font-mono">
                                          {dev.causes?.physical_link_failure ? (
                                            <span className="text-rose-500 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                                              {dev.causes.physical_link_failure}
                                            </span>
                                          ) : <span className="text-muted-foreground/40">-</span>}
                                        </td>
                                        <td className="py-2 px-3 text-center font-mono">
                                          {dev.causes?.parent_device_down ? (
                                            <span className="text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10">
                                              {dev.causes.parent_device_down}
                                            </span>
                                          ) : <span className="text-muted-foreground/40">-</span>}
                                        </td>
                                        <td className="py-2 px-3 text-center font-mono">
                                          {dev.causes?.admin_shutdown ? (
                                            <span className="text-slate-400 font-bold px-1.5 py-0.5 rounded bg-slate-500/10">
                                              {dev.causes.admin_shutdown}
                                            </span>
                                          ) : <span className="text-muted-foreground/40">-</span>}
                                        </td>
                                      </>
                                    ) : (
                                      <>
                                        <td className="py-2 px-3 text-center font-mono">
                                          {dev.causes?.device_reboot_related ? (
                                            <span className="text-rose-500 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                                              {dev.causes.device_reboot_related}
                                            </span>
                                          ) : <span className="text-muted-foreground/40">-</span>}
                                        </td>
                                        <td className="py-2 px-3 text-center font-mono">
                                          {dev.causes?.device_reboot_suspected ? (
                                            <span className="text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10">
                                              {dev.causes.device_reboot_suspected}
                                            </span>
                                          ) : <span className="text-muted-foreground/40">-</span>}
                                        </td>
                                        <td className="py-2 px-3 text-center font-mono">
                                          {dev.causes?.connectivity_loss ? (
                                            <span className="text-sky-500 font-bold px-1.5 py-0.5 rounded bg-sky-500/10">
                                              {dev.causes.connectivity_loss}
                                            </span>
                                          ) : <span className="text-muted-foreground/40">-</span>}
                                        </td>
                                        <td className="py-2 px-3 text-center font-mono">
                                          {dev.causes?.unable_to_verify ? (
                                            <span className="text-purple-400 font-bold px-1.5 py-0.5 rounded bg-purple-500/10">
                                              {dev.causes.unable_to_verify}
                                            </span>
                                          ) : <span className="text-muted-foreground/40">-</span>}
                                        </td>
                                      </>
                                    )}

                                    <td className="py-2 px-3 text-center font-mono">
                                      {dev.causes?.ongoing_down ? (
                                        <span className="text-rose-400 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                                          {dev.causes.ongoing_down}
                                        </span>
                                      ) : <span className="text-muted-foreground/40">-</span>}
                                    </td>
                                    <td className="py-2 px-4 text-right font-mono text-muted-foreground text-[11px]">
                                      {formatDuration(dev.avg_downtime_seconds)}
                                    </td>
                                  </tr>

                                  {/* Interface Drill-down Sub-rows */}
                                  {isDevExpanded && dev.interfaces && dev.interfaces.map((iface: ReportInterfaceImpact) => (
                                    <tr 
                                      key={`${devKey}_${iface.interface_name}`} 
                                      className="bg-primary/5 text-xs border-b border-border/20 hover:bg-primary/10 transition-colors"
                                    >
                                      <td className="py-2 px-4 pl-16">
                                        <div className="flex items-center gap-2">
                                          <span className="text-primary/70 select-none">↳</span>
                                          <Network className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                                          <span className="font-mono font-bold text-foreground text-xs truncate max-w-[280px]" title={iface.interface_name}>
                                            {iface.interface_name}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 text-center font-mono font-bold text-primary">
                                        {iface.down_count}
                                      </td>
                                      {incidentType === 'link' && (
                                        <td className="py-2 px-3 text-center font-mono">
                                          {iface.flap_count > 0 ? (
                                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                              {iface.flap_count} รอบ
                                            </span>
                                          ) : <span className="text-muted-foreground/40">-</span>}
                                        </td>
                                      )}
                                      <td className="py-2 px-3 text-center text-[10px]">
                                        <span className="text-emerald-500 font-medium">{iface.recovered_count} คืน</span>
                                        {iface.stabilizing_count > 0 && <span className="text-cyan-400 font-medium ml-1">/ {iface.stabilizing_count} รอดู</span>}
                                        {iface.ongoing_count > 0 && <span className="text-rose-500 font-medium ml-1">/ {iface.ongoing_count} Down</span>}
                                      </td>
                                      <td colSpan={incidentType === 'link' ? 4 : 4} className="py-2 px-3 text-xs">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] text-muted-foreground">สถานะพอร์ต:</span>
                                          <StatusBadge status={iface.last_status as any} />
                                          {iface.last_classification && (
                                            <ClassificationBadge classification={iface.last_classification as any} />
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 text-center font-mono text-[10px] text-muted-foreground">
                                        -
                                      </td>
                                      <td className="py-2 px-4 text-right font-mono text-muted-foreground text-[11px]">
                                        {formatDuration(iface.avg_downtime_seconds)}
                                      </td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={incidentType === 'link' ? 10 : 9} className="py-8 text-center text-muted-foreground text-sm">
                    {loading ? 'กำลังโหลดข้อมูล...' : 'ไม่พบข้อมูลการ Down ตามเงื่อนไขและช่วงเวลาที่เลือก'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two Column Grid: Root Cause Distribution & Top Impacted Links / Devices */}
      {reportData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Root Cause Analysis Breakdown Card */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-primary" />
                <h3 className="text-base font-semibold text-foreground">
                  {incidentType === 'link' ? 'สัดส่วนสาเหตุพอร์ตดับ (Link RCA Breakdown)' : 'สัดส่วนสาเหตุการ Down (Root Cause Breakdown)'}
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">
                รวม {reportData.summary.total_incidents} เหตุการณ์
              </span>
            </div>

            {/* Stacked Proportional Bar */}
            <div className="w-full h-3.5 rounded-full overflow-hidden flex bg-muted">
              {reportData.by_root_cause.map((c) => (
                c.count > 0 && (
                  <div
                    key={c.key}
                    style={{ 
                      width: `${c.percentage}%`,
                      backgroundColor: c.color 
                    }}
                    title={`${c.label}: ${c.count} ครั้ง (${c.percentage}%)`}
                    className="h-full transition-all duration-300 first:rounded-l-full last:rounded-r-full"
                  />
                )
              ))}
            </div>

            {/* Cause Progress List */}
            <div className="space-y-3 pt-2">
              {reportData.by_root_cause.map((cause) => (
                <div key={cause.key} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span 
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: cause.color }}
                      />
                      <span className="text-foreground font-medium">{cause.label}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="font-bold text-foreground">{cause.count} ครั้ง</span>
                      <span className="text-muted-foreground">({cause.percentage}%)</span>
                    </div>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ 
                        width: `${cause.percentage}%`,
                        backgroundColor: cause.color 
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Unstable Links or Devices Card */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {incidentType === 'link' ? (
                  <Activity className="w-5 h-5 text-purple-400" />
                ) : (
                  <Server className="w-5 h-5 text-rose-500" />
                )}
                <h3 className="text-base font-semibold text-foreground">
                  {incidentType === 'link' 
                    ? 'พอร์ต/วงจรที่ไม่เสถียรที่สุด (Top Unstable Links)' 
                    : incidentType === 'device'
                    ? 'อุปกรณ์ที่ Down บ่อยที่สุด (Top Impacted Devices)'
                    : 'อันดับเหตุการณ์ขัดข้องสูงสุด (Top Impacted)'}
                </h3>
              </div>

              {incidentType === 'all' && (
                <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg text-xs">
                  <button
                    onClick={() => setTopRankTab('links')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                      topRankTab === 'links' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Links
                  </button>
                  <button
                    onClick={() => setTopRankTab('devices')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                      topRankTab === 'devices' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Devices
                  </button>
                </div>
              )}
            </div>

            {/* Link Ranking View */}
            {(incidentType === 'link' || (incidentType === 'all' && topRankTab === 'links')) ? (
              reportData.top_unstable_links && reportData.top_unstable_links.length > 0 ? (
                <div className="divide-y divide-border overflow-hidden">
                  {reportData.top_unstable_links.map((link: ReportTopUnstableLink, idx: number) => (
                    <div key={`${link.device_id}_${link.interface_name}`} className="py-2.5 flex items-center justify-between text-xs gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center font-mono font-bold text-[11px] text-muted-foreground flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div className="truncate">
                          <div className="font-bold text-foreground truncate flex items-center gap-1.5">
                            <span className="truncate">{link.interface_name}</span>
                            {link.status && <StatusBadge status={link.status as any} />}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground flex items-center gap-2">
                            <span>{link.sys_name}</span>
                            <span>&bull;</span>
                            <span>{link.management_ip}</span>
                            <span>&bull;</span>
                            <span>{link.province}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <div className="flex items-center gap-1.5 justify-end">
                          {link.total_flap_count > 0 && (
                            <span className="px-2 py-0.5 rounded-full font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 text-xs">
                              Flap {link.total_flap_count} รอบ
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded-full font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20 text-xs">
                            {link.down_count} ครั้ง
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          Net Down: {formatDuration(link.total_net_downtime_seconds)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground text-xs">
                  ไม่มีสายสัญญาณหรือพอร์ตที่มีสถิติขัดข้องในช่วงเวลานี้
                </div>
              )
            ) : (
              /* Device Ranking View */
              reportData.top_devices && reportData.top_devices.length > 0 ? (
                <div className="divide-y divide-border overflow-hidden">
                  {reportData.top_devices.map((dev, idx) => (
                    <div key={dev.device_id} className="py-2.5 flex items-center justify-between text-xs gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center font-mono font-bold text-[11px] text-muted-foreground flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div className="truncate">
                          <div className="font-bold text-foreground truncate">
                            {dev.sys_name || dev.name}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground flex items-center gap-2">
                            <span>{dev.ip}</span>
                            <span>&bull;</span>
                            <span className="truncate">{dev.hardware_model || '-'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <span className="px-2 py-0.5 rounded-full font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20 text-xs">
                          {dev.down_count} ครั้ง
                        </span>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          Down รวม {formatDuration(dev.total_downtime_seconds)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground text-xs">
                  ไม่มีอุปกรณ์ที่มีสถิติ Down ในช่วงเวลานี้
                </div>
              )
            )}
          </div>

        </div>
      )}

      {/* Incidents Drill-down Table Section */}
      {reportData && (
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                รายการเหตุการณ์ทั้งหมดตามตัวกรอง (Incident Log)
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                พบทั้งหมด {filteredIncidents.length} จาก {reportData.incidents.length} เหตุการณ์ (คลิกแถวเพื่อดูไทม์ไลน์และการวิเคราะห์เชิงลึก)
              </p>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchIncident}
                onChange={(e) => setSearchIncident(e.target.value)}
                placeholder="ค้นหา Incident, IP, Hostname, Port..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-muted-foreground uppercase tracking-wider font-semibold text-[11px]">
                  <th className="py-3 px-4">Incident ID</th>
                  <th className="py-3 px-3 text-center">ประเภท</th>
                  <th className="py-3 px-4">อุปกรณ์ & Interface</th>
                  <th className="py-3 px-3">ภูมิภาค / จังหวัด</th>
                  <th className="py-3 px-3 text-center">สถานะ</th>
                  <th className="py-3 px-3 text-center">Flap Count</th>
                  <th className="py-3 px-3">ผลวิเคราะห์สาเหตุ (RCA)</th>
                  <th className="py-3 px-3">เวลา Down</th>
                  <th className="py-3 px-3">เวลา Recovery</th>
                  <th className="py-3 px-4 text-right">ระยะเวลาขัดข้อง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredIncidents.length > 0 ? (
                  filteredIncidents.map((inc: SerializedReportIncident) => (
                    <tr
                      key={inc.id}
                      onClick={() => onSelectIncident && onSelectIncident(inc.id)}
                      className="hover:bg-muted/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-primary flex items-center gap-1.5">
                        <span>{inc.incident_number}</span>
                        <ExternalLink className="w-3 h-3 text-muted-foreground opacity-60" />
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] uppercase ${
                          inc.incident_type === 'LINK'
                            ? 'bg-sky-500/10 text-sky-400 border border-sky-500/25'
                            : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/25'
                        }`}>
                          {inc.incident_type || 'DEVICE'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-foreground">
                          {inc.sys_name || inc.device_name}
                        </div>
                        {inc.interface_name && (
                          <div className="font-mono text-[11px] text-sky-400 font-medium truncate max-w-[240px]" title={inc.interface_name}>
                            พอร์ต: {inc.interface_name}
                          </div>
                        )}
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {inc.device_ip} &bull; {inc.hardware_model || '-'}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-foreground">{inc.province} ({inc.province_code})</div>
                        <div className="text-[11px] text-muted-foreground">{inc.region}</div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <StatusBadge status={inc.status} />
                      </td>
                      <td className="py-3 px-3 text-center font-mono">
                        {(inc.flap_count ?? 0) > 0 ? (
                          <span className="px-2 py-0.5 rounded-full font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 text-xs">
                            {inc.flap_count} รอบ
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <ClassificationBadge 
                          classification={inc.classification}
                          confidence={inc.confidence}
                        />
                      </td>
                      <td className="py-3 px-3 text-muted-foreground text-[11px]">
                        {formatDateTime(inc.down_time)}
                      </td>
                      <td className="py-3 px-3 text-muted-foreground text-[11px]">
                        {formatDateTime(inc.up_time)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-foreground">
                        {formatDuration(inc.net_downtime_seconds ?? inc.downtime_seconds)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-muted-foreground text-sm">
                      ไม่พบข้อมูลเหตุการณ์ที่ตรงกับคำค้นหา
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
};
