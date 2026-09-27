import React from 'react';
import { SNMPTestResult } from '../../../types';

interface SNMPSettingsCardProps {
  snmpCommunity: string;
  setSnmpCommunity: (val: string) => void;
  showCommunity: boolean;
  setShowCommunity: (val: boolean) => void;
  snmpTimeout: string;
  setSnmpTimeout: (val: string) => void;
  snmpMaxRetries: string;
  setSnmpMaxRetries: (val: string) => void;
  snmpRetryDelay: string;
  setSnmpRetryDelay: (val: string) => void;
  saving: boolean;
  onSaveSNMP: (e: React.FormEvent) => void;
  testHost: string;
  setTestHost: (val: string) => void;
  testCommunity: string;
  setTestCommunity: (val: string) => void;
  testTimeout: number;
  setTestTimeout: (val: number) => void;
  testLoading: boolean;
  testResult: SNMPTestResult | null;
  onRunSNMPTest: (e: React.FormEvent) => void;
}

export const SNMPSettingsCard: React.FC<SNMPSettingsCardProps> = ({
  snmpCommunity,
  setSnmpCommunity,
  showCommunity,
  setShowCommunity,
  snmpTimeout,
  setSnmpTimeout,
  snmpMaxRetries,
  setSnmpMaxRetries,
  snmpRetryDelay,
  setSnmpRetryDelay,
  saving,
  onSaveSNMP,
  testHost,
  setTestHost,
  testCommunity,
  setTestCommunity,
  testTimeout,
  setTestTimeout,
  testLoading,
  testResult,
  onRunSNMPTest,
}) => {
  return (
    <>
      {/* SNMP Configuration Form */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div>
              <h3 className="text-lg font-semibold text-foreground">SNMP Verification Settings</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Global defaults for automated sysUpTime verification
              </p>
            </div>
            <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 rounded-md">
              Active in Core Engine
            </span>
          </div>

          <form onSubmit={onSaveSNMP} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Default SNMP Community String (v2c)
              </label>
              <div className="relative">
                <input
                  type={showCommunity ? 'text' : 'password'}
                  value={snmpCommunity}
                  onChange={(e) => setSnmpCommunity(e.target.value)}
                  placeholder="e.g. public or custom-string"
                  className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCommunity(!showCommunity)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground text-xs"
                >
                  {showCommunity ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Used by Celery verification worker. Can be overridden per-device in Device Metadata.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Timeout (sec)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={snmpTimeout}
                  onChange={(e) => setSnmpTimeout(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Max Retries
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={snmpMaxRetries}
                  onChange={(e) => setSnmpMaxRetries(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Retry Delay (sec)
                </label>
                <input
                  type="number"
                  min="5"
                  max="300"
                  value={snmpRetryDelay}
                  onChange={(e) => setSnmpRetryDelay(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg text-sm font-medium transition-all shadow-sm"
              >
                {saving ? 'Saving changes...' : 'Save SNMP Configuration'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Live SNMP Diagnostic Tester */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Live SNMP Connectivity Tester</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Query sysUpTime (OID 1.3.6.1.2.1.1.3.0) directly
              </p>
            </div>
            <span className="px-2 py-0.5 text-xs font-semibold bg-primary/10 text-primary rounded">
              Diagnostic Tool
            </span>
          </div>

          <form onSubmit={onRunSNMPTest} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Target Device IP Address
              </label>
              <input
                type="text"
                value={testHost}
                onChange={(e) => setTestHost(e.target.value)}
                placeholder="e.g. 10.0.10.9"
                className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Custom Community (Optional)
                </label>
                <input
                  type="text"
                  value={testCommunity}
                  onChange={(e) => setTestCommunity(e.target.value)}
                  placeholder="Leave blank for Default"
                  className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Timeout (Seconds)
                </label>
                <input
                  type="number"
                  min="1"
                  max="15"
                  value={testTimeout}
                  onChange={(e) => setTestTimeout(Number(e.target.value))}
                  className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={testLoading}
                className="w-full py-2.5 px-4 bg-card hover:bg-muted border border-border disabled:opacity-50 text-primary rounded-lg text-sm font-semibold transition-all flex items-center justify-center space-x-2 shadow-sm"
              >
                {testLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                    <span>Sending SNMP Query...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>Execute SNMP Query Now</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Test Result Display */}
          {testResult && (
            <div
              className={`mt-4 p-4 rounded-lg border text-xs ${
                testResult.success
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
              }`}
            >
              <div className="flex items-center justify-between font-semibold mb-2">
                <span>Host: {testResult.host}</span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    testResult.success
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-rose-500/20 text-rose-400'
                  }`}
                >
                  {testResult.success ? 'SUCCESS (UPTIME RETRIEVED)' : 'QUERY FAILED'}
                </span>
              </div>
              {testResult.success ? (
                <div className="space-y-1 font-mono text-[11px]">
                  <div>
                    Uptime: <strong className="text-foreground">{testResult.router_uptime_seconds}s</strong>{' '}
                    ({Math.round((testResult.router_uptime_seconds || 0) / 60)} min)
                  </div>
                  <div>Raw TimeTicks: {testResult.raw_sysuptime}</div>
                  {testResult.why_reload && (
                    <div className="text-emerald-400 font-semibold">
                      whyReload OID:{' '}
                      <span className="font-mono bg-emerald-500/20 px-1.5 py-0.5 rounded">
                        "{testResult.why_reload}"
                      </span>
                    </div>
                  )}
                  <div>Community: {testResult.community_used}</div>
                </div>
              ) : (
                <div className="font-mono text-[11px] text-rose-400">
                  Error: {testResult.error_message || 'SNMP query timed out or community rejected'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
