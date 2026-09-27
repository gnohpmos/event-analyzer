import React from 'react';
import { Calendar } from 'lucide-react';
import { IncidentReportType } from '../hooks/useIncidentReport';

interface ReportFilterBarProps {
  preset: string;
  setPreset: (preset: string) => void;
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  selectedRegion: string;
  setSelectedRegion: (region: string) => void;
  selectedClassification: string;
  setSelectedClassification: (cls: string) => void;
  incidentType: IncidentReportType;
  onApplyCustomDates: (e: React.FormEvent) => void;
}

export const ReportFilterBar: React.FC<ReportFilterBarProps> = ({
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
  incidentType,
  onApplyCustomDates,
}) => {
  return (
    <div className="bg-card border border-border p-4 rounded-xl shadow-sm space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Preset Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            ช่วงเวลา:
          </span>

          {[
            { id: 'today', label: 'วันนี้ (Today)' },
            { id: 'yesterday', label: 'เมื่อวาน (Yesterday)' },
            { id: '7d', label: '7 วันล่าสุด' },
            { id: '30d', label: '30 วันล่าสุด' },
            { id: 'all', label: 'ทั้งหมด (All Time)' },
            { id: 'custom', label: 'กำหนดเอง (Custom)' },
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                preset === p.id
                  ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
                  : 'bg-muted/70 text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Region and Cause Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">ภาค:</span>
            <select
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">ทุกภาค (All Regions)</option>
              <option value="ภาคกลางและกรุงเทพฯ">ภาคกลางและกรุงเทพฯ</option>
              <option value="ภาคเหนือ">ภาคเหนือ</option>
              <option value="ภาคตะวันออกเฉียงเหนือ">ภาคตะวันออกเฉียงเหนือ</option>
              <option value="ภาคตะวันออก">ภาคตะวันออก</option>
              <option value="ภาคใต้">ภาคใต้</option>
              <option value="ภาคตะวันตก">ภาคตะวันตก</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">สาเหตุ:</span>
            <select
              value={selectedClassification}
              onChange={(e) => setSelectedClassification(e.target.value)}
              className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">ทุกสาเหตุ (All Causes)</option>
              {incidentType === 'link' ? (
                <>
                  <option value="LINK_FLAPPING">Link Flapping (พอร์ตกระพริบ)</option>
                  <option value="PHYSICAL_LINK_FAILURE">Physical Failure (สายขาด/พอร์ตดับ)</option>
                  <option value="PARENT_DEVICE_DOWN">Parent Device Down (เราเตอร์หลักดับ)</option>
                  <option value="ADMIN_SHUTDOWN">Admin Shutdown (ปิดพอร์ตโดยผู้ดูแล)</option>
                  <option value="CONNECTIVITY_RECOVERED">Recovered (กู้คืนปกติ)</option>
                </>
              ) : incidentType === 'device' ? (
                <>
                  <option value="DEVICE_REBOOT_RELATED">Device Reboot (ยืนยัน)</option>
                  <option value="DEVICE_REBOOT_SUSPECTED">Suspected Reboot (สงสัย)</option>
                  <option value="CONNECTIVITY_LOSS">Connectivity Loss (เครือข่าย)</option>
                  <option value="UNABLE_TO_VERIFY">Unable to Verify (ตรวจไม่สำเร็จ)</option>
                </>
              ) : (
                <>
                  <option value="LINK_FLAPPING">Link Flapping (พอร์ตกระพริบ)</option>
                  <option value="PHYSICAL_LINK_FAILURE">Physical Link Failure (สายขาด)</option>
                  <option value="DEVICE_REBOOT_RELATED">Device Reboot (ยืนยัน)</option>
                  <option value="DEVICE_REBOOT_SUSPECTED">Suspected Reboot (สงสัย)</option>
                  <option value="PARENT_DEVICE_DOWN">Parent Device Down (เราเตอร์หลักดับ)</option>
                  <option value="CONNECTIVITY_LOSS">Connectivity Loss (เครือข่าย)</option>
                  <option value="UNABLE_TO_VERIFY">Unable to Verify (ตรวจไม่สำเร็จ)</option>
                  <option value="ADMIN_SHUTDOWN">Admin Shutdown (ปิดพอร์ต)</option>
                </>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* Custom Date Range Selector */}
      {preset === 'custom' && (
        <form onSubmit={onApplyCustomDates} className="pt-2 border-t border-border flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">ตั้งแต่วันที่:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="bg-background border border-border rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">ถึงวันที่:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className="bg-background border border-border rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <button
            type="submit"
            className="px-3 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all shadow-sm"
          >
            นำไปใช้ (Apply)
          </button>
        </form>
      )}
    </div>
  );
};
