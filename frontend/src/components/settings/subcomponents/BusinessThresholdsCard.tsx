import React from 'react';

interface BusinessThresholdsCardProps {
  rebootThreshold: string;
  setRebootThreshold: (val: string) => void;
  rebootTolerance: string;
  setRebootTolerance: (val: string) => void;
  saving: boolean;
  handleSaveThresholds: (e: React.FormEvent) => Promise<void>;
}

export const BusinessThresholdsCard: React.FC<BusinessThresholdsCardProps> = ({
  rebootThreshold,
  setRebootThreshold,
  rebootTolerance,
  setRebootTolerance,
  saving,
  handleSaveThresholds,
}) => {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <div className="pb-4 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground">RCA Classification Thresholds</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Parameters governing automated Root Cause Analysis decision trees</p>
      </div>

      <form onSubmit={handleSaveThresholds} className="mt-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">
            Router Reboot Threshold (Seconds)
          </label>
          <input
            type="number"
            min="60"
            max="86400"
            value={rebootThreshold}
            onChange={(e) => setRebootThreshold(e.target.value)}
            className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            If sysUpTime is lower than this value (e.g. 3600s = 1 hour), the router is classified as recently rebooted.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground mb-1">
            Boot Time Delta Tolerance (Seconds)
          </label>
          <input
            type="number"
            min="10"
            max="3600"
            value={rebootTolerance}
            onChange={(e) => setRebootTolerance(e.target.value)}
            className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            Maximum allowable variance between calculated boot time and initial alarm down time (e.g. 300s = 5 min) for HIGH confidence.
          </p>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg text-sm font-medium transition-all shadow-sm"
          >
            {saving ? 'Saving changes...' : 'Save Thresholds'}
          </button>
        </div>
      </form>
    </div>
  );
};
