import React from 'react';
import { SSHTestResult } from '../../../types';

interface SSHSettingsCardProps {
  sshUsername: string;
  setSshUsername: (val: string) => void;
  sshPassword: string;
  setSshPassword: (val: string) => void;
  showSshPassword: boolean;
  setShowSshPassword: (val: boolean) => void;
  sshPort: string;
  setSshPort: (val: string) => void;
  sshTimeout: string;
  setSshTimeout: (val: string) => void;
  savingSSH: boolean;
  handleSaveSSH: (e: React.FormEvent) => Promise<void>;
  sshTestHost: string;
  setSshTestHost: (val: string) => void;
  sshTestUser: string;
  setSshTestUser: (val: string) => void;
  sshTestPass: string;
  setSshTestPass: (val: string) => void;
  sshTestPort: number;
  setSshTestPort: (val: number) => void;
  sshTestTimeout: number;
  setSshTestTimeout: (val: number) => void;
  sshTestLoading: boolean;
  sshTestResult: SSHTestResult | null;
  handleRunSSHTest: (e: React.FormEvent) => Promise<void>;
}

export const SSHSettingsCard: React.FC<SSHSettingsCardProps> = ({
  sshUsername,
  setSshUsername,
  sshPassword,
  setSshPassword,
  showSshPassword,
  setShowSshPassword,
  sshPort,
  setSshPort,
  sshTimeout,
  setSshTimeout,
  savingSSH,
  handleSaveSSH,
  sshTestHost,
  setSshTestHost,
  sshTestUser,
  setSshTestUser,
  sshTestPass,
  setSshTestPass,
  sshTestPort,
  setSshTestPort,
  sshTestTimeout,
  setSshTestTimeout,
  sshTestLoading,
  sshTestResult,
  handleRunSSHTest,
}) => {
  return (
    <>
      {/* SSH Automation Settings (Cisco IOS-XR) */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div>
              <h3 className="text-lg font-semibold text-foreground">SSH Automation (Cisco IOS-XR)</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Automated 'show reboot-history' credentials for ASR 9000 & NCS series</p>
            </div>
            <span className="px-2.5 py-1 text-xs font-semibold bg-primary/10 text-primary border border-primary/25 rounded-md">
              IOS-XR Core Engine
            </span>
          </div>

          <form onSubmit={handleSaveSSH} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Default SSH Username
              </label>
              <input
                type="text"
                value={sshUsername}
                onChange={(e) => setSshUsername(e.target.value)}
                placeholder="e.g. admin"
                className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Default SSH Password
              </label>
              <div className="relative">
                <input
                  type={showSshPassword ? 'text' : 'password'}
                  value={sshPassword}
                  onChange={(e) => setSshPassword(e.target.value)}
                  placeholder="Enter SSH password for router automation"
                  className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSshPassword(!showSshPassword)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground text-xs"
                >
                  {showSshPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Used by Celery verification worker when an IOS-XR router reboot is detected.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  SSH Port
                </label>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={sshPort}
                  onChange={(e) => setSshPort(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Timeout (sec)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={sshTimeout}
                  onChange={(e) => setSshTimeout(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={savingSSH}
                className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg text-sm font-medium transition-all shadow-sm"
              >
                {savingSSH ? 'Saving SSH Settings...' : 'Save SSH Configuration'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Live SSH Diagnostic Tester */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Live SSH Reboot-History Tester</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Test SSH connection & retrieve 'show reboot-history' immediately</p>
            </div>
            <span className="px-2 py-0.5 text-xs font-semibold bg-primary/10 text-primary rounded">
              CLI Automation Tool
            </span>
          </div>

          <form onSubmit={handleRunSSHTest} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Target Router IP (IOS-XR e.g. 10.0.10.1, 10.0.10.2)
              </label>
              <input
                type="text"
                value={sshTestHost}
                onChange={(e) => setSshTestHost(e.target.value)}
                placeholder="e.g. 10.0.10.1"
                className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Override Username (Optional)
                </label>
                <input
                  type="text"
                  value={sshTestUser}
                  onChange={(e) => setSshTestUser(e.target.value)}
                  placeholder="Leave blank for Default"
                  className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Override Password (Optional)
                </label>
                <input
                  type="password"
                  value={sshTestPass}
                  onChange={(e) => setSshTestPass(e.target.value)}
                  placeholder="Leave blank for Default"
                  className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={sshTestLoading}
                className="w-full py-2.5 px-4 bg-card hover:bg-muted border border-border disabled:opacity-50 text-primary rounded-lg text-sm font-semibold transition-all flex items-center justify-center space-x-2 shadow-sm"
              >
                {sshTestLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                    <span>Connecting & Running 'show reboot-history'...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>Execute SSH Query Now</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* SSH Test Result Display */}
          {sshTestResult && (
            <div className={`mt-4 p-4 rounded-lg border text-xs ${
              sshTestResult.success 
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' 
                : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
            }`}>
              <div className="flex items-center justify-between font-semibold mb-2">
                <span>Host: {sshTestResult.host}</span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                  sshTestResult.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                }`}>
                  {sshTestResult.success ? 'SUCCESS (REBOOT REASON EXTRACTED)' : 'SSH FAILED'}
                </span>
              </div>
              {sshTestResult.success ? (
                <div className="space-y-1 font-mono text-[11px]">
                  <div>Parsed Reason: <strong className="text-foreground">{sshTestResult.parsed_reason}</strong></div>
                  <div>Category: <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">{sshTestResult.category}</span></div>
                  {sshTestResult.timestamp && <div>Timestamp: {sshTestResult.timestamp}</div>}
                  {sshTestResult.summary_line && <div>Raw Summary: {sshTestResult.summary_line}</div>}
                </div>
              ) : (
                <div className="font-mono text-[11px] text-rose-400">
                  Error: {sshTestResult.error_message || 'SSH connection or execution failed'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
