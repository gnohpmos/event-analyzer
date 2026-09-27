import React from 'react';
import { Network, Repeat, Clock, Activity, AlertTriangle, MapPin, Zap } from 'lucide-react';
import { IncidentReportData } from '../../../types';
import { IncidentReportType } from '../hooks/useIncidentReport';
import { formatDuration } from '../utils/reportFormatters';

interface ReportKPISummaryProps {
  summary: IncidentReportData['summary'];
  incidentType: IncidentReportType;
}

export const ReportKPISummary: React.FC<ReportKPISummaryProps> = ({ summary, incidentType }) => {
  return (
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
              {summary.total_incidents} <span className="text-sm font-normal text-muted-foreground">เหตุการณ์</span>
            </div>
            <div className="mt-2 text-xs flex items-center justify-between text-muted-foreground pt-1 border-t border-border/50">
              <span className="text-emerald-500 font-medium">กู้คืน: {summary.recovered_count}</span>
              {summary.stabilizing_count ? (
                <span className="text-cyan-400 font-medium">รอดูอาการ: {summary.stabilizing_count}</span>
              ) : null}
              <span className="text-rose-500 font-medium">ดับอยู่: {summary.ongoing_count}</span>
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
              {summary.total_flap_cycles ?? 0} <span className="text-sm font-normal text-muted-foreground">รอบสะสม</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2 truncate flex items-center justify-between pt-1 border-t border-border/50">
              <span>พอร์ตกระพริบ:</span>
              <span className="text-purple-400 font-semibold">{summary.flapping_incident_count ?? 0} เหตุการณ์</span>
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
              {formatDuration(summary.avg_net_downtime_seconds || summary.avg_downtime_seconds)}
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center justify-between pt-1 border-t border-border/50">
              <span>ดับจริงสะสม:</span>
              <span className="text-foreground font-mono">
                {formatDuration(summary.total_net_downtime_seconds || summary.total_downtime_seconds)}
              </span>
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
            <div
              className="text-sm font-bold text-foreground tracking-tight truncate"
              title={summary.top_unstable_interface}
            >
              {summary.top_unstable_interface || '-'}
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center justify-between pt-1 border-t border-border/50">
              <span>สาเหตุหลัก:</span>
              <span className="text-foreground font-medium truncate max-w-[130px]">{summary.top_root_cause}</span>
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
              {summary.total_incidents} <span className="text-sm font-normal text-muted-foreground">ครั้ง</span>
            </div>
            <div className="mt-2 text-xs flex items-center justify-between text-muted-foreground pt-1 border-t border-border/50">
              <span className="text-emerald-500 font-medium">กู้คืนแล้ว: {summary.recovered_count}</span>
              <span className="text-rose-500 font-medium">ยังไม่หาย: {summary.ongoing_count}</span>
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
            <div
              className="text-xl font-bold text-foreground tracking-tight truncate"
              title={summary.most_affected_region}
            >
              {summary.most_affected_region}
            </div>
            <p className="text-xs text-muted-foreground mt-2 truncate flex items-center gap-1 pt-1 border-t border-border/50">
              <span>จังหวัดสูงสุด:</span>
              <span className="text-foreground font-medium">{summary.most_affected_province}</span>
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
            <div
              className="text-sm font-bold text-foreground tracking-tight line-clamp-2 min-h-[2.5rem] flex items-center"
              title={summary.top_root_cause}
            >
              {summary.top_root_cause}
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5 pt-1 border-t border-border/50">
              <span>อัตราการกู้คืน:</span>
              <span className="text-emerald-500 font-semibold">{summary.recovery_rate_percent}%</span>
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
              {formatDuration(summary.avg_downtime_seconds)}
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center justify-between pt-1 border-t border-border/50">
              <span>Down รวม:</span>
              <span className="text-foreground font-mono">{formatDuration(summary.total_downtime_seconds)}</span>
            </p>
          </div>
        </>
      )}
    </div>
  );
};
