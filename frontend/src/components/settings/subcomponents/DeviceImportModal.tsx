import React from 'react';
import { sampleDevicesJson } from '../hooks/useSettings';

interface DeviceImportModalProps {
  show: boolean;
  onClose: () => void;
  importFeedback: { type: 'success' | 'error'; message: string } | null;
  importJsonText: string;
  setImportJsonText: (text: string) => void;
  importLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const DeviceImportModal: React.FC<DeviceImportModalProps> = ({
  show,
  onClose,
  importFeedback,
  importJsonText,
  setImportJsonText,
  importLoading,
  onSubmit,
  onFileUpload,
}) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full p-6 space-y-4 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div>
            <h3 className="text-lg font-bold text-foreground">Import Devices Inventory</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload a JSON file or paste a device list. Existing devices matched by Management IP will be updated.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {importFeedback && (
          <div
            className={`p-3 rounded-lg border text-xs flex items-center space-x-2 ${
              importFeedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
            }`}
          >
            <span>{importFeedback.message}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">Device JSON Array</span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setImportJsonText(sampleDevicesJson)}
                className="text-primary hover:underline font-mono text-[11px]"
              >
                Load Sample Template
              </button>
              <label className="cursor-pointer text-muted-foreground hover:text-foreground text-[11px] px-2 py-0.5 border border-border rounded bg-muted/40">
                Upload .json
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={onFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <textarea
            value={importJsonText}
            onChange={(e) => setImportJsonText(e.target.value)}
            rows={12}
            placeholder={`[\n  {\n    "hostname": "Router-01",\n    "management_ip": "10.0.10.1",\n    "device_type": "ROUTER",\n    "snmp_community": "public"\n  }\n]`}
            className="w-full flex-1 p-3 rounded-lg border border-border bg-muted/30 text-foreground font-mono text-xs focus:ring-1 focus:ring-primary focus:outline-none resize-none min-h-[220px]"
          />

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-[11px] text-muted-foreground">
              Required fields: <code className="text-primary font-mono">management_ip</code> (or{' '}
              <code className="text-primary font-mono">ip</code>)
            </span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={importLoading || !importJsonText.trim()}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all disabled:opacity-50 flex items-center space-x-1.5"
              >
                {importLoading ? (
                  <>
                    <div className="w-3 h-3 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    <span>Importing...</span>
                  </>
                ) : (
                  <span>Import Devices</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
