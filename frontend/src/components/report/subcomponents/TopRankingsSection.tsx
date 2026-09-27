import React from 'react';
import { Activity, Server } from 'lucide-react';
import { ReportTopUnstableLink, ReportDeviceImpact } from '../../../types';
import { IncidentReportType } from '../hooks/useIncidentReport';
import { StatusBadge } from '../../StatusBadge';
import { formatDuration } from '../utils/reportFormatters';

interface TopRankingsSectionProps {
  incidentType: IncidentReportType;
  topRankTab: 'links' | 'devices';
  setTopRankTab: (tab: 'links' | 'devices') => void;
  topUnstableLinks?: ReportTopUnstableLink[];
  topDevices?: ReportDeviceImpact[];
}

export const TopRankingsSection: React.FC<TopRankingsSectionProps> = ({
  incidentType,
  topRankTab,
  setTopRankTab,
  topUnstableLinks = [],
  topDevices = [],
}) => {
  const showLinks = incidentType === 'link' || (incidentType === 'all' && topRankTab === 'links');

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {incidentType === 'link' ? (
            <Activity className="w-5 h-5 text-purple-400" />
          ) : (
            <Server className="w-5 h-5 text-rose-500" />
          )}
          <h3 className="text-base font-semibold text-foreground">
            {incidentType === 'link'
              ? 'พอร์ต/วงจรที่ไม่เสถียรที่สุด (Top Unstable Links)'
              : incidentType === 'device'
              ? 'อุปกรณ์ที่ Down บ่อยที่สุด (Top Impacted Devices)'
              : 'อันดับเหตุการณ์ขัดข้องสูงสุด (Top Impacted)'}
          </h3>
        </div>

        {incidentType === 'all' && (
          <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg text-xs">
            <button
              onClick={() => setTopRankTab('links')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                topRankTab === 'links'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Links
            </button>
            <button
              onClick={() => setTopRankTab('devices')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                topRankTab === 'devices'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Devices
            </button>
          </div>
        )}
      </div>

      {showLinks ? (
        topUnstableLinks.length > 0 ? (
          <div className="divide-y divide-border overflow-hidden">
            {topUnstableLinks.map((link: ReportTopUnstableLink, idx: number) => (
              <div
                key={`${link.device_id}_${link.interface_name}`}
                className="py-2.5 flex items-center justify-between text-xs gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center font-mono font-bold text-[11px] text-muted-foreground flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div className="truncate">
                    <div className="font-bold text-foreground truncate flex items-center gap-1.5">
                      <span className="truncate">{link.interface_name}</span>
                      {link.status && <StatusBadge status={link.status as any} />}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground flex items-center gap-2">
                      <span>{link.sys_name}</span>
                      <span>&bull;</span>
                      <span>{link.management_ip}</span>
                      <span>&bull;</span>
                      <span>{link.province}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1.5 justify-end">
                    {link.total_flap_count > 0 && (
                      <span className="px-2 py-0.5 rounded-full font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 text-xs">
                        Flap {link.total_flap_count} รอบ
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20 text-xs">
                      {link.down_count} ครั้ง
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    Net Down: {formatDuration(link.total_net_downtime_seconds)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground text-xs">
            ไม่มีสายสัญญาณหรือพอร์ตที่มีสถิติขัดข้องในช่วงเวลานี้
          </div>
        )
      ) : topDevices.length > 0 ? (
        <div className="divide-y divide-border overflow-hidden">
          {topDevices.map((dev, idx) => (
            <div key={dev.device_id} className="py-2.5 flex items-center justify-between text-xs gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center font-mono font-bold text-[11px] text-muted-foreground flex-shrink-0">
                  {idx + 1}
                </span>
                <div className="truncate">
                  <div className="font-bold text-foreground truncate">
                    {dev.sys_name || dev.name}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground flex items-center gap-2">
                    <span>{dev.ip}</span>
                    <span>&bull;</span>
                    <span className="truncate">{dev.hardware_model || '-'}</span>
                  </div>
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <span className="px-2 py-0.5 rounded-full font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20 text-xs">
                  {dev.down_count} ครั้ง
                </span>
                <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  Down รวม {formatDuration(dev.total_downtime_seconds)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-8 text-center text-muted-foreground text-xs">
          ไม่มีอุปกรณ์ที่มีสถิติ Down ในช่วงเวลานี้
        </div>
      )}
    </div>
  );
};
