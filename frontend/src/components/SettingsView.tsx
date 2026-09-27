import React from 'react';
import { useSettings, sampleDevicesJson } from './settings/hooks/useSettings';
import { ConfirmModal } from './settings/subcomponents/ConfirmModal';
import { DeviceImportModal } from './settings/subcomponents/DeviceImportModal';
import { TelemetryManagementCard } from './settings/subcomponents/TelemetryManagementCard';
import { SNMPSettingsCard } from './settings/subcomponents/SNMPSettingsCard';
import { SSHSettingsCard } from './settings/subcomponents/SSHSettingsCard';
import { BusinessThresholdsCard } from './settings/subcomponents/BusinessThresholdsCard';
import { PRTGSettingsCard } from './settings/subcomponents/PRTGSettingsCard';

export const SettingsView: React.FC = () => {
  const settings = useSettings();

  if (settings.loading) {
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
      {settings.saveSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 px-4 py-3 rounded-lg flex items-center shadow-sm">
          <svg className="w-5 h-5 mr-2 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-medium">{settings.saveSuccess}</span>
        </div>
      )}

      {settings.saveError && (
        <div className="bg-rose-500/10 border border-rose-500/25 text-rose-400 px-4 py-3 rounded-lg flex items-center shadow-sm">
          <svg className="w-5 h-5 mr-2 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="text-sm font-medium">{settings.saveError}</span>
        </div>
      )}

      {/* DEV Data & Telemetry Management Hub */}
      <TelemetryManagementCard
        devLoadingAction={settings.devLoadingAction}
        devFeedback={settings.devFeedback}
        setDevFeedback={settings.setDevFeedback}
        triggerClearEvents={settings.triggerClearEvents}
        triggerClearIncidents={settings.triggerClearIncidents}
        triggerClearTelemetry={settings.triggerClearTelemetry}
        triggerSeedSampleDevices={settings.triggerSeedSampleDevices}
        triggerExportDevices={settings.triggerExportDevices}
        onOpenImportModal={() => {
          settings.setShowImportModal(true);
          if (!settings.importJsonText) {
            settings.setImportJsonText(sampleDevicesJson);
          }
        }}
      />

      {/* Primary Configuration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SNMPSettingsCard
          snmpCommunity={settings.snmpCommunity}
          setSnmpCommunity={settings.setSnmpCommunity}
          showCommunity={settings.showCommunity}
          setShowCommunity={settings.setShowCommunity}
          snmpTimeout={settings.snmpTimeout}
          setSnmpTimeout={settings.setSnmpTimeout}
          snmpMaxRetries={settings.snmpMaxRetries}
          setSnmpMaxRetries={settings.setSnmpMaxRetries}
          snmpRetryDelay={settings.snmpRetryDelay}
          setSnmpRetryDelay={settings.setSnmpRetryDelay}
          saving={settings.saving}
          onSaveSNMP={settings.handleSaveSNMP}
          testHost={settings.testHost}
          setTestHost={settings.setTestHost}
          testCommunity={settings.testCommunity}
          setTestCommunity={settings.setTestCommunity}
          testTimeout={settings.testTimeout}
          setTestTimeout={settings.setTestTimeout}
          testLoading={settings.testLoading}
          testResult={settings.testResult}
          onRunSNMPTest={settings.handleRunSNMPTest}
        />

        <SSHSettingsCard
          sshUsername={settings.sshUsername}
          setSshUsername={settings.setSshUsername}
          sshPassword={settings.sshPassword}
          setSshPassword={settings.setSshPassword}
          showSshPassword={settings.showSshPassword}
          setShowSshPassword={settings.setShowSshPassword}
          sshPort={settings.sshPort}
          setSshPort={settings.setSshPort}
          sshTimeout={settings.sshTimeout}
          setSshTimeout={settings.setSshTimeout}
          savingSSH={settings.savingSSH}
          handleSaveSSH={settings.handleSaveSSH}
          sshTestHost={settings.sshTestHost}
          setSshTestHost={settings.setSshTestHost}
          sshTestUser={settings.sshTestUser}
          setSshTestUser={settings.setSshTestUser}
          sshTestPass={settings.sshTestPass}
          setSshTestPass={settings.setSshTestPass}
          sshTestPort={settings.sshTestPort}
          setSshTestPort={settings.setSshTestPort}
          sshTestTimeout={settings.sshTestTimeout}
          setSshTestTimeout={settings.setSshTestTimeout}
          sshTestLoading={settings.sshTestLoading}
          sshTestResult={settings.sshTestResult}
          handleRunSSHTest={settings.handleRunSSHTest}
        />

        <BusinessThresholdsCard
          rebootThreshold={settings.rebootThreshold}
          setRebootThreshold={settings.setRebootThreshold}
          rebootTolerance={settings.rebootTolerance}
          setRebootTolerance={settings.setRebootTolerance}
          saving={settings.saving}
          handleSaveThresholds={settings.handleSaveThresholds}
        />

        <PRTGSettingsCard prtgToken={settings.prtgToken} />
      </div>

      {/* Confirmation Dialog Modal */}
      <ConfirmModal
        modal={settings.confirmModal}
        onClose={() => settings.setConfirmModal(null)}
      />

      {/* Batch Import Devices Modal */}
      <DeviceImportModal
        show={settings.showImportModal}
        onClose={() => settings.setShowImportModal(false)}
        importFeedback={settings.importFeedback}
        importJsonText={settings.importJsonText}
        setImportJsonText={settings.setImportJsonText}
        importLoading={settings.importLoading}
        onSubmit={settings.handleImportSubmit}
        onFileUpload={settings.handleFileUpload}
      />
    </div>
  );
};
export default SettingsView;
