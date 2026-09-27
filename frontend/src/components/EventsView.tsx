import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { NetworkEvent } from '../types';

export const EventsView: React.FC = () => {
  const [events, setEvents] = useState<NetworkEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    loadEvents();
  }, [statusFilter]);

  const loadEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getEvents({
        status: statusFilter || undefined,
      });
      setEvents(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch events');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Network Events Audit</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Normalized event stream received from PRTG Webhooks and other monitoring sources.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadEvents}
            className="p-2 bg-card hover:bg-muted text-muted-foreground rounded-lg border border-border text-xs transition-all shadow-sm"
            title="Refresh list"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Filter Event Status:</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Statuses</option>
          <option value="DOWN">DOWN</option>
          <option value="UP">UP</option>
          <option value="WARNING">WARNING</option>
        </select>
      </div>

      {/* Events Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-20 text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-3"></div>
            <span>Loading events...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-400">{error}</div>
        ) : (Array.isArray(events) ? events : []).length === 0 ? (
          <div className="p-16 text-center text-muted-foreground">
            <svg className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-base font-medium text-foreground">No events found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-foreground">
              <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground border-b border-border font-semibold">
                <tr>
                  <th className="px-5 py-3.5">Time</th>
                  <th className="px-5 py-3.5">Source</th>
                  <th className="px-5 py-3.5">Device</th>
                  <th className="px-5 py-3.5">Event Type</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Severity</th>
                  <th className="px-5 py-3.5">Message</th>
                  <th className="px-5 py-3.5">Idempotency Key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-xs">
                {(Array.isArray(events) ? events : []).map((ev) => (
                  <tr key={ev.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-5 py-3.5 text-muted-foreground whitespace-nowrap">
                      {new Date(ev.event_time).toLocaleTimeString()}
                    </td>
                    <td className="px-5 py-3.5 font-sans font-medium text-primary">
                      {ev.source_name}
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      <div className="font-medium text-foreground">{ev.device_name}</div>
                      <div className="text-[11px] text-muted-foreground">{ev.device_ip}</div>
                    </td>
                    <td className="px-5 py-3.5 text-foreground font-sans">
                      {ev.event_type}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        ev.event_status === 'DOWN' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/25' :
                        ev.event_status === 'UP' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' :
                        'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                      }`}>
                        {ev.event_status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      <span className="text-[11px] text-muted-foreground">{ev.severity}</span>
                    </td>
                    <td className="px-5 py-3.5 font-sans text-muted-foreground max-w-xs truncate" title={ev.message}>
                      {ev.message || '-'}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-[10px]" title={ev.idempotency_key}>
                      {ev.idempotency_key.substring(0, 10)}...
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
