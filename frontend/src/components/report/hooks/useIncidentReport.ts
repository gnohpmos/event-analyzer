import { useState, useEffect, useMemo } from 'react';
import { api } from '../../../services/api';
import { IncidentReportData } from '../../../types';

export type IncidentReportType = 'link' | 'device' | 'all';

export const useIncidentReport = () => {
  const [reportData, setReportData] = useState<IncidentReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Mode state: 'link' | 'device' | 'all'
  const [incidentType, setIncidentType] = useState<IncidentReportType>('link');

  // Filter states
  const [preset, setPreset] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [selectedClassification, setSelectedClassification] = useState<string>('');

  // Tab state for Combined mode top ranking
  const [topRankTab, setTopRankTab] = useState<'links' | 'devices'>('links');

  // Expand states for drill-down
  const [expandedRegions, setExpandedRegions] = useState<Record<string, boolean>>({});
  const [expandedProvinces, setExpandedProvinces] = useState<Record<string, boolean>>({});
  const [expandedDevices, setExpandedDevices] = useState<Record<string, boolean>>({});

  // Table search for incidents tab
  const [searchIncident, setSearchIncident] = useState<string>('');

  // Load report data
  const loadReport = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getIncidentReport({
        preset,
        incident_type: incidentType,
        start_date: preset === 'custom' ? startDate : undefined,
        end_date: preset === 'custom' ? endDate : undefined,
        region: selectedRegion || undefined,
        classification: selectedClassification || undefined,
      });
      setReportData(data);

      // Auto expand regions that have incidents
      const initialExpanded: Record<string, boolean> = {};
      data.by_region.forEach((r) => {
        initialExpanded[r.region] = true;
      });
      setExpandedRegions(initialExpanded);
    } catch (err: any) {
      console.error('Failed to load report:', err);
      setError(err.message || 'ไม่สามารถโหลดข้อมูลรายงานได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [preset, incidentType, selectedRegion, selectedClassification]);

  // Handle custom date apply
  const handleApplyCustomDates = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      alert('กรุณาระบุทั้งวันเริ่มต้นและวันสิ้นสุด');
      return;
    }
    loadReport();
  };

  // Toggle region accordion
  const toggleRegion = (regionName: string) => {
    setExpandedRegions((prev) => ({
      ...prev,
      [regionName]: !prev[regionName],
    }));
  };

  // Toggle province accordion
  const toggleProvince = (provinceKey: string) => {
    setExpandedProvinces((prev) => ({
      ...prev,
      [provinceKey]: !prev[provinceKey],
    }));
  };

  // Toggle device accordion to show interfaces
  const toggleDevice = (devKey: string) => {
    setExpandedDevices((prev) => ({
      ...prev,
      [devKey]: !prev[devKey],
    }));
  };

  // Expand or collapse all regions and provinces
  const toggleAllRegions = (expand: boolean) => {
    if (!reportData) return;
    const newState: Record<string, boolean> = {};
    const newProvState: Record<string, boolean> = {};
    const newDevState: Record<string, boolean> = {};
    reportData.by_region.forEach((r) => {
      newState[r.region] = expand;
      r.provinces.forEach((p) => {
        const provKey = `${r.region}_${p.province_code}`;
        newProvState[provKey] = expand;
        p.devices.forEach((d) => {
          newDevState[`${provKey}_${d.device_id}`] = expand;
        });
      });
    });
    setExpandedRegions(newState);
    setExpandedProvinces(expand ? newProvState : {});
    setExpandedDevices(expand ? newDevState : {});
  };

  // Filtered regions based on selected region
  const displayRegions = useMemo(() => {
    if (!reportData?.by_region) return [];
    if (!selectedRegion) return reportData.by_region;
    return reportData.by_region.filter((r) => r.region === selectedRegion);
  }, [reportData, selectedRegion]);

  // Filtered incidents for table
  const filteredIncidents = useMemo(() => {
    if (!reportData) return [];
    let list = reportData.incidents;
    if (selectedRegion) {
      list = list.filter((inc) => inc.region === selectedRegion);
    }
    if (selectedClassification) {
      list = list.filter((inc) => inc.classification === selectedClassification);
    }
    if (!searchIncident.trim()) return list;
    const term = searchIncident.toLowerCase().trim();
    return list.filter((inc) => 
      inc.incident_number.toLowerCase().includes(term) ||
      inc.device_name.toLowerCase().includes(term) ||
      inc.sys_name.toLowerCase().includes(term) ||
      (inc.interface_name && inc.interface_name.toLowerCase().includes(term)) ||
      inc.device_ip.toLowerCase().includes(term) ||
      inc.province.toLowerCase().includes(term) ||
      inc.region.toLowerCase().includes(term)
    );
  }, [reportData, searchIncident, selectedRegion, selectedClassification]);

  return {
    reportData,
    loading,
    error,
    incidentType,
    setIncidentType,
    preset,
    setPreset,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    selectedRegion,
    setSelectedRegion,
    selectedClassification,
    setSelectedClassification,
    topRankTab,
    setTopRankTab,
    expandedRegions,
    expandedProvinces,
    expandedDevices,
    searchIncident,
    setSearchIncident,
    displayRegions,
    filteredIncidents,
    loadReport,
    handleApplyCustomDates,
    toggleRegion,
    toggleProvince,
    toggleDevice,
    toggleAllRegions,
  };
};
