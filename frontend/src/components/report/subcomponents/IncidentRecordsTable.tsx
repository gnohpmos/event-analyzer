import React from 'react';
import { Search, ExternalLink } from 'lucide-react';
import { SerializedReportIncident } from '../../../types';
import { StatusBadge, ClassificationBadge } from '../../StatusBadge';
import { formatDuration, formatDateTime } from '../utils/reportFormatters';

interface IncidentRecordsTableProps {
  incidents: SerializedReportIncident[];
  totalCount: number;
  searchIncident: string;
  setSearchIncident: (term: string) => void;
  onSelectIncident?: (id: number) => void;
}

export const IncidentRecordsTable: React.FC<IncidentRecordsTableProps> = ({
  incidents,
  totalCount,
  searchIncident,
  setSearchIncident,
  onSelectIncident,
}) => {
  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      {/* Table Header with Search */}
      <div className="p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            รายการเหตุการณ์ทั้งหมดตามตัวกรอง (Incident Log)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            พบทั้งหมด {incidents.length} จาก {totalCount} เหตุการณ์ (คลิกแถวเพื่อดูไทม์ไลน์และการวิเคราะห์เชิงลึก)
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchIncident}
            onChange={(e) => setSearchIncident(e.target.value)}
            placeholder="ค้นหา Incident, IP, Hostname, Port..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50 border-b border-border text-muted-foreground uppercase tracking-wider font-semibold text-[11px]">
              <th className="py-3 px-4">Incident ID</th>
              <th className="py-3 px-3 text-center">ประเภท</th>
              <th className="py-3 px-4">อุปกรณ์ & Interface</th>
              <th className="py-3 px-3">ภูมิภาค / จังหวัด</th>
              <th className="py-3 px-3 text-center">สถานะ</th>
              <th className="py-3 px-3 text-center">Flap Count</th>
              <th className="py-3 px-3">ผลวิเคราะห์สาเหตุ (RCA)</th>
              <th className="py-3 px-3">เวลา Down</th>
              <th className="py-3 px-3">เวลา Recovery</th>
              <th className="py-3 px-4 text-right">ระยะเวลาขัดข้อง</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {incidents.length > 0 ? (
              incidents.map((inc: SerializedReportIncident) => (
                <tr
                  key={inc.id}
                  onClick={() => onSelectIncident && onSelectIncident(inc.id)}
                  className="hover:bg-muted/40 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-4 font-mono font-bold text-primary">
                    <div className="flex items-center gap-1.5">
                      <span>{inc.incident_number}</span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground opacity-60" />
                    </div>
                    {inc.ticket_id_tss && (
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          🎫 {inc.ticket_id_tss}
                        </span>
                        {inc.tts_status && (
                          <span className="px-1 py-0.2 rounded text-[9px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
                            {inc.tts_status === 'Work In Progress' ? 'WIP' : inc.tts_status}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold text-[10px] uppercase ${
                        inc.incident_type === 'LINK'
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/25'
                          : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/25'
                      }`}
                    >
                      {inc.incident_type || 'DEVICE'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-bold text-foreground">{inc.sys_name || inc.device_name}</div>
                    {inc.site_name && (
                      <div className="text-[10px] text-purple-400 font-medium">
                        Node: {inc.site_name}
                      </div>
                    )}
                    {inc.interface_name && (
                      <div
                        className="font-mono text-[11px] text-sky-400 font-medium truncate max-w-[240px]"
                        title={inc.interface_name}
                      >
                        พอร์ต: {inc.interface_name}
                      </div>
                    )}
                    {inc.circuit_id && (
                      <div className="font-mono text-[10px] text-emerald-400 font-medium truncate max-w-[240px]">
                        CKT: {inc.circuit_id}
                      </div>
                    )}
                    {inc.repair_team && (
                      <div className="text-[10px] text-muted-foreground/80 truncate max-w-[240px]" title={inc.repair_team}>
                        ช่าง: {inc.repair_team}
                      </div>
                    )}
                    {inc.link_description && (
                      <div
                        className="text-[10px] text-muted-foreground truncate max-w-[260px]"
                        title={inc.link_description}
                      >
                        {inc.link_description}
                      </div>
                    )}
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {inc.device_ip} &bull; {inc.hardware_model || '-'}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-medium text-foreground">
                      {inc.province} ({inc.province_code})
                    </div>
                    <div className="text-[11px] text-muted-foreground">{inc.region}</div>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <StatusBadge status={inc.status} />
                  </td>
                  <td className="py-3 px-3 text-center font-mono">
                    {(inc.flap_count ?? 0) > 0 ? (
                      <span className="px-2 py-0.5 rounded-full font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 text-xs">
                        {inc.flap_count} รอบ
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">-</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <ClassificationBadge
                      classification={inc.classification}
                      confidence={inc.confidence}
                    />
                    {inc.actual_cause && (
                      <div className="text-[10px] text-emerald-400/90 font-medium mt-1 truncate max-w-[200px]" title={`สาเหตุจาก TTS: ${inc.actual_cause}`}>
                        TTS: {inc.actual_cause}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-muted-foreground text-[11px]">
                    {formatDateTime(inc.down_time)}
                  </td>
                  <td className="py-3 px-3 text-muted-foreground text-[11px]">
                    {formatDateTime(inc.up_time)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-semibold text-foreground">
                    {formatDuration(inc.net_downtime_seconds ?? inc.downtime_seconds)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="py-8 text-center text-muted-foreground text-sm">
                  ไม่พบข้อมูลเหตุการณ์ที่ตรงกับคำค้นหา
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
