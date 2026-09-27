import React from 'react';

interface TelemetryManagementCardProps {
  devLoadingAction: string | null;
  devFeedback: { type: 'success' | 'error'; message: string } | null;
  setDevFeedback: (val: { type: 'success' | 'error'; message: string } | null) => void;
  triggerClearEvents: () => void;
  triggerClearIncidents: () => void;
  triggerClearTelemetry: () => void;
  triggerSeedSampleDevices: () => void;
  triggerExportDevices: () => void;
  onOpenImportModal: () => void;
}

export const TelemetryManagementCard: React.FC<TelemetryManagementCardProps> = ({
  devLoadingAction,
  devFeedback,
  setDevFeedback,
  triggerClearEvents,
  triggerClearIncidents,
  triggerClearTelemetry,
  triggerSeedSampleDevices,
  triggerExportDevices,
  onOpenImportModal,
}) => {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <div className="flex items-center space-x-2 text-primary text-xs font-semibold uppercase tracking-wider">
            <span className="px-2 py-0.5 bg-primary/10 rounded font-mono">DEV / LAB UTILITIES</span>
            <span>•</span>
            <span>Data & Inventory Management</span>
          </div>
          <h2 className="text-xl font-bold text-foreground mt-1">Development Data Controls & Device Inventory</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tools for DEV testing: flush event logs or incidents during RCA cycle validations, seed sample network topology, or batch import/export devices.
          </p>
        </div>
        <div className="flex items-center space-x-2 self-start md:self-auto">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 animate-pulse" />
            DEV Environment Active
          </span>
        </div>
      </div>

      {/* Feedback message */}
      {devFeedback && (
        <div
          className={`p-3.5 rounded-lg border text-sm flex items-center justify-between ${
            devFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
          }`}
        >
          <div className="flex items-center space-x-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {devFeedback.type === 'success' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              )}
            </svg>
            <span>{devFeedback.message}</span>
          </div>
          <button onClick={() => setDevFeedback(null)} className="text-xs hover:underline opacity-80">
            Dismiss
          </button>
        </div>
      )}

      {/* 2 Sub-panels: Telemetry Purge vs Device Inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sub-panel 1: Telemetry & Log Clearers */}
        <div className="bg-muted/30 border border-border rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-foreground">Operational Telemetry Purge</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Wipe operational logs or active/historical incidents to reset RCA engine testing cycles without modifying devices.
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-border">
              <div>
                <div className="text-xs font-semibold text-foreground">Clear Events & Logs</div>
                <div className="text-[11px] text-muted-foreground">Purge all Network Events and PRTG webhook payloads</div>
              </div>
              <button
                type="button"
                onClick={triggerClearEvents}
                disabled={devLoadingAction !== null}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30 text-foreground transition-all disabled:opacity-50"
              >
                {devLoadingAction === 'clear-events' ? 'Clearing...' : 'Clear Events'}
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-border">
              <div>
                <div className="text-xs font-semibold text-foreground">Clear Incidents & RCA</div>
                <div className="text-[11px] text-muted-foreground">Purge all Incidents, verifications, and timeline records</div>
              </div>
              <button
                type="button"
                onClick={triggerClearIncidents}
                disabled={devLoadingAction !== null}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30 text-foreground transition-all disabled:opacity-50"
              >
                {devLoadingAction === 'clear-incidents' ? 'Clearing...' : 'Clear Incidents'}
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-rose-500/5 border border-rose-500/20">
              <div>
                <div className="text-xs font-semibold text-rose-400">Reset All Telemetry</div>
                <div className="text-[11px] text-muted-foreground">Flush both Events and Incidents (Clean Slate)</div>
              </div>
              <button
                type="button"
                onClick={triggerClearTelemetry}
                disabled={devLoadingAction !== null}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-all disabled:opacity-50"
              >
                {devLoadingAction === 'clear-telemetry' ? 'Resetting...' : 'Reset All'}
              </button>
            </div>
          </div>
        </div>

        {/* Sub-panel 2: Device Inventory Importer & Seeder */}
        <div className="bg-muted/30 border border-border rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                  />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-foreground">Devices Inventory Management</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Batch import topology from JSON, seed default lab test devices (Core Router, Edge Gateway @ 10.0.10.9), or export current inventory.
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-border">
              <div>
                <div className="text-xs font-semibold text-foreground">Seed Sample Lab Devices</div>
                <div className="text-[11px] text-muted-foreground">Populate standard lab routers, switches, and firewall</div>
              </div>
              <button
                type="button"
                onClick={triggerSeedSampleDevices}
                disabled={devLoadingAction !== null}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-primary/10 hover:text-primary hover:border-primary/30 text-foreground transition-all disabled:opacity-50"
              >
                {devLoadingAction === 'seed-devices' ? 'Seeding...' : 'Seed Lab Preset'}
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-border">
              <div>
                <div className="text-xs font-semibold text-foreground">Batch Import Devices (JSON)</div>
                <div className="text-[11px] text-muted-foreground">Upload or paste device array with IP, community, type</div>
              </div>
              <button
                type="button"
                onClick={onOpenImportModal}
                disabled={devLoadingAction !== null}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all disabled:opacity-50 flex items-center space-x-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Import JSON</span>
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-border">
              <div>
                <div className="text-xs font-semibold text-foreground">Export Devices Inventory</div>
                <div className="text-[11px] text-muted-foreground">Download current devices as formatted JSON</div>
              </div>
              <button
                type="button"
                onClick={triggerExportDevices}
                disabled={devLoadingAction !== null}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-all disabled:opacity-50 flex items-center space-x-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>{devLoadingAction === 'export-devices' ? 'Exporting...' : 'Export JSON'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
