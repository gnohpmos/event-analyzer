import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Device } from '../types';

export const DevicesView: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedProvince, setSelectedProvince] = useState<string>('ALL');
  const [selectedStrategy, setSelectedStrategy] = useState<string>('ALL');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Syncing states
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [batchSyncing, setBatchSyncing] = useState(false);

  // Edit / Add Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [formName, setFormName] = useState('');
  const [formIp, setFormIp] = useState('');
  const [formType, setFormType] = useState('Router');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formSnmpCommunity, setFormSnmpCommunity] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    loadDevices();
  }, []);

  const loadDevices = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getDevices();
      setDevices(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch devices');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncDevice = async (id: number, name: string) => {
    try {
      setSyncingId(id);
      setActionError(null);
      const res = await api.syncDeviceSNMP(id);
      if (res.device) {
        setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, ...res.device } : d)));
      }
      const disc = res.discovery_result;
      const provStr = disc.province ? `[${disc.province_code}] ${disc.province}` : 'No province prefix';
      const modelStr = disc.hardware_model || 'Unknown model';
      setActionSuccess(`Synced "${name}": Model ${modelStr}, Location: ${provStr}, RCA: ${disc.rca_strategy}`);
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      setActionError(`Sync failed for ${name}: ${err.message}`);
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setSyncingId(null);
    }
  };

  const handleSyncAllDevices = async () => {
    try {
      setBatchSyncing(true);
      setActionError(null);
      const res = await api.syncAllDevicesSNMP();
      await loadDevices();
      setActionSuccess(`Batch SNMP discovery completed: ${res.success_count} / ${res.total_synced} devices enriched.`);
      setTimeout(() => setActionSuccess(null), 6000);
    } catch (err: any) {
      setActionError(`Batch sync failed: ${err.message}`);
      setTimeout(() => setActionError(null), 6000);
    } finally {
      setBatchSyncing(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingDevice(null);
    setFormName('');
    setFormIp('');
    setFormType('Router');
    setFormEnabled(true);
    setFormSnmpCommunity('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (device: Device) => {
    setEditingDevice(device);
    setFormName(device.name);
    setFormIp(device.management_ip);
    setFormType(device.device_type || 'Router');
    setFormEnabled(device.enabled);
    setFormSnmpCommunity(device.metadata?.snmp_community || '');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    setFormError(null);

    const metadataPayload = {
      ...(editingDevice?.metadata || {}),
    };
    if (formSnmpCommunity.trim()) {
      metadataPayload.snmp_community = formSnmpCommunity.trim();
    } else {
      delete metadataPayload.snmp_community;
    }

    const payload = {
      name: formName.trim(),
      management_ip: formIp.trim(),
      device_type: formType.trim(),
      enabled: formEnabled,
      metadata: metadataPayload,
    };

    try {
      if (editingDevice) {
        const updated = await api.updateDevice(editingDevice.id, payload);
        setDevices((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
        setActionSuccess(`Device "${payload.name}" updated successfully.`);
      } else {
        const created = await api.createDevice(payload);
        setDevices((prev) => [created, ...prev]);
        setActionSuccess(`Device "${payload.name}" added successfully.`);
        // Immediately trigger background discovery for the new device
        api.syncDeviceSNMP(created.id).then((res) => {
          if (res.device) {
            setDevices((prev) => prev.map((d) => (d.id === created.id ? { ...d, ...res.device } : d)));
          }
        }).catch(() => {});
      }
      setIsModalOpen(false);
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save device');
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteDevice = async (id: number, name: string) => {
    const confirmed = window.confirm(`Are you sure you want to delete device "${name}"? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      await api.deleteDevice(id);
      setDevices((prev) => prev.filter((d) => d.id !== id));
      setActionSuccess(`Device "${name}" deleted.`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      alert(`Error deleting device: ${err.message}`);
    }
  };

  // Distinct provinces for filter dropdown
  const uniqueProvinces = Array.from(
    new Set(devices.map((d) => d.province).filter((p): p is string => Boolean(p)))
  ).sort();

  const filtered = devices.filter((d) => {
    const s = search.toLowerCase();
    const matchSearch =
      d.name.toLowerCase().includes(s) ||
      d.management_ip.toLowerCase().includes(s) ||
      (d.device_type && d.device_type.toLowerCase().includes(s)) ||
      (d.sys_name && d.sys_name.toLowerCase().includes(s)) ||
      (d.province && d.province.toLowerCase().includes(s)) ||
      (d.province_code && d.province_code.toLowerCase().includes(s)) ||
      (d.hardware_model && d.hardware_model.toLowerCase().includes(s)) ||
      (d.serial_number && d.serial_number.toLowerCase().includes(s));

    const matchProvince = selectedProvince === 'ALL' || d.province === selectedProvince;
    const matchStrategy =
      selectedStrategy === 'ALL' ||
      (selectedStrategy === 'SSH' && d.rca_strategy === 'SSH_REBOOT_HISTORY') ||
      (selectedStrategy === 'SNMP' && d.rca_strategy === 'SNMP_WHY_RELOAD');

    return matchSearch && matchProvince && matchStrategy;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <span>Devices Inventory</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
              SNMP Enriched
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-discovered hardware models, serials, 77 Thailand provinces, and automated RCA strategy routing.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleSyncAllDevices}
            disabled={batchSyncing || devices.length === 0}
            className="px-3.5 py-2 bg-secondary hover:bg-secondary/80 disabled:opacity-50 text-foreground border border-border rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 shadow-sm"
            title="Scan and synchronize all devices via SNMP"
          >
            <svg
              className={`w-4 h-4 text-primary ${batchSyncing ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{batchSyncing ? 'Scanning All...' : 'Scan & Sync All SNMP'}</span>
          </button>

          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Add Device</span>
          </button>

          <button
            onClick={loadDevices}
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
        <div className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 px-4 py-2.5 rounded-lg text-xs font-medium flex items-center animate-in fade-in">
          <svg className="w-4 h-4 mr-2 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div className="bg-rose-500/10 border border-rose-500/25 text-rose-400 px-4 py-2.5 rounded-lg text-xs font-medium flex items-center animate-in fade-in">
          <svg className="w-4 h-4 mr-2 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{actionError}</span>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by device, IP, hostname, model, serial, or province..."
            className="w-full bg-background border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <svg
            className="w-4 h-4 absolute left-3 top-3 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <div className="flex gap-2">
          {/* Province Filter */}
          <select
            value={selectedProvince}
            onChange={(e) => setSelectedProvince(e.target.value)}
            className="bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="ALL">All Provinces (ทุกจังหวัด)</option>
            {uniqueProvinces.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* Strategy Filter */}
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="ALL">All RCA Strategies</option>
            <option value="SSH">IOS-XR (SSH reboot-history)</option>
            <option value="SNMP">IOS-XE / Classic (SNMP whyReload)</option>
          </select>
        </div>
      </div>

      {/* Devices List Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-20 text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-3"></div>
            <span>Loading devices...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-400">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-muted-foreground">
            <svg className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
            <p className="text-base font-medium text-foreground">No devices found</p>
            <p className="text-xs text-muted-foreground mt-1">Devices are auto-discovered on incoming webhook events or can be added manually</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-foreground">
              <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground border-b border-border font-semibold">
                <tr>
                  <th className="px-4 py-3.5">Hostname & Device</th>
                  <th className="px-4 py-3.5">Management IP</th>
                  <th className="px-4 py-3.5">จังหวัด (Province)</th>
                  <th className="px-4 py-3.5">Hardware Model, Serial & Version</th>
                  <th className="px-4 py-3.5">OS & RCA Strategy</th>
                  <th className="px-4 py-3.5 text-center">Status</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((device) => {
                  const isSyncing = syncingId === device.id;
                  const isXR = device.rca_strategy === 'SSH_REBOOT_HISTORY' || device.os_family === 'IOS-XR';

                  return (
                    <tr key={device.id} className="hover:bg-muted/40 transition-colors">
                      {/* Name & Hostname */}
                      <td className="px-4 py-3.5 font-medium text-foreground">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                              !device.enabled
                                ? 'bg-muted-foreground'
                                : device.active_incidents_count > 0
                                ? 'bg-rose-500 animate-pulse'
                                : 'bg-emerald-500'
                            }`}
                          />
                          <div>
                            <div className="font-semibold text-foreground text-xs sm:text-sm" title={device.name}>
                              {device.sys_name || device.name}
                            </div>
                            {device.sys_name && device.sys_name !== device.name && (
                              <div className="text-[11px] text-muted-foreground truncate max-w-xs" title={`Device Name: ${device.name}`}>
                                {device.name}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Management IP */}
                      <td className="px-4 py-3.5 font-mono text-xs text-primary font-medium">
                        {device.management_ip}
                      </td>

                      {/* Province */}
                      <td className="px-4 py-3.5 text-xs">
                        {device.province ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                            <span className="font-mono text-[10px] mr-1.5 px-1 py-0.2 rounded bg-emerald-500/20 font-bold">
                              {device.province_code}
                            </span>
                            <span>{device.province}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs italic">Unresolved</span>
                        )}
                      </td>

                      {/* Model & Serial & Version */}
                      <td className="px-4 py-3.5 text-xs">
                        <div>
                          {device.hardware_model ? (
                            <span className="inline-block px-2 py-0.5 rounded font-medium bg-sky-500/10 text-sky-400 border border-sky-500/25 font-mono text-[11px]">
                              {device.hardware_model}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs italic">Unknown</span>
                          )}
                          {(device.serial_number || device.os_version) && (
                            <div className="text-[10px] font-mono text-muted-foreground mt-0.5 flex items-center space-x-1.5 flex-wrap">
                              {device.serial_number && (
                                <span title="Serial Number">SN: {device.serial_number}</span>
                              )}
                              {device.serial_number && device.os_version && (
                                <span className="opacity-50 text-[8px]">•</span>
                              )}
                              {device.os_version && (
                                <span title="OS Version">Ver: {device.os_version}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* OS & RCA Strategy */}
                      <td className="px-4 py-3.5 text-xs">
                        <div className="space-y-1">
                          {isXR ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded font-medium bg-purple-500/10 text-purple-400 border border-purple-500/25 text-[11px]">
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mr-1.5"></span>
                              <span>
                                IOS-XR{device.os_version ? ` v${device.os_version}` : ''}
                                {device.os_version && !isNaN(parseInt(device.os_version.split('.')[0])) ? (parseInt(device.os_version.split('.')[0]) < 7 ? ' (32-bit)' : ' (64-bit)') : ''} (SSH)
                              </span>
                            </span>
                          ) : device.os_family === 'IOS-XE' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded font-medium bg-blue-500/10 text-blue-400 border border-blue-500/25 text-[11px]">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mr-1.5"></span>
                              <span>IOS-XE{device.os_version ? ` v${device.os_version}` : ''} (SNMP)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25 text-[11px]">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5"></span>
                              <span>{device.os_family || 'Classic IOS'}{device.os_version ? ` v${device.os_version}` : ''} (SNMP)</span>
                            </span>
                          )}
                          {device.last_snmp_synced_at && (
                            <div className="text-[10px] text-muted-foreground">
                              Synced {new Date(device.last_snmp_synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className={`px-2 py-0.5 text-xs font-semibold rounded ${
                            device.enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                              : 'bg-muted text-muted-foreground border border-border'
                          }`}
                        >
                          {device.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          onClick={() => handleSyncDevice(device.id, device.name)}
                          disabled={isSyncing}
                          className="px-2.5 py-1.5 bg-secondary hover:bg-secondary/80 disabled:opacity-50 text-foreground rounded text-xs font-medium border border-border transition-colors inline-flex items-center space-x-1"
                          title="Query SNMP ENTITY-MIB and sysName"
                        >
                          <svg
                            className={`w-3.5 h-3.5 text-primary ${isSyncing ? 'animate-spin' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                        </button>

                        <button
                          onClick={() => handleOpenEditModal(device)}
                          className="px-2.5 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded text-xs font-medium transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteDevice(device.id, device.name)}
                          className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded text-xs font-medium transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit / Add Device Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="text-lg font-bold text-foreground">
                {editingDevice ? `Edit Device: ${editingDevice.name}` : 'Add New Network Device'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSaveDevice} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs rounded-lg">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Device Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. ROUTER-LAB-01"
                  className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Management IP Address *
                </label>
                <input
                  type="text"
                  value={formIp}
                  onChange={(e) => setFormIp(e.target.value)}
                  placeholder="e.g. 10.0.10.9"
                  className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Target IP for SNMP ENTITY-MIB discovery, sysUpTime checks, and SSH diagnostic verification.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Device Type
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                    className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="Router">Router</option>
                    <option value="Core Switch">Core Switch</option>
                    <option value="Distribution Switch">Distribution Switch</option>
                    <option value="Access Switch">Access Switch</option>
                    <option value="Firewall">Firewall</option>
                    <option value="Server">Server</option>
                    <option value="Generic">Generic</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Monitoring Status
                  </label>
                  <select
                    value={formEnabled ? 'true' : 'false'}
                    onChange={(e) => setFormEnabled(e.target.value === 'true')}
                    className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="true">Enabled (Active)</option>
                    <option value="false">Disabled</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  SNMP Community Override (Optional)
                </label>
                <input
                  type="text"
                  value={formSnmpCommunity}
                  onChange={(e) => setFormSnmpCommunity(e.target.value)}
                  placeholder="Leave empty to use Global Default (.env / DB)"
                  className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  If set, this device will use this community string instead of the global default.
                </p>
              </div>

              <div className="pt-3 flex justify-end space-x-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold rounded-lg shadow-sm transition-all"
                >
                  {formSaving ? 'Saving...' : 'Save & Auto-Discover'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
