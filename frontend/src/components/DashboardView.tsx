import React from 'react';
import { 
  AlertTriangle, 
  RotateCw, 
  CheckCircle2, 
  HelpCircle, 
  Server, 
  Activity, 
  Clock, 
  Zap, 
  WifiOff, 
  ArrowUpRight,
  ShieldCheck,
  Radio
} from 'lucide-react';
import { DashboardSummary, IncidentListItem } from '../types';
import { StatusBadge, ClassificationBadge } from './StatusBadge';

interface DashboardViewProps {
  summary: DashboardSummary | null;
  onSelectIncident: (id: number) => void;
  onViewAllIncidents: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ 
  summary, 
  onSelectIncident,
  onViewAllIncidents 
}) => {
  if (!summary) {
    return (
      <div className="py-20 text-center">
        <Activity className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">Loading Dashboard Summary...</p>
      </div>
    );
  }

  const { counts, classifications, devices, metrics, recent_incidents, standalone_audits } = summary;

  return (
    <div className="space-y-6">
      
      {/* 6 Main KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        
        {/* Router/Device DOWN */}
        <div className="p-4 rounded-2xl bg-card border border-border hover:border-rose-500/40 transition-all shadow-sm relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-500">Router Down</span>
            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20">
              <Server className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono text-foreground tracking-tight">
            {counts.device_down ?? counts.active_down}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Host unreachable
          </p>
        </div>

        {/* Link / Interface DOWN */}
        <div className="p-4 rounded-2xl bg-card border border-border hover:border-orange-500/40 transition-all shadow-sm relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-orange-400">Link Down</span>
            <div className="p-1.5 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
              <WifiOff className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono text-foreground tracking-tight">
            {counts.link_down ?? 0}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
            Interface down
          </p>
        </div>

        {/* Flapping Links */}
        <div className="p-4 rounded-2xl bg-card border border-border hover:border-fuchsia-500/40 transition-all shadow-sm relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-fuchsia-400">Flapping</span>
            <div className="p-1.5 rounded-lg bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20">
              <Activity className="w-3.5 h-3.5 text-fuchsia-400" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono text-foreground tracking-tight">
            {counts.flapping ?? 0}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse" />
            Port flapping
          </p>
        </div>

        {/* Stabilizing / Soak Timer */}
        <div className="p-4 rounded-2xl bg-card border border-border hover:border-amber-500/40 transition-all shadow-sm relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">Stabilizing</span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono text-foreground tracking-tight">
            {counts.stabilizing ?? 0}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            45m soak timer
          </p>
        </div>

        {/* Recovered */}
        <div className="p-4 rounded-2xl bg-card border border-border hover:border-emerald-500/40 transition-all shadow-sm relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Recovered</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono text-foreground tracking-tight">
            {counts.recovered}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {metrics.recovery_rate_percent}% rate
          </p>
        </div>

        {/* Total Active Open */}
        <div className="p-4 rounded-2xl bg-card border border-border hover:border-purple-500/40 transition-all shadow-sm relative overflow-hidden group">
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">Total Active</span>
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <HelpCircle className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono text-foreground tracking-tight">
            {counts.total_active}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            Active incidents
          </p>
        </div>

      </div>

      {/* Two Column Layout: Classification Breakdown & Device Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Classification Breakdown (2 cols) */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-card border border-border space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Root Evidence Classification Breakdown
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Objective classifications computed by Classification Engine</p>
            </div>
            <span className="text-xs font-mono text-muted-foreground px-2.5 py-1 rounded bg-muted border border-border">
              Total Incidents: {counts.total_incidents}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
            {/* Device Reboot Related */}
            <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
              <div className="flex items-center gap-1.5 text-cyan-400 text-xs font-semibold mb-1">
                <Zap className="w-3.5 h-3.5" />
                Device Reboot
              </div>
              <div className="text-2xl font-bold font-mono text-cyan-400">
                {classifications.device_reboot_related}
              </div>
              <span className="text-[11px] text-muted-foreground block mt-1">Confirmed Reload</span>
            </div>

            {/* Reboot Suspected */}
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold mb-1">
                <Zap className="w-3.5 h-3.5" />
                Reboot Suspected
              </div>
              <div className="text-2xl font-bold font-mono text-amber-400">
                {classifications.device_reboot_suspected}
              </div>
              <span className="text-[11px] text-muted-foreground block mt-1">Low Confidence</span>
            </div>

            {/* Connectivity Loss */}
            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center gap-1.5 text-blue-400 text-xs font-semibold mb-1">
                <WifiOff className="w-3.5 h-3.5" />
                Connectivity Loss
              </div>
              <div className="text-2xl font-bold font-mono text-blue-400">
                {classifications.connectivity_loss}
              </div>
              <span className="text-[11px] text-muted-foreground block mt-1">Uptime &ge; 3600s</span>
            </div>

            {/* Link Flapping */}
            <div className="p-4 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/20">
              <div className="flex items-center gap-1.5 text-fuchsia-400 text-xs font-semibold mb-1">
                <Activity className="w-3.5 h-3.5" />
                Link Flapping
              </div>
              <div className="text-2xl font-bold font-mono text-fuchsia-400">
                {classifications.link_flapping ?? 0}
              </div>
              <span className="text-[11px] text-muted-foreground block mt-1">&ge; 2 Flap Cycles</span>
            </div>

            {/* Parent Device Down */}
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <div className="flex items-center gap-1.5 text-rose-400 text-xs font-semibold mb-1">
                <Server className="w-3.5 h-3.5" />
                Parent Router Down
              </div>
              <div className="text-2xl font-bold font-mono text-rose-400">
                {classifications.parent_device_down ?? 0}
              </div>
              <span className="text-[11px] text-muted-foreground block mt-1">Correlated Port Outage</span>
            </div>

            {/* Physical Link Failure */}
            <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
              <div className="flex items-center gap-1.5 text-orange-400 text-xs font-semibold mb-1">
                <WifiOff className="w-3.5 h-3.5" />
                Physical Link Failure
              </div>
              <div className="text-2xl font-bold font-mono text-orange-400">
                {classifications.physical_link_failure ?? 0}
              </div>
              <span className="text-[11px] text-muted-foreground block mt-1">Single Port Outage</span>
            </div>
          </div>
        </div>

        {/* Device Infrastructure Health (1 col) */}
        <div className="p-6 rounded-2xl bg-card border border-border flex flex-col justify-between shadow-sm">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" />
              Device Infrastructure
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Monitored equipment inventory</p>

            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border">
                <span className="text-xs text-muted-foreground">Total Devices</span>
                <span className="font-mono font-bold text-foreground text-base">{devices.total_devices}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Healthy / Reachable
                </span>
                <span className="font-mono font-bold text-emerald-400 text-base">{devices.healthy_devices}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <span className="text-xs text-rose-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  Currently Down
                </span>
                <span className="font-mono font-bold text-rose-400 text-base">{devices.devices_down}</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border mt-4 text-[11px] text-muted-foreground flex items-center justify-between">
            <span>Avg Downtime: {metrics.avg_downtime_seconds}s</span>
            <span className="text-primary flex items-center gap-1">
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              Live Monitoring
            </span>
          </div>
        </div>

      </div>

      {/* Recent Incidents Table */}
      <div className="p-6 rounded-2xl bg-card border border-border space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Recent Incidents
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Click any incident to inspect its timeline and evidence</p>
          </div>
          <button
            onClick={onViewAllIncidents}
            className="text-xs text-primary hover:underline font-medium flex items-center gap-1 transition-colors px-3 py-1.5 rounded-lg hover:bg-primary/10"
          >
            View All Incidents
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Incident Number</th>
                <th className="py-3 px-4">Device</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Classification</th>
                <th className="py-3 px-4">Down Time</th>
                <th className="py-3 px-4">Downtime</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {recent_incidents && recent_incidents.length > 0 ? (
                recent_incidents.map((inc) => (
                  <tr 
                    key={inc.id}
                    onClick={() => onSelectIncident(inc.id)}
                    className="hover:bg-muted/40 transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-4 font-bold text-primary group-hover:underline">
                      {inc.incident_number}
                    </td>
                    <td className="py-3 px-4 text-foreground">
                      <div className="font-sans font-medium">{inc.device_name}</div>
                      <div className="text-[11px] text-muted-foreground">{inc.device_ip}</div>
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={inc.status} />
                    </td>
                    <td className="py-3 px-4 font-sans">
                      <ClassificationBadge classification={inc.classification} confidence={inc.confidence} />
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {new Date(inc.down_time).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 text-foreground">
                      {inc.downtime_seconds ? `${inc.downtime_seconds.toFixed(0)}s` : 'Ongoing'}
                    </td>
                    <td className="py-3 px-4 text-right font-sans">
                      <span className="text-primary hover:underline font-medium text-xs">
                        Details &rarr;
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground font-sans">
                    No incidents recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Standalone Audit Stream */}
      {standalone_audits && standalone_audits.length > 0 && (
        <div className="p-5 rounded-2xl bg-card border border-border space-y-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            Audit Stream (Standalone Events)
          </div>
          <div className="space-y-2">
            {standalone_audits.map((audit) => (
              <div key={audit.id} className="p-3 rounded-xl bg-muted/40 border border-border flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                    {audit.event_type}
                  </span>
                  <span className="text-foreground">{audit.description}</span>
                </div>
                <span className="text-muted-foreground font-mono text-[11px]">
                  {new Date(audit.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
