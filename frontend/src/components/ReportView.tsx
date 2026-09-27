import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useIncidentReport } from './report/hooks/useIncidentReport';
import { exportReportToCSV } from './report/utils/reportFormatters';
import { ReportHeader } from './report/subcomponents/ReportHeader';
import { ReportFilterBar } from './report/subcomponents/ReportFilterBar';
import { ReportKPISummary } from './report/subcomponents/ReportKPISummary';
import { RegionalAccordionTree } from './report/subcomponents/RegionalAccordionTree';
import { RootCausesSection } from './report/subcomponents/RootCausesSection';
import { TopRankingsSection } from './report/subcomponents/TopRankingsSection';
import { IncidentRecordsTable } from './report/subcomponents/IncidentRecordsTable';

interface ReportViewProps {
  onSelectIncident?: (id: number) => void;
}

export const ReportView: React.FC<ReportViewProps> = ({ onSelectIncident }) => {
  const {
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
  } = useIncidentReport();

  return (
    <div className="space-y-6 pb-12">
      <ReportHeader
        incidentType={incidentType}
        setIncidentType={setIncidentType}
        onClearClassification={() => setSelectedClassification('')}
        loading={loading}
        onRefresh={loadReport}
        onExportCSV={() => reportData && exportReportToCSV(reportData, incidentType, preset)}
        canExport={!!reportData && reportData.incidents.length > 0}
      />

      <ReportFilterBar
        preset={preset}
        setPreset={setPreset}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        selectedRegion={selectedRegion}
        setSelectedRegion={setSelectedRegion}
        selectedClassification={selectedClassification}
        setSelectedClassification={setSelectedClassification}
        incidentType={incidentType}
        onApplyCustomDates={handleApplyCustomDates}
      />

      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {reportData && (
        <>
          <ReportKPISummary summary={reportData.summary} incidentType={incidentType} />

          <RegionalAccordionTree
            regions={displayRegions}
            incidentType={incidentType}
            expandedRegions={expandedRegions}
            expandedProvinces={expandedProvinces}
            expandedDevices={expandedDevices}
            toggleRegion={toggleRegion}
            toggleProvince={toggleProvince}
            toggleDevice={toggleDevice}
            toggleAllRegions={toggleAllRegions}
            loading={loading}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RootCausesSection
              rootCauses={reportData.by_root_cause}
              totalIncidents={reportData.summary.total_incidents}
              incidentType={incidentType}
            />

            <TopRankingsSection
              incidentType={incidentType}
              topRankTab={topRankTab}
              setTopRankTab={setTopRankTab}
              topUnstableLinks={reportData.top_unstable_links}
              topDevices={reportData.top_devices}
            />
          </div>

          <IncidentRecordsTable
            incidents={filteredIncidents}
            totalCount={reportData.incidents.length}
            searchIncident={searchIncident}
            setSearchIncident={setSearchIncident}
            onSelectIncident={onSelectIncident}
          />
        </>
      )}
    </div>
  );
};
