import React, { useState, useEffect } from 'react';
import { 
  X, 
  Clock, 
  Server, 
  Cpu, 
  FileText,
  Activity
} from 'lucide-react';
import { IncidentDetail } from '../types';
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

  useEffect(() => {
    let isMounted = true;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const data = await api.getIncidentDetail(incidentId);
        if (isMounted) setIncident(data);
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
