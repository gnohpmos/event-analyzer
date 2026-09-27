import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { IncidentReportData } from '../../../types';
import { IncidentReportType } from '../hooks/useIncidentReport';

interface RootCausesSectionProps {
  rootCauses: IncidentReportData['by_root_cause'];
  totalIncidents: number;
  incidentType: IncidentReportType;
}

export const RootCausesSection: React.FC<RootCausesSectionProps> = ({
  rootCauses,
  totalIncidents,
  incidentType,
}) => {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-primary" />
          <h3 className="text-base font-semibold text-foreground">
            {incidentType === 'link'
              ? 'สัดส่วนสาเหตุพอร์ตดับ (Link RCA Breakdown)'
              : 'สัดส่วนสาเหตุการ Down (Root Cause Breakdown)'}
          </h3>
        </div>
        <span className="text-xs text-muted-foreground">รวม {totalIncidents} เหตุการณ์</span>
      </div>

      {/* Stacked Proportional Bar */}
      <div className="w-full h-3.5 rounded-full overflow-hidden flex bg-muted">
        {rootCauses.map(
          (c) =>
            c.count > 0 && (
              <div
                key={c.key}
                style={{
                  width: `${c.percentage}%`,
                  backgroundColor: c.color,
                }}
                title={`${c.label}: ${c.count} ครั้ง (${c.percentage}%)`}
                className="h-full transition-all duration-300 first:rounded-l-full last:rounded-r-full"
              />
            )
        )}
      </div>

      {/* Cause Progress List */}
      <div className="space-y-3 pt-2">
        {rootCauses.map((cause) => (
          <div key={cause.key} className="space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: cause.color }}
                />
                <span className="text-foreground font-medium">{cause.label}</span>
              </div>
              <div className="flex items-center gap-2 font-mono">
                <span className="font-bold text-foreground">{cause.count} ครั้ง</span>
                <span className="text-muted-foreground">({cause.percentage}%)</span>
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${cause.percentage}%`,
                  backgroundColor: cause.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
