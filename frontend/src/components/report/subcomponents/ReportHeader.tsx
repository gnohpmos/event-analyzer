import React from 'react';
import { BarChart3, RefreshCw, Download, Printer, Network, Server } from 'lucide-react';
import { IncidentReportType } from '../hooks/useIncidentReport';

interface ReportHeaderProps {
  incidentType: IncidentReportType;
  setIncidentType: (type: IncidentReportType) => void;
  onClearClassification: () => void;
  loading: boolean;
  onRefresh: () => void;
  onExportCSV: () => void;
  canExport: boolean;
}

export const ReportHeader: React.FC<ReportHeaderProps> = ({
  incidentType,
  setIncidentType,
  onClearClassification,
  loading,
  onRefresh,
  onExportCSV,
  canExport,
}) => {
  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border border-border p-6 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                รายงานสถิติการขัดข้อง (Incident & Downtime Reports)
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                รายงานสรุปเหตุการณ์ขัดข้องของสายสัญญาณ (Link Incident) และเราเตอร์ แยกตามสาเหตุ (RCA) ตามภูมิภาค และเจาะลึกระดับพอร์ต
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border transition-all disabled:opacity-50"
            title="รีเฟรชข้อมูลล่าสุด"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </button>

          <button
            onClick={onExportCSV}
            disabled={!canExport}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-sm disabled:opacity-50"
            title="ดาวน์โหลดข้อมูลเป็นไฟล์ Excel / CSV พร้อมรองรับภาษาไทย"
          >
            <Download className="w-3.5 h-3.5" />
            ส่งออก CSV
          </button>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-card text-foreground hover:bg-muted border border-border transition-all"
            title="พิมพ์หน้ารายงาน หรือบันทึกเป็น PDF"
          >
            <Printer className="w-3.5 h-3.5 text-muted-foreground" />
            พิมพ์ / บันทึก PDF
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2 overflow-x-auto">
        <button
          onClick={() => {
            setIncidentType('link');
            onClearClassification();
          }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            incidentType === 'link'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60'
          }`}
        >
          <Network className="w-4 h-4" />
          <span>รายงานสายสัญญาณและพอร์ต (Link & Port Outages)</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              incidentType === 'link'
                ? 'bg-primary-foreground/20 text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            Link Engine
          </span>
        </button>

        <button
          onClick={() => {
            setIncidentType('device');
            onClearClassification();
          }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            incidentType === 'device'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>รายงานเราเตอร์และอุปกรณ์หลัก (Device Outages)</span>
        </button>

        <button
          onClick={() => {
            setIncidentType('all');
            onClearClassification();
          }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            incidentType === 'all'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>ภาพรวมการขัดข้องทั้งหมด (Combined Overview)</span>
        </button>
      </div>
    </div>
  );
};
