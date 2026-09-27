import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { SystemSetting, SNMPTestResult, SSHTestResult } from '../types';

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // SNMP Form states
  const [snmpCommunity, setSnmpCommunity] = useState('');
  const [showCommunity, setShowCommunity] = useState(false);
  const [snmpTimeout, setSnmpTimeout] = useState('5');
  const [snmpMaxRetries, setSnmpMaxRetries] = useState('3');
  const [snmpRetryDelay, setSnmpRetryDelay] = useState('30');

  // SSH Form states (Cisco IOS-XR)
  const [sshUsername, setSshUsername] = useState('admin');
  const [sshPassword, setSshPassword] = useState('');
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [sshPort, setSshPort] = useState('22');
  const [sshTimeout, setSshTimeout] = useState('5');
  const [savingSSH, setSavingSSH] = useState(false);

  // SSH Test form
  const [sshTestHost, setSshTestHost] = useState('10.0.10.1');
  const [sshTestUser, setSshTestUser] = useState('');
  const [sshTestPass, setSshTestPass] = useState('');
  const [sshTestPort, setSshTestPort] = useState(22);
  const [sshTestTimeout, setSshTestTimeout] = useState(5);
  const [sshTestLoading, setSshTestLoading] = useState(false);
  const [sshTestResult, setSshTestResult] = useState<SSHTestResult | null>(null);

  // Business thresholds
  const [rebootThreshold, setRebootThreshold] = useState('3600');
  const [rebootTolerance, setRebootTolerance] = useState('300');

  // PRTG
  const [prtgEnabled, setPrtgEnabled] = useState(true);
  const [prtgToken, setPrtgToken] = useState('');

  // SNMP Test form
  const [testHost, setTestHost] = useState('10.0.10.9');
  const [testCommunity, setTestCommunity] = useState('');
  const [testTimeout, setTestTimeout] = useState(3);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<SNMPTestResult | null>(null);

  // DEV Data Management States
  const [devLoadingAction, setDevLoadingAction] = useState<string | null>(null);
  const [devFeedback, setDevFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Confirmation Modal
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText: string;
    isDestructive: boolean;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // Device Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const sampleDevicesJson = JSON.stringify([
    {
      hostname: "Core-Router-01",
      management_ip: "10.0.10.1",
      device_type: "ROUTER",
      snmp_community: "public",
      snmp_port: 161,
      is_active: true
    },
    {
      hostname: "Edge-Gateway-02",
      management_ip: "10.0.10.9",
      device_type: "ROUTER",
      snmp_community: "public",
      snmp_port: 161,
      is_active: true
    },
    {
      hostname: "Dist-Switch-01",
      management_ip: "10.0.20.1",
      device_type: "SWITCH",
      snmp_community: "public",
      snmp_port: 161,
      is_active: true
    },
    {
      hostname: "Dist-Switch-02",
      management_ip: "10.0.20.2",
      device_type: "SWITCH",
      snmp_community: "public",
      snmp_port: 161,
      is_active: true
    },
    {
      hostname: "Sec-Firewall-01",
      management_ip: "10.0.30.1",
      device_type: "FIREWALL",
      snmp_community: "public",
      snmp_port: 161,
      is_active: true
    },
    {
      hostname: "PRTG-NMS-Server",
      management_ip: "10.0.50.10",
      device_type: "SERVER",
      snmp_community: "public",
      snmp_port: 161,
      is_active: true
    }
  ], null, 2);

  const triggerClearEvents = () => {
    setConfirmModal({
      open: true,
      title: 'Clear All Network Events & Logs',
      message: 'Are you sure you want to delete all Network Events and PRTG log entries from the database? This is useful during DEV testing to reset event counters.',
      confirmText: 'Clear Events',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        setDevLoadingAction('clear-events');
        setDevFeedback(null);
        try {
          const res = await api.clearEvents();
          setDevFeedback({
            type: 'success',
            message: `Events Cleared: Successfully removed ${res.deleted_events} events and ${res.deleted_links} linkages.`
          });
        } catch (err: any) {
          setDevFeedback({ type: 'error', message: err.message || 'Failed to clear events' });
        } finally {
          setDevLoadingAction(null);
        }
      }
    });
  };

  const triggerClearIncidents = () => {
    setConfirmModal({
      open: true,
      title: 'Clear All Incidents & RCA History',
      message: 'Are you sure you want to purge all Incident records, RCA verification details, and timeline logs? Device inventory and raw settings will be kept.',
      confirmText: 'Clear Incidents',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        setDevLoadingAction('clear-incidents');
        setDevFeedback(null);
        try {
          const res = await api.clearIncidents();
          setDevFeedback({
            type: 'success',
            message: `Incidents Cleared: Successfully purged ${res.deleted_incidents} incident records and their verifications.`
          });
        } catch (err: any) {
          setDevFeedback({ type: 'error', message: err.message || 'Failed to clear incidents' });
        } finally {
          setDevLoadingAction(null);
        }
      }
    });
  };

  const triggerClearTelemetry = () => {
    setConfirmModal({
      open: true,
      title: 'Reset All Telemetry (Events + Incidents)',
      message: 'This will completely wipe both Network Events AND Incidents simultaneously. This provides a clean slate for DEV testing. Device inventory will NOT be deleted.',
      confirmText: 'Reset Telemetry',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        setDevLoadingAction('clear-telemetry');
        setDevFeedback(null);
        try {
          const res = await api.clearTelemetry();
          setDevFeedback({
            type: 'success',
            message: `Full Telemetry Reset: Purged ${res.deleted_incidents} incidents and ${res.deleted_events} events.`
          });
        } catch (err: any) {
          setDevFeedback({ type: 'error', message: err.message || 'Failed to reset telemetry' });
        } finally {
          setDevLoadingAction(null);
        }
      }
    });
  };

  const triggerSeedSampleDevices = () => {
    setConfirmModal({
      open: true,
      title: 'Seed Standard Lab Devices',
      message: 'This will populate 6 standard network lab devices (Core-Router-01, Edge-Gateway-02 @ 10.0.10.9, Distribution Switches, Firewall, PRTG Server) with appropriate SNMP settings for verification testing.',
      confirmText: 'Seed Devices',
      isDestructive: false,
      onConfirm: async () => {
        setConfirmModal(null);
        setDevLoadingAction('seed-devices');
        setDevFeedback(null);
        try {
          const res = await api.seedSampleDevices();
          setDevFeedback({
            type: 'success',
            message: `Seeded ${res.total_sample_devices} lab devices successfully (Edge-Gateway-02 @ 10.0.10.9 ready for SNMP verification).`
          });
        } catch (err: any) {
          setDevFeedback({ type: 'error', message: err.message || 'Failed to seed sample devices' });
        } finally {
          setDevLoadingAction(null);
        }
      }
    });
  };

  const triggerExportDevices = async () => {
    setDevLoadingAction('export-devices');
    setDevFeedback(null);
    try {
      const data = await api.exportDevices();
      const jsonString = JSON.stringify(data.devices, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `devices_inventory_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDevFeedback({
        type: 'success',
        message: `Exported ${data.count} devices to JSON file.`
      });
    } catch (err: any) {
      setDevFeedback({ type: 'error', message: err.message || 'Failed to export devices' });
    } finally {
      setDevLoadingAction(null);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportLoading(true);
    setImportFeedback(null);

    try {
      let parsed: any;
      try {
        parsed = JSON.parse(importJsonText);
      } catch (parseErr: any) {
        throw new Error(`Invalid JSON syntax: ${parseErr.message}`);
      }

      const devicesList = Array.isArray(parsed) ? parsed : (parsed.devices || parsed.results);
      if (!Array.isArray(devicesList)) {
        throw new Error('JSON must be an array of device objects (e.g. [{"hostname": "Router1", "management_ip": "10.0.0.1"}])');
      }

      if (devicesList.length === 0) {
        throw new Error('Device array is empty. Please provide at least one device object.');
      }

      const res = await api.importDevices(devicesList);
      setImportFeedback({
        type: 'success',
        message: `Successfully imported: ${res.created} created, ${res.updated} updated.`
      });
      setDevFeedback({
        type: 'success',
        message: `Device Inventory Import Complete: ${res.created} created, ${res.updated} updated.`
      });
      setTimeout(() => {
        setShowImportModal(false);
        setImportFeedback(null);
      }, 1800);
    } catch (err: any) {
      setImportFeedback({ type: 'error', message: err.message || 'Failed to import devices' });
    } finally {
      setImportLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportJsonText(content);
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const res = await api.getSettings();
      setSettings(res.results);

      // Populate form values
      const map = new Map(res.results.map((s) => [s.key, s.value]));
      if (map.has('SNMP_COMMUNITY')) setSnmpCommunity(map.get('SNMP_COMMUNITY') || '');
      if (map.has('DEFAULT_SNMP_TIMEOUT')) setSnmpTimeout(map.get('DEFAULT_SNMP_TIMEOUT') || '5');
      if (map.has('SNMP_VERIFY_MAX_RETRIES')) setSnmpMaxRetries(map.get('SNMP_VERIFY_MAX_RETRIES') || '3');
      if (map.has('SNMP_VERIFY_RETRY_DELAY')) setSnmpRetryDelay(map.get('SNMP_VERIFY_RETRY_DELAY') || '30');
      if (map.has('ROUTER_REBOOT_THRESHOLD_SECONDS')) setRebootThreshold(map.get('ROUTER_REBOOT_THRESHOLD_SECONDS') || '3600');
      if (map.has('REBOOT_TIME_TOLERANCE_SECONDS')) setRebootTolerance(map.get('REBOOT_TIME_TOLERANCE_SECONDS') || '300');
      if (map.has('PRTG_ENABLED')) setPrtgEnabled(map.get('PRTG_ENABLED')?.toLowerCase() === 'true');
      if (map.has('PRTG_API_TOKEN')) setPrtgToken(map.get('PRTG_API_TOKEN') || '');
      if (map.has('SSH_USERNAME')) setSshUsername(map.get('SSH_USERNAME') || 'admin');
      if (map.has('SSH_PASSWORD')) setSshPassword(map.get('SSH_PASSWORD') || '');
      if (map.has('SSH_PORT')) setSshPort(map.get('SSH_PORT') || '22');
      if (map.has('SSH_TIMEOUT')) setSshTimeout(map.get('SSH_TIMEOUT') || '5');
    } catch (err: any) {
      setSaveError(err.message || 'Failed to load system settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSSH = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSSH(true);
    setSaveSuccess(null);
    setSaveError(null);

    try {
      await api.batchUpdateSettings({
        SSH_USERNAME: sshUsername,
        SSH_PASSWORD: sshPassword,
        SSH_PORT: sshPort,
        SSH_TIMEOUT: sshTimeout,
      });
      setSaveSuccess('Cisco IOS-XR SSH automation settings saved successfully!');
      setTimeout(() => setSaveSuccess(null), 4000);
      await loadSettings();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save SSH settings');
    } finally {
      setSavingSSH(false);
    }
  };

  const handleRunSSHTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSshTestLoading(true);
    setSshTestResult(null);

    try {
      const res = await api.testSSH({
        host: sshTestHost.trim(),
        username: sshTestUser.trim() || undefined,
        password: sshTestPass.trim() || undefined,
        port: Number(sshTestPort) || 22,
        timeout: Number(sshTestTimeout) || 5,
      });
      setSshTestResult(res);
    } catch (err: any) {
      setSshTestResult({
        success: false,
        host: sshTestHost,
        error_message: err.message || 'Failed to execute SSH test',
      });
    } finally {
      setSshTestLoading(false);
    }
  };

  const handleSaveSNMP = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(null);
    setSaveError(null);

    try {
      await api.batchUpdateSettings({
        SNMP_COMMUNITY: snmpCommunity,
        DEFAULT_SNMP_TIMEOUT: snmpTimeout,
        SNMP_VERIFY_MAX_RETRIES: snmpMaxRetries,
        SNMP_VERIFY_RETRY_DELAY: snmpRetryDelay,
      });
      setSaveSuccess('SNMP verification settings saved successfully!');
      setTimeout(() => setSaveSuccess(null), 4000);
      await loadSettings();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(null);
    setSaveError(null);

    try {
      await api.batchUpdateSettings({
        ROUTER_REBOOT_THRESHOLD_SECONDS: rebootThreshold,
        REBOOT_TIME_TOLERANCE_SECONDS: rebootTolerance,
      });
      setSaveSuccess('Business rule thresholds saved successfully!');
      setTimeout(() => setSaveSuccess(null), 4000);
      await loadSettings();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save thresholds');
    } finally {
      setSaving(false);
    }
  };

  const handleRunSNMPTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestLoading(true);
    setTestResult(null);

    try {
      const res = await api.testSNMPDirectly({
        host: testHost.trim(),
        community: testCommunity.trim() || undefined,
        timeout: testTimeout,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        host: testHost,
        community_used: testCommunity || '(default)',
        router_uptime_seconds: null,
        raw_sysuptime: null,
        snmp_version: 'v2c',
        error_message: err.message || 'Failed to execute direct SNMP query',
      });
    } finally {
      setTestLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"></div>
        <p className="text-sm">Loading System Configuration...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">System Settings & Administration</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure SNMP communities, verification timeouts, RCA decision thresholds, and monitor integration credentials.
        </p>
      </div>

      {/* Notifications */}
      {saveSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 px-4 py-3 rounded-lg flex items-center shadow-sm">
          <svg className="w-5 h-5 mr-2 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-medium">{saveSuccess}</span>
        </div>
      )}

      {saveError && (
        <div className="bg-rose-500/10 border border-rose-500/25 text-rose-400 px-4 py-3 rounded-lg flex items-center shadow-sm">
          <svg className="w-5 h-5 mr-2 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="text-sm font-medium">{saveError}</span>
        </div>
      )}

      {/* DEV Data & Telemetry Management Hub */}
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
          <div className={`p-3.5 rounded-lg border text-sm flex items-center justify-between ${
            devFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
          }`}>
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
            <button
              onClick={() => setDevFeedback(null)}
              className="text-xs hover:underline opacity-80"
            >
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
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
                  onClick={() => {
                    setShowImportModal(true);
                    setImportFeedback(null);
                    if (!importJsonText) setImportJsonText(sampleDevicesJson);
                  }}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* SNMP Configuration Form */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div>
                <h3 className="text-lg font-semibold text-foreground">SNMP Verification Settings</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Global defaults for automated sysUpTime verification</p>
              </div>
              <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 rounded-md">
                Active in Core Engine
              </span>
            </div>

            <form onSubmit={handleSaveSNMP} className="mt-5 space-y-4">
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
                <p className="text-xs text-muted-foreground mt-0.5">Query sysUpTime (OID 1.3.6.1.2.1.1.3.0) directly</p>
              </div>
              <span className="px-2 py-0.5 text-xs font-semibold bg-primary/10 text-primary rounded">
                Diagnostic Tool
              </span>
            </div>

            <form onSubmit={handleRunSNMPTest} className="mt-5 space-y-4">
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
              <div className={`mt-4 p-4 rounded-lg border text-xs ${
                testResult.success 
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' 
                  : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
              }`}>
                <div className="flex items-center justify-between font-semibold mb-2">
                  <span>Host: {testResult.host}</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    testResult.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                  }`}>
                    {testResult.success ? 'SUCCESS (UPTIME RETRIEVED)' : 'QUERY FAILED'}
                  </span>
                </div>
                {testResult.success ? (
                  <div className="space-y-1 font-mono text-[11px]">
                    <div>Uptime: <strong className="text-foreground">{testResult.router_uptime_seconds}s</strong> ({Math.round((testResult.router_uptime_seconds || 0) / 60)} min)</div>
                    <div>Raw TimeTicks: {testResult.raw_sysuptime}</div>
                    {testResult.why_reload && (
                      <div className="text-emerald-400 font-semibold">whyReload OID: <span className="font-mono bg-emerald-500/20 px-1.5 py-0.5 rounded">"{testResult.why_reload}"</span></div>
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

        {/* Business Rule Thresholds */}
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

        {/* PRTG Integration & System Reference */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="pb-4 border-b border-border">
              <h3 className="text-lg font-semibold text-foreground">PRTG Webhook Ingestion Reference</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Configuration details for incoming PRTG sensor notifications</p>
            </div>

            <div className="mt-5 space-y-3 text-xs">
              <div className="bg-muted/40 p-3 rounded-lg border border-border">
                <span className="text-muted-foreground block mb-1">PRTG Webhook Ingestion Endpoint:</span>
                <code className="text-primary font-mono text-[11px] block bg-card p-2 rounded border border-border select-all">
                  http://&lt;HOST_IP&gt;:8089/api/v1/integrations/prtg/events/
                </code>
              </div>

              <div className="bg-muted/40 p-3 rounded-lg border border-border">
                <span className="text-muted-foreground block mb-1">Authentication Header:</span>
                <code className="text-emerald-400 font-mono text-[11px] block bg-card p-2 rounded border border-border select-all">
                  Authorization: Bearer {prtgToken || 'prtg-secure-webhook-token-2026'}
                </code>
              </div>

              <div className="bg-muted/40 p-3 rounded-lg border border-border">
                <span className="text-muted-foreground block mb-1">PRTG Notification Template Body (POST):</span>
                <pre className="text-foreground font-mono text-[10px] bg-card p-2 rounded border border-border overflow-x-auto">
{`{
  "device": "%device",
  "ip": "%host",
  "sensor": "%sensor",
  "status": "%status",
  "down": "%down",
  "datetime": "%datetime",
  "message": "%message",
  "objid": "%objid"
}`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog Modal */}
      {confirmModal?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <div className={`p-2.5 rounded-full ${confirmModal.isDestructive ? 'bg-rose-500/10 text-rose-500' : 'bg-primary/10 text-primary'}`}>
                {confirmModal.isDestructive ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <h3 className="text-base font-bold text-foreground">{confirmModal.title}</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{confirmModal.message}</p>
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-3.5 py-2 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                  confirmModal.isDestructive
                    ? 'bg-rose-600 hover:bg-rose-700 text-white'
                    : 'bg-primary hover:bg-primary/90 text-primary-foreground'
                }`}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Import Devices Modal */}
      {showImportModal && (
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
                onClick={() => setShowImportModal(false)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {importFeedback && (
              <div className={`p-3 rounded-lg border text-xs flex items-center space-x-2 ${
                importFeedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
              }`}>
                <span>{importFeedback.message}</span>
              </div>
            )}

            <form onSubmit={handleImportSubmit} className="space-y-3 flex-1 flex flex-col min-h-0">
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
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <textarea
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                rows={12}
                placeholder="[&#10;  {&#10;    &quot;hostname&quot;: &quot;Router-01&quot;,&#10;    &quot;management_ip&quot;: &quot;10.0.10.1&quot;,&#10;    &quot;device_type&quot;: &quot;ROUTER&quot;,&#10;    &quot;snmp_community&quot;: &quot;public&quot;&#10;  }&#10;]"
                className="w-full flex-1 p-3 rounded-lg border border-border bg-muted/30 text-foreground font-mono text-xs focus:ring-1 focus:ring-primary focus:outline-none resize-none min-h-[220px]"
              />

              <div className="flex items-center justify-between pt-2 border-t border-border">
                <span className="text-[11px] text-muted-foreground">
                  Required fields: <code className="text-primary font-mono">management_ip</code> (or <code className="text-primary font-mono">ip</code>)
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setShowImportModal(false)}
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
      )}
    </div>
  );
};
