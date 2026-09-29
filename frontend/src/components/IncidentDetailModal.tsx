import React, { useState, useEffect } from 'react';
import { 
  X, 
  Clock, 
  Server, 
  Cpu, 
  FileText,
  Activity,
  ShieldAlert,
  Check,
  Save,
  AlertCircle,
  RefreshCw,
  Ticket,
  Wrench,
  MapPin,
  Building
} from 'lucide-react';
import { IncidentDetail, ClassificationType, ConfidenceType } from '../types';
import { api } from '../services/api';
import { StatusBadge, ClassificationBadge } from './StatusBadge';

interface IncidentDetailModalProps {
  incidentId: number;
  onClose: () => void;
}

export const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({ incidentId, onClose }) => {
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'timeline' | 'evidence' | 'events'>('timeline');

  // Manual RCA Override States
  const [selectedCls, setSelectedCls] = useState<ClassificationType | ''>('');
  const [selectedConf, setSelectedConf] = useState<ConfidenceType>('HIGH');
  const [savingRCA, setSavingRCA] = useState<boolean>(false);
  const [rcaFeedback, setRcaFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Trouble Ticket (IPGET / TSS) Sync State
  const [syncingTicket, setSyncingTicket] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const data = await api.getIncidentDetail(incidentId);
        if (isMounted) {
          setIncident(data);
          setSelectedCls(data.classification || '');
          setSelectedConf(data.confidence || 'HIGH');
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchDetail();
    return () => { isMounted = false; };
  }, [incidentId]);

  if (!incident && loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <Activity className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading Incident Details...</p>
        </div>
      </div>
    );
  }

  if (!incident) return null;

  const formatSeconds = (sec: number | null) => {
    if (sec === null || sec === undefined) return 'Ongoing';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s (${sec.toFixed(0)}s)`;
  };

  const handleUpdateRCA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incident || !selectedCls) return;
    setSavingRCA(true);
    setRcaFeedback(null);
    try {
      const updated = await api.updateIncident(incident.id, {
        classification: selectedCls,
        confidence: selectedConf,
      });
      setIncident(updated);
      setRcaFeedback({ type: 'success', message: 'บันทึกและปรับปรุงผลวิเคราะห์ RCA สำเร็จเรียบร้อย' });
      setTimeout(() => setRcaFeedback(null), 4000);
    } catch (err: any) {
      setRcaFeedback({ type: 'error', message: err.message || 'Failed to update classification' });
    } finally {
      setSavingRCA(false);
    }
  };

  const handleSyncTicket = async () => {
    if (!incident) return;
    setSyncingTicket(true);
    setSyncFeedback(null);
    try {
      const res = await api.syncIncidentTicket(incident.id);
      if (res.ticket_id_tss || res.circuit_id || res.site_name) {
        setIncident(prev => prev ? {
          ...prev,
          ticket_id_tss: res.ticket_id_tss ?? prev.ticket_id_tss,
          circuit_id: res.circuit_id ?? prev.circuit_id,
          remote_device: res.remote_device ?? prev.remote_device,
          remote_interface: res.remote_interface ?? prev.remote_interface,
          site_name: res.site_name ?? prev.site_name,
          tts_status: res.tts_status ?? prev.tts_status,
          repair_team: res.repair_team ?? prev.repair_team,
          response_department: res.response_department ?? prev.response_department,
          actual_cause: res.actual_cause ?? prev.actual_cause,
          resolution: res.resolution ?? prev.resolution,
          source_gps: res.source_gps ?? prev.source_gps,
          dest_gps: res.dest_gps ?? prev.dest_gps,
        } : null);
        setSyncFeedback({
          type: 'success',
          message: res.ticket_id_tss 
            ? `เชื่อมโยง Trouble Ticket สำเร็จ: ${res.ticket_id_tss}${res.tts_status ? ` (${res.tts_status})` : ''}`
            : `อัปเดตข้อมูลสำเร็จ (${res.site_name || res.circuit_id || 'Matched'})`
        });
      } else {
        setSyncFeedback({
          type: 'info',
          message: 'ยังไม่พบ Trouble Ticket สำหรับรายการนี้ใน IPGET/TSS (ระบบกำลังตรวจสอบอัตโนมัติเป็นระยะ)'
        });
      }
      setTimeout(() => setSyncFeedback(null), 5000);
    } catch (err: any) {
      setSyncFeedback({
        type: 'error',
        message: err.message || 'เกิดข้อผิดพลาดในการตรวจสอบ Ticket กับ IPGET'
      });
    } finally {
      setSyncingTicket(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-card">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xl font-bold text-foreground tracking-tight">
                {incident.incident_number}
              </span>
              {incident.incident_type === 'LINK' ? (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                  LINK INCIDENT
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                  DEVICE INCIDENT
                </span>
              )}
              <StatusBadge status={incident.status} />
              <ClassificationBadge classification={incident.classification} confidence={incident.confidence} />
              {incident.ticket_id_tss && (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 font-mono">
                  <Ticket className="w-3.5 h-3.5 text-amber-400" />
                  {incident.ticket_id_tss}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 text-foreground font-medium">
                <Server className="w-3.5 h-3.5 text-primary" />
                {incident.device_name} ({incident.device_ip})
              </span>
              {incident.interface_name && (
                <>
                  <span>•</span>
                  <span className="text-cyan-400 font-mono font-medium">
                    Port: {incident.interface_name}
                  </span>
                </>
              )}
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                Downtime: {formatSeconds(incident.downtime_seconds)}
              </span>
              {incident.flap_count !== undefined && incident.flap_count > 0 && (
                <>
                  <span>•</span>
                  <span className="text-fuchsia-400 font-medium">
                    Flap Cycles: {incident.flap_count}x
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* IPGET / TSS Trouble Ticket & Repair Enrichment Card (Both LINK & DEVICE) */}
        {(incident.incident_type === 'LINK' || incident.incident_type === 'DEVICE' || incident.circuit_id || incident.ticket_id_tss || incident.link_description || incident.site_name) && (
          <div className="px-6 py-3.5 bg-gradient-to-r from-amber-500/5 via-card to-cyan-500/5 border-b border-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  <Ticket className="w-3.5 h-3.5 text-amber-400" />
                  <span>TSS TICKET</span>
                </span>
                {incident.ticket_id_tss ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm font-bold text-amber-400 bg-amber-500/15 px-2.5 py-0.5 rounded border border-amber-500/30 shadow-sm">
                      {incident.ticket_id_tss}
                    </span>
                    {incident.tts_status && (
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                        incident.tts_status.toLowerCase().includes('resolved') || incident.tts_status.toLowerCase().includes('close')
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                      }`}>
                        {incident.tts_status}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground italic flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                    รอเปิด Ticket (Auto-sync ทุก 2 นาที หรือกด Sync Ticket)
                  </span>
                )}

                {incident.circuit_id && (
                  <>
                    <span className="text-muted-foreground text-xs">•</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                      <span className="text-[10px] text-emerald-500 font-bold">CKT:</span>
                      {incident.circuit_id}
                    </span>
                  </>
                )}

                {incident.site_name && (
                  <>
                    <span className="text-muted-foreground text-xs">•</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      <Building className="w-3 h-3 text-purple-400" />
                      <span>{incident.site_name}</span>
                    </span>
                  </>
                )}

                {incident.remote_device && (
                  <>
                    <span className="text-muted-foreground text-xs">•</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      Remote: <span className="text-cyan-400 font-medium">{incident.remote_device}</span>
                      {incident.remote_interface && ` (${incident.remote_interface})`}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleSyncTicket}
                  disabled={syncingTicket}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted/80 hover:bg-muted text-foreground border border-border transition-colors disabled:opacity-50"
                  title="Query IPGET to check trouble tickets, repair team, and actual cause"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingTicket ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
                  {syncingTicket ? 'Syncing...' : 'Sync Ticket'}
                </button>
              </div>
            </div>

            {/* Sync Feedback Message */}
            {syncFeedback && (
              <div className={`mt-2 text-xs flex items-center gap-1.5 p-2 rounded-lg border ${
                syncFeedback.type === 'success' 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : syncFeedback.type === 'error'
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }`}>
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{syncFeedback.message}</span>
              </div>
            )}

            {/* Work Order & Repair Team Details */}
            {(incident.repair_team || incident.response_department || incident.source_gps || incident.dest_gps) && (
              <div className="mt-2.5 pt-2.5 border-t border-border/50 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {incident.repair_team && (
                  <div className="flex items-center gap-1.5 text-foreground/90">
                    <Wrench className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className="text-muted-foreground">ทีมช่างผู้รับผิดชอบ:</span>
                    <span className="font-medium text-foreground">{incident.repair_team}</span>
                  </div>
                )}
                {incident.response_department && (
                  <div className="flex items-center gap-1.5 text-foreground/90">
                    <Building className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                    <span className="text-muted-foreground">ฝ่าย/ศูนย์รับผิดชอบ:</span>
                    <span className="font-medium text-foreground">{incident.response_department}</span>
                  </div>
                )}
                {(incident.source_gps || incident.dest_gps) && (
                  <div className="sm:col-span-2 flex items-center gap-2 text-[11px] text-muted-foreground font-mono flex-wrap">
                    <MapPin className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                    <span className="text-muted-foreground font-sans">พิกัด GPS:</span>
                    {incident.source_gps && (
                      <span className="bg-muted px-1.5 py-0.5 rounded text-foreground/85">ต้นทาง: {incident.source_gps}</span>
                    )}
                    {incident.dest_gps && (
                      <span className="bg-muted px-1.5 py-0.5 rounded text-foreground/85">ปลายทาง: {incident.dest_gps}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Actual Root Cause & Resolution Box from TTS */}
            {(incident.actual_cause || incident.resolution) && (
              <div className="mt-2.5 p-3 rounded-xl bg-muted/40 border border-emerald-500/25 text-xs space-y-1.5 shadow-sm">
                <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>ผลการซ่อมและแก้ไขจริงจากระบบ TTS (Actual Root Cause & Resolution):</span>
                </div>
                {incident.actual_cause && (
                  <div className="text-foreground/90 leading-relaxed">
                    <span className="text-muted-foreground mr-1.5 font-medium">สาเหตุจริง:</span>
                    <span className="font-medium text-foreground">{incident.actual_cause}</span>
                  </div>
                )}
                {incident.resolution && (
                  <div className="text-foreground/90 leading-relaxed">
                    <span className="text-muted-foreground mr-1.5 font-medium">การแก้ไข:</span>
                    <span className="font-medium text-foreground">{incident.resolution}</span>
                  </div>
                )}
              </div>
            )}

            {/* Link Description Sub-row */}
            {incident.link_description && (
              <div className="mt-2 pt-2 border-t border-border/50 text-[11px] text-muted-foreground font-mono truncate" title={incident.link_description}>
                <span className="text-muted-foreground/70 font-sans mr-1">Description:</span>
                {incident.link_description}
              </div>
            )}
          </div>
        )}

        {/* Fact Summary Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 p-5 bg-muted/30 border-b border-border text-xs">
          <div className="p-3 rounded-xl bg-card border border-border shadow-sm">
            <span className="text-muted-foreground block mb-1">Down Timestamp</span>
            <span className="font-mono font-medium text-foreground">
              {new Date(incident.down_time).toLocaleString()}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-card border border-border shadow-sm">
            <span className="text-muted-foreground block mb-1">Up Timestamp</span>
            <span className="font-mono font-medium text-foreground">
              {incident.up_time ? new Date(incident.up_time).toLocaleString() : (
                incident.status === 'STABILIZING' ? 'Stabilizing (Hold-down)' : 'Not Yet Recovered'
              )}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-card border border-border shadow-sm">
            <span className="text-muted-foreground block mb-1">Incident Type</span>
            <span className="font-mono font-medium text-foreground">
              {incident.incident_type || 'DEVICE'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-card border border-border shadow-sm">
            <span className="text-muted-foreground block mb-1">Flap Counter</span>
            <span className="font-mono font-medium text-foreground">
              {incident.flap_count ?? 0} cycles
            </span>
          </div>

          <div className="p-3 rounded-xl bg-card border border-border shadow-sm">
            <span className="text-muted-foreground block mb-1">Verification Checks</span>
            <span className="font-mono font-medium text-foreground">
              {incident.verifications?.length || 0} attempts
            </span>
          </div>

          <div className="p-3 rounded-xl bg-card border border-border shadow-sm">
            <span className="text-muted-foreground block mb-1">Linked Events</span>
            <span className="font-mono font-medium text-foreground">
              {incident.incident_events?.length || 0} events
            </span>
          </div>
        </div>

        {/* Manual RCA Confirmation & Override Card */}
        <div className="px-6 py-3.5 bg-card/60 border-b border-border">
          <form onSubmit={handleUpdateRCA} className="p-4 rounded-xl border border-border bg-card shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-xs font-bold text-foreground">
                  Manual Root Cause Confirmation & Override
                </span>
                <span className="text-[11px] text-muted-foreground hidden md:inline">
                  (กำหนดหรือยืนยันสาเหตุรากเหง้าโดยวิศวกร)
                </span>
              </div>
              {rcaFeedback && (
                <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 ${
                  rcaFeedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
                }`}>
                  {rcaFeedback.type === 'success' ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                  {rcaFeedback.message}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-6 space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground block">
                  Root Cause Classification (สาเหตุรากเหง้า):
                </label>
                <select
                  value={selectedCls}
                  onChange={(e) => setSelectedCls(e.target.value as ClassificationType)}
                  className="w-full text-xs bg-muted/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                >
                  <option value="" disabled>-- เลือกสาเหตุที่ยืนยัน --</option>
                  {incident.incident_type === 'LINK' ? (
                    <>
                      <option value="PHYSICAL_LINK_FAILURE">Physical Link Failure (สายขาด / พอร์ตเสีย / อุปกรณ์ชำรุด)</option>
                      <option value="TRANSIENT_GLITCH">Transient Glitch (สัญญาณสะดุดชั่วคราว / กู้คืนในเวลาสั้น)</option>
                      <option value="LINK_FLAPPING">Link Flapping (พอร์ตกระพริบซ้ำๆ / ค่าแสงดรอป)</option>
                      <option value="PARENT_DEVICE_DOWN">Parent Device Down (เราเตอร์ตัวแม่ดับ)</option>
                      <option value="ADMIN_SHUTDOWN">Admin Shutdown (ปิดพอร์ตโดยผู้ดูแล)</option>
                    </>
                  ) : (
                    <>
                      <option value="DEVICE_REBOOT_RELATED">Device Reboot Related (รีบูตแน่นอน มีหลักฐาน uptime)</option>
                      <option value="DEVICE_REBOOT_SUSPECTED">Device Reboot Suspected (สงสัยว่าเครื่องรีบูต)</option>
                      <option value="CONNECTIVITY_LOSS">Connectivity Loss (เครือข่ายขาดหาย เครื่องไม่ได้รีบูต)</option>
                      <option value="UNABLE_TO_VERIFY">Unable to Verify (ไม่สามารถเชื่อมต่อตรวจสอบได้)</option>
                    </>
                  )}
                </select>
              </div>

              <div className="sm:col-span-3 space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground block">
                  Confidence (ความเชื่อมั่น):
                </label>
                <select
                  value={selectedConf || 'HIGH'}
                  onChange={(e) => setSelectedConf(e.target.value as ConfidenceType)}
                  className="w-full text-xs bg-muted/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="HIGH">High (ยืนยันชัดเจน)</option>
                  <option value="MEDIUM">Medium (ปานกลาง)</option>
                  <option value="LOW">Low (ข้อสันนิษฐานเบื้องต้น)</option>
                </select>
              </div>

              <div className="sm:col-span-3">
                <button
                  type="submit"
                  disabled={savingRCA || !selectedCls || (selectedCls === incident.classification && selectedConf === incident.confidence)}
                  className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground transition-all flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {savingRCA ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Confirm RCA</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Nav Tabs */}
        <div className="flex border-b border-border px-6 gap-6 bg-muted/40 text-sm">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 font-medium transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'timeline' 
                ? 'border-primary text-primary font-semibold' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Activity className="w-4 h-4" />
            Audit Timeline ({incident.timeline?.length || 0})
          </button>

          <button
            onClick={() => setActiveTab('evidence')}
            className={`py-3 font-medium transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'evidence' 
                ? 'border-primary text-primary font-semibold' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Cpu className="w-4 h-4" />
            Verification Evidence ({incident.verifications?.length || 0})
          </button>

          <button
            onClick={() => setActiveTab('events')}
            className={`py-3 font-medium transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'events' 
                ? 'border-primary text-primary font-semibold' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="w-4 h-4" />
            Raw Events ({incident.incident_events?.length || 0})
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          
          {/* TAB 1: Timeline */}
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                {incident.timeline && incident.timeline.length > 0 ? (
                  incident.timeline.map((item, idx) => (
                    <div key={item.id || idx} className="relative group">
                      <span className={`absolute -left-[23px] top-1.5 w-3 h-3 rounded-full border-2 border-card ${
                        item.event_type.includes('DOWN') ? 'bg-rose-500' :
                        item.event_type.includes('UP') ? 'bg-amber-400' :
                        item.event_type.includes('SUCCESS') || item.event_type.includes('RECOVERED') ? 'bg-emerald-400' :
                        item.event_type.includes('FAILED') ? 'bg-orange-500' :
                        'bg-primary'
                      }`} />

                      <div className="p-3.5 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors shadow-sm">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-mono font-semibold px-2 py-0.5 rounded bg-muted text-foreground border border-border">
                            {item.event_type}
                          </span>
                          <span className="text-muted-foreground font-mono">
                            {new Date(item.timestamp).toLocaleTimeString()} • {new Date(item.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm text-foreground mt-1">{item.description}</p>
                        
                        {item.source && (
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            Source: <span className="font-mono text-foreground">{item.source}</span>
                          </div>
                        )}

                        {item.data && Object.keys(item.data).length > 0 && (
                          <div className="mt-2 text-xs font-mono bg-muted/60 p-2.5 rounded-lg border border-border text-foreground overflow-x-auto">
                            {JSON.stringify(item.data, null, 2)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">No timeline entries yet.</div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Verification Evidence */}
          {activeTab === 'evidence' && (
            <div className="space-y-4">
              {incident.verifications && incident.verifications.length > 0 ? (
                incident.verifications.map((v, i) => (
                  <div key={v.id || i} className="p-5 rounded-xl bg-card border border-border space-y-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                          Attempt #{v.attempt_number}
                        </span>
                        <span className="text-sm font-medium text-foreground">{v.verification_type}</span>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        v.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' :
                        v.status === 'TIMEOUT' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/25' :
                        'bg-rose-500/10 text-rose-400 border border-rose-500/25'
                      }`}>
                        {v.status}
                      </span>
                    </div>

                    {v.error_message && (
                      <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-400">
                        Error: {v.error_message}
                      </div>
                    )}

                    {v.evidence && Object.keys(v.evidence).length > 0 && (
                      <div className="space-y-2 pt-2">
                        {v.evidence.reload_reason && (
                          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between">
                            <div>
                              <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">
                                Verified Reload Cause ({v.evidence.reload_method || 'AUTO'})
                              </div>
                              <div className="text-sm font-semibold text-foreground mt-0.5">
                                {v.evidence.reload_reason}
                              </div>
                            </div>
                            {v.evidence.reload_category && (
                              <span className="px-2.5 py-1 rounded text-xs font-bold bg-emerald-500/20 text-emerald-300 font-mono">
                                {v.evidence.reload_category}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div className="p-2.5 rounded-lg bg-muted/40 border border-border">
                          <span className="text-muted-foreground block text-[11px]">Router Uptime</span>
                          <span className="font-mono text-foreground font-semibold text-sm">
                            {v.evidence.router_uptime_seconds ? `${v.evidence.router_uptime_seconds.toFixed(1)}s` : 'N/A'}
                          </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-muted/40 border border-border">
                          <span className="text-muted-foreground block text-[11px]">Raw TimeTicks</span>
                          <span className="font-mono text-foreground font-semibold">
                            {v.evidence.raw_sysuptime || 'N/A'}
                          </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-muted/40 border border-border">
                          <span className="text-muted-foreground block text-[11px]">Estimated Boot</span>
                          <span className="font-mono text-foreground">
                            {v.evidence.estimated_boot_time ? new Date(v.evidence.estimated_boot_time).toLocaleTimeString() : 'N/A'}
                          </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-muted/40 border border-border">
                          <span className="text-muted-foreground block text-[11px]">Protocol Version</span>
                          <span className="font-mono text-foreground">
                            {v.evidence.snmp_version || 'v2c'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                    <div className="text-[11px] text-muted-foreground font-mono">
                      Checked at: {v.check_time ? new Date(v.check_time).toLocaleString() : 'N/A'}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No verification checks performed for this incident yet.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Raw Events */}
          {activeTab === 'events' && (
            <div className="space-y-4">
              {incident.incident_events && incident.incident_events.length > 0 ? (
                incident.incident_events.map((link, idx) => (
                  <div key={link.id || idx} className="p-4 rounded-xl bg-card border border-border space-y-2 shadow-sm">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-bold">
                          {link.relationship_type}
                        </span>
                        <span className="font-medium text-foreground">{link.event.event_type} / {link.event.event_status}</span>
                      </div>
                      <span className="text-muted-foreground font-mono">
                        {new Date(link.event.event_time).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Message: <span className="font-mono text-foreground">{link.event.message || '—'}</span>
                    </p>

                    {link.event.metadata && (
                      <div className="mt-2 text-xs font-mono bg-muted/60 p-2.5 rounded-lg border border-border text-foreground overflow-x-auto">
                        Metadata: {JSON.stringify(link.event.metadata, null, 2)}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">No linked events found.</div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-card flex items-center justify-between">
          <span className="text-xs text-muted-foreground">ID: {incident.id} • Created: {new Date(incident.created_at).toLocaleString()}</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
