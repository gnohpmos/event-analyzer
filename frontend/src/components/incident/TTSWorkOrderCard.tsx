import React, { useState, useEffect } from 'react';
import {
  Ticket,
  Building,
  RefreshCw,
  AlertCircle,
  Wrench,
  MapPin,
  Check,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Send,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import { IncidentDetail } from '../../types';
import { api } from '../../services/api';

interface TTSWorkOrderCardProps {
  incident: IncidentDetail;
  syncingTicket: boolean;
  syncFeedback: { type: 'success' | 'info' | 'error'; message: string } | null;
  onSyncTicket: () => void;
  onTicketOpened?: (ticketId: string, status: string) => void;
}

export const TTSWorkOrderCard: React.FC<TTSWorkOrderCardProps> = ({
  incident,
  syncingTicket,
  syncFeedback,
  onSyncTicket,
  onTicketOpened,
}) => {
  const [eligibility, setEligibility] = useState<{
    is_eligible: boolean;
    circuit_id: string;
    downtime_seconds: number;
    remaining_seconds: number;
    conditions: {
      ipget_confirmed: { passed: boolean; label: string; details?: string | null };
      has_circuit_id: { passed: boolean; label: string; details?: string | null };
      sustained_15m: { passed: boolean; label: string; current_minutes: number; required_minutes: number; remaining_seconds: number };
      no_existing_ticket: { passed: boolean; label: string; existing_ticket?: string | null };
    };
    reasons: string[];
    proposed_description?: string;
  } | null>(null);

  const [loadingEligibility, setLoadingEligibility] = useState(false);
  const [openingTicket, setOpeningTicket] = useState(false);
  const [openingOSTicket, setOpeningOSTicket] = useState(false);
  const [showEligibilityDetails, setShowEligibilityDetails] = useState(false);
  const [openFeedback, setOpenFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Load ticket eligibility if incident does not yet have a ticket
  useEffect(() => {
    if (!incident.ticket_id_tss && incident.id) {
      loadEligibility();
    }
  }, [incident.id, incident.ticket_id_tss]);

  // Re-check eligibility after ticket sync completes
  useEffect(() => {
    if (!syncingTicket && !incident.ticket_id_tss && incident.id) {
      loadEligibility();
    }
  }, [syncingTicket]);

  // Auto-refresh eligibility every 15s if not yet eligible
  useEffect(() => {
    if (!incident.ticket_id_tss && eligibility && !eligibility.is_eligible) {
      const timer = setInterval(() => {
        loadEligibility();
      }, 15000);
      return () => clearInterval(timer);
    }
  }, [incident.ticket_id_tss, eligibility?.is_eligible]);

  const loadEligibility = async () => {
    try {
      setLoadingEligibility(true);
      const res = await api.checkTicketEligibility(incident.id);
      setEligibility(res);
    } catch (e) {
      console.warn('Failed to load ticket eligibility:', e);
    } finally {
      setLoadingEligibility(false);
    }
  };

  const handleOpenTicket = async () => {
    if (!incident.id) return;
    setOpeningTicket(true);
    setOpenFeedback(null);
    try {
      const res = await api.openIncidentTicket(incident.id);
      if (res.status === 'success' && res.ticket_id_tss) {
        const osticketMsg = res.ticket_id_osticket ? ` | osTicket: ${res.ticket_id_osticket}` : '';
        setOpenFeedback({
          type: 'success',
          message: `เปิด Ticket สำเร็จ: NT TTS (${res.ticket_id_tss})${osticketMsg}`
        });
        if (onTicketOpened) {
          onTicketOpened(res.ticket_id_tss, res.tts_status || 'Open');
        }
        onSyncTicket();
      } else {
        throw new Error(res.message || 'ไม่สามารถเปิดตั๋วได้');
      }
    } catch (err: any) {
      setOpenFeedback({
        type: 'error',
        message: err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเปิดตั๋วบน NT TTS'
      });
    } finally {
      setOpeningTicket(false);
      loadEligibility();
    }
  };

  const handleOpenOSTicket = async () => {
    if (!incident.id) return;
    setOpeningOSTicket(true);
    setOpenFeedback(null);
    try {
      const res = await api.openIncidentOSTicket(incident.id);
      if (res.status === 'success' && res.ticket_id_osticket) {
        const successMsg = res.details?.message || `เปิด osTicket สำเร็จเรียบร้อย: ${res.ticket_id_osticket}`;
        setOpenFeedback({
          type: 'success',
          message: successMsg
        });
        onSyncTicket();
      } else {
        throw new Error(res.message || 'ไม่สามารถเปิด osTicket ได้');
      }
    } catch (err: any) {
      setOpenFeedback({
        type: 'error',
        message: err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเปิดตั๋วบน osTicket'
      });
    } finally {
      setOpeningOSTicket(false);
    }
  };

  const shouldRender =
    incident.incident_type === 'LINK' ||
    incident.incident_type === 'DEVICE' ||
    incident.circuit_id ||
    incident.ticket_id_tss ||
    incident.link_description ||
    incident.site_name;

  if (!shouldRender) return null;

  return (
    <div className="px-6 py-3.5 bg-gradient-to-r from-amber-500/5 via-card to-cyan-500/5 border-b border-border">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <Ticket className="w-3.5 h-3.5 text-amber-400" />
            <span>NT TTS TICKET</span>
          </span>
          {incident.ticket_id_tss ? (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm font-bold text-amber-400 bg-amber-500/15 px-2.5 py-0.5 rounded border border-amber-500/30 shadow-sm">
                {incident.ticket_id_tss}
              </span>
              {incident.tts_status && (
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                    incident.tts_status.toLowerCase().includes('resolved') ||
                    incident.tts_status.toLowerCase().includes('close') ||
                    incident.tts_status.toLowerCase().includes('complete')
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {incident.tts_status}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground italic flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${eligibility?.is_eligible ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`}></span>
                {eligibility?.is_eligible ? 'ผ่านเกณฑ์ครบ 4 เงื่อนไข พร้อมเปิด Ticket' : 'ตรวจสอบเงื่อนไขการเปิด Ticket'}
              </span>
              <button
                type="button"
                onClick={() => setShowEligibilityDetails(!showEligibilityDetails)}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 underline decoration-dotted ml-1"
              >
                {showEligibilityDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {showEligibilityDetails ? 'ซ่อนเงื่อนไข' : 'ดู 4 เงื่อนไข'}
              </button>
            </div>
          )}

          {incident.ticket_id_osticket && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">•</span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                <Ticket className="w-3.5 h-3.5 text-blue-400" />
                <span>osTicket:</span>
                <a
                  href={`https://msticket.catbb.net/osticket/scp/tickets.php?number=${incident.ticket_id_osticket}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono font-bold text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-1"
                  title="เปิดดูตั๋วบน AIT osTicket"
                >
                  {incident.ticket_id_osticket}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </span>
              {incident.osticket_status && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  {incident.osticket_status}
                </span>
              )}
            </div>
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
          {!incident.ticket_id_tss && (
            <button
              type="button"
              onClick={handleOpenTicket}
              disabled={openingTicket || !eligibility?.is_eligible}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all ${
                eligibility?.is_eligible
                  ? 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-amber-500/20 cursor-pointer animate-pulse'
                  : 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed border border-border'
              }`}
              title={
                eligibility?.is_eligible
                  ? 'ส่งคำสั่งเปิด Ticket ในระบบ NT TTS ทันที'
                  : eligibility?.reasons?.join('\n') || 'ยังไม่ผ่านเงื่อนไขการเปิดตั๋ว'
              }
            >
              <Send className={`w-3.5 h-3.5 ${openingTicket ? 'animate-spin' : ''}`} />
              {openingTicket ? 'กำลังเปิดตั๋วบน NT TTS...' : 'เปิด Ticket NT TTS'}
            </button>
          )}

          {incident.ticket_id_tss && !incident.ticket_id_osticket && (
            <button
              type="button"
              onClick={handleOpenOSTicket}
              disabled={openingOSTicket}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-blue-500/20 cursor-pointer"
              title="ส่งคำสั่งเปิด Ticket ในระบบ AIT osTicket ทันที"
            >
              <Send className={`w-3.5 h-3.5 ${openingOSTicket ? 'animate-spin' : ''}`} />
              {openingOSTicket ? 'กำลังเปิด osTicket...' : 'เปิด osTicket'}
            </button>
          )}

          <button
            type="button"
            onClick={onSyncTicket}
            disabled={syncingTicket}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted/80 hover:bg-muted text-foreground border border-border transition-colors disabled:opacity-50"
            title="Query IPGET to check trouble tickets, repair team, and actual cause"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingTicket ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
            {syncingTicket ? 'Syncing...' : 'Sync Ticket'}
          </button>
        </div>
      </div>

      {/* 4-Condition Visual Eligibility Checklist (Shown if not yet ticketed or user clicks expand) */}
      {!incident.ticket_id_tss && (showEligibilityDetails || !eligibility?.is_eligible) && eligibility && (
        <div className="mt-2.5 pt-2.5 border-t border-border/40">
          <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              <span>เกณฑ์การตรวจสอบ 4 เงื่อนไขก่อนเปิดตั๋ว (Ticket Policy Gatekeeper):</span>
              <button
                type="button"
                onClick={loadEligibility}
                disabled={loadingEligibility}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 transition-colors cursor-pointer"
                title="คลิกเพื่อตรวจสอบเงื่อนไขใหม่ทันที"
              >
                <RefreshCw className={`w-2.5 h-2.5 ${loadingEligibility ? 'animate-spin text-primary' : ''}`} />
                <span>รีเฟรช</span>
              </button>
            </span>
            <span className={eligibility.is_eligible ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
              {eligibility.is_eligible ? '✓ ครบทุกเงื่อนไข' : `ขาด ${eligibility.reasons.length} เงื่อนไข`}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
            {/* Condition 1 */}
            <div className={`p-2 rounded-lg border flex items-start gap-2 ${
              eligibility.conditions.ipget_confirmed.passed
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-muted/60 border-border text-muted-foreground'
            }`}>
              {eligibility.conditions.ipget_confirmed.passed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-medium text-[11px] leading-tight">1. ยืนยัน Down จาก IPGET (API 1)</div>
                <div className="text-[10px] opacity-80 mt-0.5">
                  {eligibility.conditions.ipget_confirmed.passed ? 'พบ Alarm ยืนยัน' : 'ยังไม่พบ Alarm'}
                </div>
              </div>
            </div>

            {/* Condition 2 */}
            <div className={`p-2 rounded-lg border flex items-start gap-2 ${
              eligibility.conditions.has_circuit_id.passed
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-muted/60 border-border text-muted-foreground'
            }`}>
              {eligibility.conditions.has_circuit_id.passed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-medium text-[11px] leading-tight">2. Circuit ID จาก API 1</div>
                <div className="text-[10px] font-mono opacity-80 mt-0.5">
                  {eligibility.circuit_id || 'ไม่พบ Circuit ID'}
                </div>
              </div>
            </div>

            {/* Condition 3 */}
            <div className={`p-2 rounded-lg border flex items-start gap-2 ${
              eligibility.conditions.sustained_15m.passed
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}>
              {eligibility.conditions.sustained_15m.passed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <Clock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-medium text-[11px] leading-tight">3. Down ต่อเนื่อง &gt;= 15 นาที</div>
                <div className="text-[10px] opacity-80 mt-0.5">
                  {eligibility.conditions.sustained_15m.current_minutes}/15 นาที{' '}
                  {!eligibility.conditions.sustained_15m.passed && (
                    <span className="font-semibold text-rose-400">
                      (รออีก {Math.ceil(eligibility.conditions.sustained_15m.remaining_seconds / 60)} น.)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Condition 4 */}
            <div className={`p-2 rounded-lg border flex items-start gap-2 ${
              eligibility.conditions.no_existing_ticket.passed
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}>
              {eligibility.conditions.no_existing_ticket.passed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-medium text-[11px] leading-tight">4. ยังไม่มีตั๋วเปิดในระบบ</div>
                <div className="text-[10px] opacity-80 mt-0.5">
                  {eligibility.conditions.no_existing_ticket.passed ? 'ยังไม่มีตั๋ว' : `มีตั๋วแล้ว (${incident.ticket_id_tss})`}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Open Ticket Feedback Message */}
      {openFeedback && (
        <div
          className={`mt-2 text-xs flex items-center gap-1.5 p-2 rounded-lg border ${
            openFeedback.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
          }`}
        >
          {openFeedback.type === 'success' ? (
            <Check className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          )}
          <span>{openFeedback.message}</span>
        </div>
      )}

      {/* Sync Feedback Message */}
      {syncFeedback && (
        <div
          className={`mt-2 text-xs flex items-center gap-1.5 p-2 rounded-lg border ${
            syncFeedback.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : syncFeedback.type === 'error'
              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
          }`}
        >
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
                <span className="bg-muted px-1.5 py-0.5 rounded text-foreground/85">
                  ต้นทาง: {incident.source_gps}
                </span>
              )}
              {incident.dest_gps && (
                <span className="bg-muted px-1.5 py-0.5 rounded text-foreground/85">
                  ปลายทาง: {incident.dest_gps}
                </span>
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
        <div
          className="mt-2 pt-2 border-t border-border/50 text-[11px] text-muted-foreground font-mono truncate"
          title={incident.link_description}
        >
          <span className="text-muted-foreground/70 font-sans mr-1">Description:</span>
          {incident.link_description}
        </div>
      )}
    </div>
  );
};
