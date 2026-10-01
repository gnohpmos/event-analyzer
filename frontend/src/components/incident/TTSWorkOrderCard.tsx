import React from 'react';
import {
  Ticket,
  Building,
  RefreshCw,
  AlertCircle,
  Wrench,
  MapPin,
  Check,
} from 'lucide-react';
import { IncidentDetail } from '../../types';

interface TTSWorkOrderCardProps {
  incident: IncidentDetail;
  syncingTicket: boolean;
  syncFeedback: { type: 'success' | 'info' | 'error'; message: string } | null;
  onSyncTicket: () => void;
}

export const TTSWorkOrderCard: React.FC<TTSWorkOrderCardProps> = ({
  incident,
  syncingTicket,
  syncFeedback,
  onSyncTicket,
}) => {
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
            <span>TSS TICKET</span>
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
                    incident.tts_status.toLowerCase().includes('close')
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  }`}
                >
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
