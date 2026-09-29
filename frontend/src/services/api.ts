import { 
  DashboardSummary, IncidentListItem, IncidentDetail, 
  Device, NetworkEvent, SystemSetting, SNMPTestResult, SSHTestResult,
  IncidentReportData
} from '../types';

export const api = {
  async getDashboardSummary(): Promise<DashboardSummary> {
    const res = await fetch('/api/v1/dashboard/summary/');
    if (!res.ok) throw new Error('Failed to fetch dashboard summary');
    return res.json();
  },

  async getIncidentReport(params?: {
    preset?: string;
    incident_type?: string;
    start_date?: string;
    end_date?: string;
    region?: string;
    province?: string;
    classification?: string;
  }): Promise<IncidentReportData> {
    const query = new URLSearchParams();
    if (params?.preset) query.set('preset', params.preset);
    if (params?.incident_type) query.set('incident_type', params.incident_type);
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    if (params?.region) query.set('region', params.region);
    if (params?.province) query.set('province', params.province);
    if (params?.classification) query.set('classification', params.classification);

    const url = `/api/v1/incidents/report/${query.toString() ? `?${query.toString()}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch incident report');
    return res.json();
  },

  async getIncidents(params?: {
    status?: string;
    incident_type?: string;
    classification?: string;
    search?: string;
    active?: boolean;
  }): Promise<IncidentListItem[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.incident_type) query.set('incident_type', params.incident_type);
    if (params?.classification) query.set('classification', params.classification);
    if (params?.search) query.set('search', params.search);
    if (params?.active !== undefined) query.set('active', String(params.active));

    const url = `/api/v1/incidents/${query.toString() ? `?${query.toString()}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch incidents');
    const data = await res.json();
    return Array.isArray(data) ? data : (data.results || []);
  },

  async getIncidentDetail(id: number): Promise<IncidentDetail> {
    const res = await fetch(`/api/v1/incidents/${id}/`);
    if (!res.ok) throw new Error(`Failed to fetch incident ${id}`);
    return res.json();
  },

  async updateIncident(id: number, data: Record<string, any>): Promise<IncidentDetail> {
    const res = await fetch(`/api/v1/incidents/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update incident ${id}`);
    return res.json();
  },

  async deleteIncident(id: number): Promise<void> {
    const res = await fetch(`/api/v1/incidents/${id}/`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete incident ${id}`);
  },

  async syncIncidentTicket(id: number): Promise<{
    status: string;
    ticket_id_tss?: string | null;
    circuit_id?: string | null;
    remote_device?: string | null;
    remote_interface?: string | null;
    site_name?: string | null;
    tts_status?: string | null;
    repair_team?: string | null;
    response_department?: string | null;
    actual_cause?: string | null;
    resolution?: string | null;
    source_gps?: string | null;
    dest_gps?: string | null;
    sync_result?: any;
    message?: string;
  }> {
    const res = await fetch(`/api/v1/incidents/${id}/sync-ticket/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Failed to sync ticket for incident ${id}`);
    return res.json();
  },

  async getDevices(): Promise<Device[]> {
    const res = await fetch('/api/v1/devices/');
    if (!res.ok) throw new Error('Failed to fetch devices');
    const data = await res.json();
    return Array.isArray(data) ? data : (data.results || []);
  },

  async updateDevice(id: number, data: Partial<Device>): Promise<Device> {
    const res = await fetch(`/api/v1/devices/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update device ${id}`);
    return res.json();
  },

  async deleteDevice(id: number): Promise<void> {
    const res = await fetch(`/api/v1/devices/${id}/`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete device ${id}`);
  },

  async createDevice(data: Partial<Device>): Promise<Device> {
    const res = await fetch('/api/v1/devices/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create device');
    return res.json();
  },

  async syncDeviceSNMP(id: number): Promise<{ status: string; discovery_result: any; device: Device }> {
    const res = await fetch(`/api/v1/devices/${id}/sync-snmp/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Failed to sync SNMP for device ${id}`);
    return res.json();
  },

  async syncAllDevicesSNMP(): Promise<{ status: string; total_synced: number; success_count: number; results: any[] }> {
    const res = await fetch('/api/v1/devices/sync-all-snmp/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error('Failed to run batch SNMP discovery');
    return res.json();
  },

  async getEvents(params?: { status?: string; type?: string; device?: number }): Promise<NetworkEvent[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.type) query.set('type', params.type);
    if (params?.device) query.set('device', String(params.device));

    const url = `/api/v1/events/${query.toString() ? `?${query.toString()}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch events');
    const data = await res.json();
    return Array.isArray(data) ? data : (data.results || []);
  },

  // Settings & Admin APIs
  async getSettings(): Promise<{ count: number; results: SystemSetting[] }> {
    const res = await fetch('/api/v1/settings/');
    if (!res.ok) throw new Error('Failed to fetch system settings');
    const data = await res.json();
    if (Array.isArray(data)) {
      return { count: data.length, results: data };
    }
    return {
      count: data.count || (data.results ? data.results.length : 0),
      results: data.results || []
    };
  },

  async batchUpdateSettings(settings: Record<string, string>): Promise<{ message: string; updated_keys: string[] }> {
    const res = await fetch('/api/v1/settings/batch/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    if (!res.ok) throw new Error('Failed to update system settings');
    return res.json();
  },

  async testSNMP(data: { host: string; community?: string; timeout?: number }): Promise<SNMPTestResult> {
    const res = await fetch('/api/v1/settings/test-snmp/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || err.message || `HTTP ${res.status}: Failed to execute SNMP test`);
    }
    return res.json();
  },

  async testSNMPDirectly(data: { host: string; community?: string; timeout?: number }): Promise<SNMPTestResult> {
    return this.testSNMP(data);
  },

  async testSSH(data: { host: string; username?: string; password?: string; port?: number; timeout?: number }): Promise<SSHTestResult> {
    const res = await fetch('/api/v1/settings/test-ssh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || err.message || `HTTP ${res.status}: Failed to execute SSH test`);
    }
    return res.json();
  },

  // DEV Data Management APIs
  async clearEvents(): Promise<{ status: string; message: string; deleted_events: number; deleted_links: number }> {
    const res = await fetch('/api/v1/settings/clear-events/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to clear events');
    return res.json();
  },

  async clearIncidents(): Promise<{ status: string; message: string; deleted_incidents: number }> {
    const res = await fetch('/api/v1/settings/clear-incidents/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to clear incidents');
    return res.json();
  },

  async clearTelemetry(): Promise<{ status: string; message: string; deleted_incidents: number; deleted_events: number }> {
    const res = await fetch('/api/v1/settings/clear-telemetry/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to reset telemetry data');
    return res.json();
  },

  async importDevices(devices: any[]): Promise<{ status: string; message: string; created: number; updated: number; errors: string[] }> {
    const res = await fetch('/api/v1/settings/import-devices/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devices }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to import devices');
    }
    return res.json();
  },

  async seedSampleDevices(): Promise<{ status: string; message: string; total_sample_devices: number }> {
    const res = await fetch('/api/v1/settings/seed-sample-devices/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to seed sample devices');
    return res.json();
  },

  async exportDevices(): Promise<{ count: number; devices: any[] }> {
    const res = await fetch('/api/v1/settings/export-devices/');
    if (!res.ok) throw new Error('Failed to export devices');
    return res.json();
  }
};

