import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { IncidentListItem, IncidentStatus } from '../types';
import { StatusBadge, ClassificationBadge } from './StatusBadge';
import { IncidentDetailModal } from './IncidentDetailModal';

export const IncidentsView: React.FC = () => {
  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'DEVICE' | 'LINK'>('ALL');
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadIncidents();
  }, [statusFilter, typeFilter]);

  const loadIncidents = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getIncidents({
        status: statusFilter || undefined,
        incident_type: typeFilter === 'ALL' ? undefined : typeFilter,
        search: search || undefined,
      });
      setIncidents(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch incidents');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadIncidents();
  };

  const handleDeleteIncident = async (id: number, number: string) => {
    const confirmed = window.confirm(`Are you sure you want to permanently delete incident ${number}? This will also delete all associated verification and timeline logs.`);
    if (!confirmed) return;

    try {
      setDeletingId(id);
      await api.deleteIncident(id);
      setIncidents((prev) => prev.filter((i) => i.id !== id));
      setActionSuccess(`Incident ${number} was deleted successfully.`);
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(`Error deleting incident: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleQuickStatusChange = async (id: number, newStatus: string) => {
    try {
      await api.updateIncident(id, { status: newStatus });
      setIncidents((prev) =>
        prev.map((inc) => (inc.id === id ? { ...inc, status: newStatus as IncidentStatus } : inc))
      );
      setActionSuccess(`Status updated to ${newStatus}`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Incidents Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse, inspect, edit status, or delete network incidents and view RCA evidence.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadIncidents}
            className="p-2 bg-card hover:bg-muted text-muted-foreground rounded-lg border border-border text-xs transition-all shadow-sm"
            title="Refresh list"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {actionSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 px-4 py-2.5 rounded-lg text-xs font-medium flex items-center">
          <svg className="w-4 h-4 mr-2 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col md:flex-row gap-3">
        {/* Incident Type Tabs */}
        <div className="flex bg-muted/60 p-1 rounded-lg border border-border text-xs font-medium">
          <button
            onClick={() => setTypeFilter('ALL')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              typeFilter === 'ALL'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setTypeFilter('DEVICE')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              typeFilter === 'DEVICE'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Device
          </button>
          <button
            onClick={() => setTypeFilter('LINK')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              typeFilter === 'LINK'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Link / Port
          </button>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex-1 relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by incident number, device, port, or IP..."
            className="w-full bg-card border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <svg
            className="w-4 h-4 absolute left-3 top-3 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </form>

        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Statuses</option>
            <option value="DOWN">DOWN</option>
            <option value="FLAPPING">FLAPPING</option>
            <option value="STABILIZING">STABILIZING (SOAK)</option>
            <option value="RECOVERY_CHECK">RECOVERY_CHECK</option>
            <option value="RECOVERED">RECOVERED</option>
            <option value="MANUAL_REVIEW_REQUIRED">MANUAL_REVIEW_REQUIRED</option>
            <option value="VERIFICATION_FAILED">VERIFICATION_FAILED</option>
          </select>
        </div>
      </div>

      {/* Incidents Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-20 text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-3"></div>
            <span>Loading incidents...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-400">{error}</div>
        ) : (Array.isArray(incidents) ? incidents : []).length === 0 ? (
          <div className="p-16 text-center text-muted-foreground">
            <svg className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-base font-medium text-foreground">No incidents found</p>
            <p className="text-xs text-muted-foreground mt-1">Try clearing your filters or check webhook ingestion</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-foreground">
              <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground border-b border-border font-semibold">
                <tr>
                  <th className="px-5 py-3.5">Incident Number</th>
                  <th className="px-5 py-3.5">Device & Target</th>
                  <th className="px-5 py-3.5">Status & Action</th>
                  <th className="px-5 py-3.5">Classification</th>
                  <th className="px-5 py-3.5">Down / Up Time</th>
                  <th className="px-5 py-3.5 text-center">Verifications</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(Array.isArray(incidents) ? incidents : []).map((incident) => (
                  <tr key={incident.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-5 py-4 font-mono font-medium text-primary">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedIncidentId(incident.id)}
                          className="hover:underline text-left"
                        >
                          {incident.incident_number}
                        </button>
                        {incident.incident_type === 'LINK' ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                            LINK
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                            DEVICE
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="font-medium text-foreground">{incident.device_name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{incident.device_ip}</div>
                      {incident.interface_name && (
                        <div className="text-xs font-mono text-cyan-400 font-medium mt-0.5">
                          Port: {incident.interface_name}
                        </div>
                      )}
                      {incident.flap_count !== undefined && incident.flap_count > 0 && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/25">
                          Flapped {incident.flap_count}x
                        </span>
                      )}
                      {incident.status === 'STABILIZING' && incident.soak_until && (
                        <div className="text-[11px] text-amber-400 font-medium mt-1">
                          Soak until {new Date(incident.soak_until).toLocaleTimeString()}
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center space-x-2">
                        <StatusBadge status={incident.status} />
                        <select
                          value={incident.status}
                          onChange={(e) => handleQuickStatusChange(incident.id, e.target.value)}
                          className="bg-card border border-border rounded text-[11px] text-foreground py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                          title="Quick change status"
                        >
                          <option value="DOWN">Set DOWN</option>
                          <option value="FLAPPING">Set FLAPPING</option>
                          <option value="STABILIZING">Set STABILIZING</option>
                          <option value="RECOVERY_CHECK">Set RECOVERY_CHECK</option>
                          <option value="RECOVERED">Set RECOVERED</option>
                          <option value="MANUAL_REVIEW_REQUIRED">Set MANUAL_REVIEW</option>
                        </select>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <ClassificationBadge classification={incident.classification} />
                      {incident.confidence && (
                        <div className="text-[10px] text-muted-foreground mt-1 uppercase">
                          Confidence: {incident.confidence}
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4 text-xs">
                      <div>Down: {new Date(incident.down_time).toLocaleTimeString()}</div>
                      {incident.up_time ? (
                        <div className="text-emerald-400">Up: {new Date(incident.up_time).toLocaleTimeString()}</div>
                      ) : incident.status === 'STABILIZING' ? (
                        <div className="text-amber-400 font-semibold">Stabilizing...</div>
                      ) : (
                        <div className="text-rose-400 font-semibold">Still Down</div>
                      )}
                    </td>

                    <td className="px-5 py-4 text-center">
                      <span className="px-2 py-0.5 rounded-full bg-muted text-xs font-semibold text-foreground border border-border">
                        {incident.verifications_count} checks
                      </span>
                    </td>

                    <td className="px-5 py-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => setSelectedIncidentId(incident.id)}
                        className="px-2.5 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded text-xs font-medium transition-colors"
                      >
                        Inspect
                      </button>
                      <button
                        onClick={() => handleDeleteIncident(incident.id, incident.incident_number)}
                        disabled={deletingId === incident.id}
                        className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded text-xs font-medium transition-colors"
                        title="Delete this incident and its history"
                      >
                        {deletingId === incident.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Incident Detail Modal */}
      {selectedIncidentId !== null && (
        <IncidentDetailModal
          incidentId={selectedIncidentId}
          onClose={() => setSelectedIncidentId(null)}
        />
      )}
    </div>
  );
};
