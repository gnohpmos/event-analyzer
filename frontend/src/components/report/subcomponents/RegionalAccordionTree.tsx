import React from 'react';
import {
  Layers,
  ChevronDown,
  ChevronRight,
  MapPin,
  Server,
  Network,
  Repeat,
  Zap,
  ZapOff,
  ShieldAlert,
  WifiOff,
  HelpCircle,
  AlertTriangle,
} from 'lucide-react';
import {
  RegionReport,
  ProvinceReport,
  ReportDeviceImpact,
  ReportInterfaceImpact,
} from '../../../types';
import { IncidentReportType } from '../hooks/useIncidentReport';
import { StatusBadge, ClassificationBadge } from '../../StatusBadge';
import { formatDuration } from '../utils/reportFormatters';

interface RegionalAccordionTreeProps {
  regions: RegionReport[];
  incidentType: IncidentReportType;
  expandedRegions: Record<string, boolean>;
  expandedProvinces: Record<string, boolean>;
  expandedDevices: Record<string, boolean>;
  toggleRegion: (regionName: string) => void;
  toggleProvince: (provKey: string) => void;
  toggleDevice: (devKey: string) => void;
  toggleAllRegions: (expand: boolean) => void;
  loading: boolean;
}

export const RegionalAccordionTree: React.FC<RegionalAccordionTreeProps> = ({
  regions,
  incidentType,
  expandedRegions,
  expandedProvinces,
  expandedDevices,
  toggleRegion,
  toggleProvince,
  toggleDevice,
  toggleAllRegions,
  loading,
}) => {
  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      {/* Table Header / Action */}
      <div className="p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {incidentType === 'link'
                ? 'จำนวนสายสัญญาณ/พอร์ตดับ แยกตามภาค จังหวัด เราเตอร์ และพอร์ต (Interface Drill-down)'
                : incidentType === 'device'
                ? 'จำนวนการ Down แยกตามสาเหตุตามภาคและเจาะลึกระดับจังหวัด (Device Drill-down)'
                : 'ภาพรวมการขัดข้องโครงข่ายเจาะลึกระดับภูมิภาค จังหวัด และอุปกรณ์ (Hierarchical Drill-down)'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              คลิกแถวเพื่อขยายดูรายละเอียดระดับจังหวัด เราเตอร์ และพอร์ตย่อย
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => toggleAllRegions(true)}
            className="text-primary hover:underline font-medium"
          >
            ขยายทั้งหมด (Expand All)
          </button>
          <span className="text-muted-foreground">&bull;</span>
          <button
            onClick={() => toggleAllRegions(false)}
            className="text-muted-foreground hover:text-foreground font-medium"
          >
            ยุบทั้งหมด (Collapse All)
          </button>
        </div>
      </div>

      {/* Breakdown Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50 border-b border-border text-muted-foreground uppercase tracking-wider font-semibold text-[11px]">
              <th className="py-3 px-4 w-80">
                {incidentType === 'link'
                  ? 'ภูมิภาค / จังหวัด / เราเตอร์ / พอร์ต'
                  : 'ภูมิภาค / จังหวัด / อุปกรณ์'}
              </th>
              <th className="py-3 px-3 text-center">Down รวม</th>
              {incidentType === 'link' && <th className="py-3 px-3 text-center">Flap สะสม</th>}
              <th className="py-3 px-3 text-center">สถานะ</th>

              {incidentType === 'link' ? (
                <>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-purple-400">
                      <Repeat className="w-3 h-3" /> Flapping
                    </span>
                  </th>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-rose-500">
                      <Zap className="w-3 h-3" /> สายขาด/ดับ
                    </span>
                  </th>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-amber-500">
                      <Server className="w-3 h-3" /> เราเตอร์ดับ
                    </span>
                  </th>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <ShieldAlert className="w-3 h-3" /> Admin Down
                    </span>
                  </th>
                </>
              ) : (
                <>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-amber-500">
                      <ZapOff className="w-3 h-3" /> ไฟฟ้าดับ
                    </span>
                  </th>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-rose-500">
                      <Zap className="w-3 h-3" /> Reboot ยืนยัน
                    </span>
                  </th>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-amber-500">
                      <Zap className="w-3 h-3" /> สงสัย Reboot
                    </span>
                  </th>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-sky-500">
                      <WifiOff className="w-3 h-3" /> เครือข่ายขัดข้อง
                    </span>
                  </th>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-purple-400">
                      <HelpCircle className="w-3 h-3" /> ตรวจไม่สำเร็จ
                    </span>
                  </th>
                </>
              )}

              <th className="py-3 px-3 text-center">
                <span className="inline-flex items-center gap-1 text-rose-400">
                  <AlertTriangle className="w-3 h-3" /> อยู่ระหว่าง Down
                </span>
              </th>
              <th className="py-3 px-4 text-right">เฉลี่ยเวลา Down</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {regions.length > 0 ? (
              regions.map((reg: RegionReport) => {
                const isRegExpanded = !!expandedRegions[reg.region];
                return (
                  <React.Fragment key={reg.region}>
                    {/* Region Parent Row */}
                    <tr
                      onClick={() => toggleRegion(reg.region)}
                      className={`hover:bg-muted/40 cursor-pointer font-medium transition-colors ${
                        isRegExpanded ? 'bg-muted/20' : ''
                      }`}
                    >
                      <td className="py-3 px-4 flex items-center gap-2">
                        <span className="text-muted-foreground p-0.5 rounded hover:bg-muted">
                          {isRegExpanded ? (
                            <ChevronDown className="w-4 h-4 text-primary" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </span>
                        <span className="text-foreground font-bold text-sm">{reg.region}</span>
                        <span className="text-[11px] text-muted-foreground ml-1">
                          ({reg.provinces.length} จังหวัด)
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
                          {reg.total_down}
                        </span>
                      </td>
                      {incidentType === 'link' && (
                        <td className="py-3 px-3 text-center">
                          {(reg.total_flap_count ?? 0) > 0 ? (
                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                              {reg.total_flap_count} รอบ
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </td>
                      )}
                      <td className="py-3 px-3 text-center text-xs">
                        <span className="text-emerald-500 font-medium">{reg.recovered_count} กู้คืน</span>
                        {reg.stabilizing_count ? (
                          <span className="text-cyan-400 font-bold ml-1.5">
                            / {reg.stabilizing_count} รอดู
                          </span>
                        ) : null}
                        {reg.ongoing_count > 0 && (
                          <span className="text-rose-500 font-bold ml-1.5">
                            / {reg.ongoing_count} Down
                          </span>
                        )}
                      </td>

                      {incidentType === 'link' ? (
                        <>
                          <td className="py-3 px-3 text-center font-mono">
                            {(reg.causes.link_flapping ?? 0) > 0 ? (
                              <span className="text-purple-400 font-bold px-1.5 py-0.5 rounded bg-purple-500/10">
                                {reg.causes.link_flapping}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            {(reg.causes.physical_link_failure ?? 0) > 0 ? (
                              <span className="text-rose-500 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                                {reg.causes.physical_link_failure}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            {(reg.causes.parent_device_down ?? 0) > 0 ? (
                              <span className="text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10">
                                {reg.causes.parent_device_down}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            {(reg.causes.admin_shutdown ?? 0) > 0 ? (
                              <span className="text-slate-400 font-bold px-1.5 py-0.5 rounded bg-slate-500/10">
                                {reg.causes.admin_shutdown}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">-</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-3 px-3 text-center font-mono">
                            {(reg.causes.power_outage_reboot ?? 0) > 0 ? (
                              <span className="text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10">
                                {reg.causes.power_outage_reboot}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            {(reg.causes.device_reboot_related ?? 0) > 0 ? (
                              <span className="text-rose-500 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                                {reg.causes.device_reboot_related}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            {(reg.causes.device_reboot_suspected ?? 0) > 0 ? (
                              <span className="text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10">
                                {reg.causes.device_reboot_suspected}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            {(reg.causes.connectivity_loss ?? 0) > 0 ? (
                              <span className="text-sky-500 font-bold px-1.5 py-0.5 rounded bg-sky-500/10">
                                {reg.causes.connectivity_loss}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            {(reg.causes.unable_to_verify ?? 0) > 0 ? (
                              <span className="text-purple-400 font-bold px-1.5 py-0.5 rounded bg-purple-500/10">
                                {reg.causes.unable_to_verify}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">-</span>
                            )}
                          </td>
                        </>
                      )}

                      <td className="py-3 px-3 text-center font-mono">
                        {(reg.causes.ongoing_down ?? 0) > 0 ? (
                          <span className="text-rose-400 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                            {reg.causes.ongoing_down}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-foreground">
                        {formatDuration(reg.avg_downtime_seconds)}
                      </td>
                    </tr>

                    {/* Province Child Rows */}
                    {isRegExpanded &&
                      reg.provinces.map((prov: ProvinceReport) => {
                        const provKey = `${reg.region}_${prov.province_code}`;
                        const isProvExpanded = !!expandedProvinces[provKey];
                        return (
                          <React.Fragment key={provKey}>
                            <tr
                              onClick={() => toggleProvince(provKey)}
                              className={`bg-muted/10 hover:bg-muted/30 cursor-pointer transition-colors border-b border-border/50 ${
                                isProvExpanded ? 'bg-muted/20' : ''
                              }`}
                            >
                              <td className="py-2.5 px-4 pl-8 flex items-center gap-2">
                                <span className="text-muted-foreground p-0.5 rounded hover:bg-muted">
                                  {isProvExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-primary" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  )}
                                </span>
                                <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="text-foreground font-semibold text-xs">
                                  {prov.province_name}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  ({prov.province_code})
                                </span>
                                <span className="text-[10px] text-muted-foreground ml-1">
                                  &bull; {prov.devices.length} อุปกรณ์
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-center font-bold text-foreground">
                                {prov.total_down}
                              </td>
                              {incidentType === 'link' && (
                                <td className="py-2.5 px-3 text-center font-mono">
                                  {(prov.total_flap_count ?? 0) > 0 ? (
                                    <span className="text-purple-400 font-bold">{prov.total_flap_count}</span>
                                  ) : (
                                    <span className="text-muted-foreground/50">-</span>
                                  )}
                                </td>
                              )}
                              <td className="py-2.5 px-3 text-center text-[11px]">
                                <span className="text-emerald-500 font-medium">{prov.recovered_count} คืน</span>
                                {prov.stabilizing_count ? (
                                  <span className="text-cyan-400 font-bold ml-1">
                                    / {prov.stabilizing_count} รอดู
                                  </span>
                                ) : null}
                                {prov.ongoing_count > 0 && (
                                  <span className="text-rose-500 font-bold ml-1">
                                    / {prov.ongoing_count} Down
                                  </span>
                                )}
                              </td>

                              {incidentType === 'link' ? (
                                <>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.link_flapping ?? 0) > 0 ? (
                                      <span className="text-purple-400 font-bold">{prov.causes.link_flapping}</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.physical_link_failure ?? 0) > 0 ? (
                                      <span className="text-rose-500 font-bold">{prov.causes.physical_link_failure}</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.parent_device_down ?? 0) > 0 ? (
                                      <span className="text-amber-500 font-bold">{prov.causes.parent_device_down}</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.admin_shutdown ?? 0) > 0 ? (
                                      <span className="text-slate-400 font-bold">{prov.causes.admin_shutdown}</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.power_outage_reboot ?? 0) > 0 ? (
                                      <span className="text-amber-500 font-bold">{prov.causes.power_outage_reboot}</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.device_reboot_related ?? 0) > 0 ? (
                                      <span className="text-rose-500 font-bold">{prov.causes.device_reboot_related}</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.device_reboot_suspected ?? 0) > 0 ? (
                                      <span className="text-amber-500 font-bold">{prov.causes.device_reboot_suspected}</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.connectivity_loss ?? 0) > 0 ? (
                                      <span className="text-sky-500 font-bold">{prov.causes.connectivity_loss}</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    {(prov.causes.unable_to_verify ?? 0) > 0 ? (
                                      <span className="text-purple-400 font-bold">{prov.causes.unable_to_verify}</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                  </td>
                                </>
                              )}

                              <td className="py-2.5 px-3 text-center font-mono">
                                {(prov.causes.ongoing_down ?? 0) > 0 ? (
                                  <span className="text-rose-400 font-bold">{prov.causes.ongoing_down}</span>
                                ) : (
                                  <span className="text-muted-foreground/40">-</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">
                                {formatDuration(prov.avg_downtime_seconds)}
                              </td>
                            </tr>

                            {/* Device & Interface Child Rows */}
                            {isProvExpanded &&
                              prov.devices.map((dev: ReportDeviceImpact) => {
                                const devKey = `${provKey}_${dev.device_id}`;
                                const isDevExpanded = !!expandedDevices[devKey];
                                const hasInterfaces = !!(dev.interfaces && dev.interfaces.length > 0);

                                return (
                                  <React.Fragment key={devKey}>
                                    <tr
                                      onClick={() => hasInterfaces && toggleDevice(devKey)}
                                      className={`bg-card/40 hover:bg-muted/30 transition-colors border-b border-border/30 text-xs ${
                                        hasInterfaces ? 'cursor-pointer' : ''
                                      }`}
                                    >
                                      <td className="py-2 px-4 pl-12">
                                        <div className="flex items-center gap-2">
                                          {hasInterfaces ? (
                                            <span className="text-muted-foreground p-0.5 rounded hover:bg-muted">
                                              {isDevExpanded ? (
                                                <ChevronDown className="w-3 h-3 text-primary" />
                                              ) : (
                                                <ChevronRight className="w-3 h-3" />
                                              )}
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground/60 text-xs select-none">↳</span>
                                          )}
                                          <Server className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />
                                          <div className="flex flex-col min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span
                                                className="font-semibold text-foreground text-xs truncate max-w-[220px]"
                                                title={dev.sys_name || dev.name}
                                              >
                                                {dev.sys_name || dev.name}
                                              </span>
                                              {dev.hardware_model && (
                                                <span className="text-[9px] px-1 py-0.2 rounded bg-muted/80 text-muted-foreground font-mono">
                                                  {dev.hardware_model}
                                                </span>
                                              )}
                                              {hasInterfaces && (
                                                <span className="text-[9px] px-1 py-0.2 rounded bg-primary/10 text-primary font-semibold">
                                                  {dev.interfaces?.length} พอร์ต
                                                </span>
                                              )}
                                            </div>
                                            <span className="font-mono text-[10px] text-muted-foreground">
                                              {dev.ip}
                                            </span>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 text-center font-semibold text-foreground">
                                        {dev.down_count}
                                      </td>
                                      {incidentType === 'link' && (
                                        <td className="py-2 px-3 text-center font-mono">
                                          {(dev.total_flap_count ?? 0) > 0 ? (
                                            <span className="text-purple-400 font-semibold">{dev.total_flap_count}</span>
                                          ) : (
                                            <span className="text-muted-foreground/40">-</span>
                                          )}
                                        </td>
                                      )}
                                      <td className="py-2 px-3 text-center text-[10px] text-muted-foreground">
                                        <span className="text-emerald-500 font-medium">
                                          {dev.recovered_count || 0} คืน
                                        </span>
                                        {dev.stabilizing_count ? (
                                          <span className="text-cyan-400 font-medium ml-1">
                                            / {dev.stabilizing_count} รอดู
                                          </span>
                                        ) : null}
                                        {(dev.ongoing_count || 0) > 0 && (
                                          <span className="text-rose-500 font-medium ml-1">
                                            / {dev.ongoing_count} Down
                                          </span>
                                        )}
                                      </td>

                                      {incidentType === 'link' ? (
                                        <>
                                          <td className="py-2 px-3 text-center font-mono">
                                            {dev.causes?.link_flapping ? (
                                              <span className="text-purple-400 font-bold px-1.5 py-0.5 rounded bg-purple-500/10">
                                                {dev.causes.link_flapping}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground/40">-</span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-center font-mono">
                                            {dev.causes?.physical_link_failure ? (
                                              <span className="text-rose-500 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                                                {dev.causes.physical_link_failure}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground/40">-</span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-center font-mono">
                                            {dev.causes?.parent_device_down ? (
                                              <span className="text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10">
                                                {dev.causes.parent_device_down}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground/40">-</span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-center font-mono">
                                            {dev.causes?.admin_shutdown ? (
                                              <span className="text-slate-400 font-bold px-1.5 py-0.5 rounded bg-slate-500/10">
                                                {dev.causes.admin_shutdown}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground/40">-</span>
                                            )}
                                          </td>
                                        </>
                                      ) : (
                                        <>
                                          <td className="py-2 px-3 text-center font-mono">
                                            {dev.causes?.power_outage_reboot ? (
                                              <span className="text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10">
                                                {dev.causes.power_outage_reboot}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground/40">-</span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-center font-mono">
                                            {dev.causes?.device_reboot_related ? (
                                              <span className="text-rose-500 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                                                {dev.causes.device_reboot_related}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground/40">-</span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-center font-mono">
                                            {dev.causes?.device_reboot_suspected ? (
                                              <span className="text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10">
                                                {dev.causes.device_reboot_suspected}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground/40">-</span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-center font-mono">
                                            {dev.causes?.connectivity_loss ? (
                                              <span className="text-sky-500 font-bold px-1.5 py-0.5 rounded bg-sky-500/10">
                                                {dev.causes.connectivity_loss}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground/40">-</span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-center font-mono">
                                            {dev.causes?.unable_to_verify ? (
                                              <span className="text-purple-400 font-bold px-1.5 py-0.5 rounded bg-purple-500/10">
                                                {dev.causes.unable_to_verify}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground/40">-</span>
                                            )}
                                          </td>
                                        </>
                                      )}

                                      <td className="py-2 px-3 text-center font-mono">
                                        {dev.causes?.ongoing_down ? (
                                          <span className="text-rose-400 font-bold px-1.5 py-0.5 rounded bg-rose-500/10">
                                            {dev.causes.ongoing_down}
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground/40">-</span>
                                        )}
                                      </td>
                                      <td className="py-2 px-4 text-right font-mono text-muted-foreground text-[11px]">
                                        {formatDuration(dev.avg_downtime_seconds)}
                                      </td>
                                    </tr>

                                    {/* Interface Drill-down Sub-rows */}
                                    {isDevExpanded &&
                                      dev.interfaces &&
                                      dev.interfaces.map((iface: ReportInterfaceImpact) => (
                                        <tr
                                          key={`${devKey}_${iface.interface_name}`}
                                          className="bg-primary/5 text-xs border-b border-border/20 hover:bg-primary/10 transition-colors"
                                        >
                                          <td className="py-2 px-4 pl-16">
                                            <div className="flex items-center gap-2">
                                              <span className="text-primary/70 select-none">↳</span>
                                              <Network className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                                              <span
                                                className="font-mono font-bold text-foreground text-xs truncate max-w-[280px]"
                                                title={iface.interface_name}
                                              >
                                                {iface.interface_name}
                                              </span>
                                            </div>
                                          </td>
                                          <td className="py-2 px-3 text-center font-mono font-bold text-primary">
                                            {iface.down_count}
                                          </td>
                                          {incidentType === 'link' && (
                                            <td className="py-2 px-3 text-center font-mono">
                                              {iface.flap_count > 0 ? (
                                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                                  {iface.flap_count} รอบ
                                                </span>
                                              ) : (
                                                <span className="text-muted-foreground/40">-</span>
                                              )}
                                            </td>
                                          )}
                                          <td className="py-2 px-3 text-center text-[10px]">
                                            <span className="text-emerald-500 font-medium">
                                              {iface.recovered_count} คืน
                                            </span>
                                            {iface.stabilizing_count > 0 && (
                                              <span className="text-cyan-400 font-medium ml-1">
                                                / {iface.stabilizing_count} รอดู
                                              </span>
                                            )}
                                            {iface.ongoing_count > 0 && (
                                              <span className="text-rose-500 font-medium ml-1">
                                                / {iface.ongoing_count} Down
                                              </span>
                                            )}
                                          </td>
                                          <td colSpan={4} className="py-2 px-3 text-xs">
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-[10px] text-muted-foreground">
                                                สถานะพอร์ต:
                                              </span>
                                              <StatusBadge status={iface.last_status as any} />
                                              {iface.last_classification && (
                                                <ClassificationBadge
                                                  classification={iface.last_classification as any}
                                                />
                                              )}
                                            </div>
                                          </td>
                                          <td className="py-2 px-3 text-center font-mono text-[10px] text-muted-foreground">
                                            -
                                          </td>
                                          <td className="py-2 px-4 text-right font-mono text-muted-foreground text-[11px]">
                                            {formatDuration(iface.avg_downtime_seconds)}
                                          </td>
                                        </tr>
                                      ))}
                                  </React.Fragment>
                                );
                              })}
                          </React.Fragment>
                        );
                      })}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={incidentType === 'link' ? 10 : 9}
                  className="py-8 text-center text-muted-foreground text-sm"
                >
                  {loading ? 'กำลังโหลดข้อมูล...' : 'ไม่พบข้อมูลการ Down ตามเงื่อนไขและช่วงเวลาที่เลือก'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
