import { useState, useEffect } from 'react';
import { api } from '../../../services/api';
import { SystemSetting, SNMPTestResult, SSHTestResult } from '../../../types';

export const sampleDevicesJson = JSON.stringify([
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
    hostname: "Security-Firewall-01",
    management_ip: "10.0.1.1",
    device_type: "FIREWALL",
    snmp_community: "public",
    snmp_port: 161,
    is_active: true
  },
  {
    hostname: "PRTG-Monitor-Host",
    management_ip: "10.0.100.5",
    device_type: "SERVER",
    snmp_community: "public",
    snmp_port: 161,
    is_active: true
  }
], null, 2);

export const useSettings = () => {
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

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const res = await api.getSettings();
      setSettings(res.results);

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

  const triggerClearEvents = () => {
    setConfirmModal({
      open: true,
      title: 'Clear All Network Events & Logs',
      message: 'Are you sure you want to delete all historical Network Events and PRTG webhook payloads? Incident logs and system settings will NOT be deleted.',
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
            message: `Events Cleared: Successfully purged ${res.deleted_events} raw event records.`
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

  return {
    settings,
    loading,
    saving,
    saveSuccess,
    saveError,
    setSaveSuccess,
    setSaveError,
    // SNMP
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
    testHost,
    setTestHost,
    testCommunity,
    setTestCommunity,
    testTimeout,
    setTestTimeout,
    testLoading,
    testResult,
    handleSaveSNMP,
    handleRunSNMPTest,
    // SSH
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
    handleSaveSSH,
    handleRunSSHTest,
    // Thresholds
    rebootThreshold,
    setRebootThreshold,
    rebootTolerance,
    setRebootTolerance,
    handleSaveThresholds,
    // PRTG
    prtgEnabled,
    setPrtgEnabled,
    prtgToken,
    setPrtgToken,
    // Dev actions
    devLoadingAction,
    devFeedback,
    setDevFeedback,
    confirmModal,
    setConfirmModal,
    showImportModal,
    setShowImportModal,
    importJsonText,
    setImportJsonText,
    importLoading,
    importFeedback,
    triggerClearEvents,
    triggerClearIncidents,
    triggerClearTelemetry,
    triggerSeedSampleDevices,
    triggerExportDevices,
    handleImportSubmit,
    handleFileUpload,
  };
};
