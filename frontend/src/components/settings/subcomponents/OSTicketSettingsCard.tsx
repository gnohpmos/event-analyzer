import React from 'react';
import { Ticket, CheckCircle2, XCircle, ExternalLink, Save, Clock, ShieldCheck } from 'lucide-react';

interface OSTicketSettingsCardProps {
  osticketAutoCreate: boolean;
  setOsticketAutoCreate: (val: boolean) => void;
  osticketTopicId: string;
  setOsticketTopicId: (val: string) => void;
  osticketSlaId: string;
  setOsticketSlaId: (val: string) => void;
  osticketDelaySeconds: string;
  setOsticketDelaySeconds: (val: string) => void;
  osticketSenderName: string;
  setOsticketSenderName: (val: string) => void;
  osticketSenderEmail: string;
  setOsticketSenderEmail: (val: string) => void;
  saving: boolean;
  onSave: (e: React.FormEvent) => Promise<void>;
}

export const OSTicketSettingsCard: React.FC<OSTicketSettingsCardProps> = ({
  osticketAutoCreate,
  setOsticketAutoCreate,
  osticketTopicId,
  setOsticketTopicId,
  osticketSlaId,
  setOsticketSlaId,
  osticketDelaySeconds,
  setOsticketDelaySeconds,
  osticketSenderName,
  setOsticketSenderName,
  osticketSenderEmail,
  setOsticketSenderEmail,
  saving,
  onSave,
}) => {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-between md:col-span-2">
      <div>
        {/* Header */}
        <div className="pb-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/30">
                <Ticket className="w-5 h-5" />
              </span>
              <h3 className="text-lg font-semibold text-foreground">
                osTicket (MSTicket) Integration & Automated Creation
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              กำหนดค่าการเชื่อมต่อและเปิด/ปิดระบบสร้างตั๋ว Trouble Ticket บน osTicket อัตโนมัติ (MSTicket Gateway)
            </p>
          </div>

          <div className="flex items-center gap-2">
            {osticketAutoCreate ? (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 shadow-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>เปิดอัตโนมัติ: เปิดใช้งาน (Active)</span>
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border flex items-center gap-1.5">
                <XCircle className="w-4 h-4" />
                <span>เปิดอัตโนมัติ: ปิดใช้งาน (Manual Only)</span>
              </span>
            )}
          </div>
        </div>

        <form onSubmit={onSave} className="mt-5 space-y-5">
          {/* Main Toggle Switch Banner */}
          <div
            onClick={() => setOsticketAutoCreate(!osticketAutoCreate)}
            className={`cursor-pointer rounded-xl p-4 border transition-all flex items-center justify-between gap-4 ${
              osticketAutoCreate
                ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15'
                : 'bg-muted/40 border-border hover:bg-muted/60'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  เปิดการสร้างตั๋ว osTicket อัตโนมัติ (Automated osTicket Creation)
                </span>
                {osticketAutoCreate && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500 text-white">
                    ENABLED
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                เมื่อเปิดใช้งาน ระบบจะตรวจจับ Incident ที่ได้รับการยืนยันและมีหมายเลข NT TTS แล้ว เพื่อสร้างตั๋วบน osTicket
                พร้อมกระจายเลขตั๋วไปยังคู่ขนานของวงจร (Peer Circuit Auto-Propagation) โดยอัตโนมัติ
              </p>
            </div>

            {/* Toggle Switch */}
            <div className="relative inline-flex shrink-0">
              <button
                type="button"
                role="switch"
                aria-checked={osticketAutoCreate}
                onClick={(e) => {
                  e.stopPropagation();
                  setOsticketAutoCreate(!osticketAutoCreate);
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
                  osticketAutoCreate ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    osticketAutoCreate ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Configuration Inputs Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Help Topic ID (หัวข้อคำร้อง)
              </label>
              <input
                type="number"
                min="1"
                value={osticketTopicId}
                onChange={(e) => setOsticketTopicId(e.target.value)}
                className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                ค่าเริ่มต้น: <span className="font-mono text-primary font-semibold">27</span> (Help Topic: CATMA TTS)
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                SLA Plan ID (ระดับการให้บริการ)
              </label>
              <input
                type="number"
                min="1"
                value={osticketSlaId}
                onChange={(e) => setOsticketSlaId(e.target.value)}
                className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                ค่าเริ่มต้น: <span className="font-mono text-primary font-semibold">10</span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Auto-Create Delay (วินาที)</span>
              </label>
              <input
                type="number"
                min="0"
                max="86400"
                value={osticketDelaySeconds}
                onChange={(e) => setOsticketDelaySeconds(e.target.value)}
                className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                กำหนดเวลารอก่อนเปิดตั๋วอัตโนมัติ (ใส่ <span className="font-mono text-primary font-semibold">0</span> = เปิดทันที)
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Staff Sender Name (ชื่อผู้เปิดตั๋ว)
              </label>
              <input
                type="text"
                value={osticketSenderName}
                onChange={(e) => setOsticketSenderName(e.target.value)}
                className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                ชื่อเจ้าหน้าที่ผู้เปิดตั๋วผ่าน REST API
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1">
                Staff Sender Email (อีเมลผู้เปิดตั๋ว)
              </label>
              <input
                type="email"
                value={osticketSenderEmail}
                onChange={(e) => setOsticketSenderEmail(e.target.value)}
                className="w-full bg-muted/40 border border-border rounded-lg px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                อีเมลเจ้าหน้าที่สำหรับการรับ Notification ของ osTicket
              </p>
            </div>
          </div>

          {/* Reference Info Card */}
          <div className="bg-muted/30 border border-border rounded-lg p-3.5 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>ระบบความปลอดภัย 5 ชั้น (5-Layered Deduplication & Peer Propagation)</span>
              </div>
              <a
                href="https://msticket.catbb.net/osticket/scp/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline flex items-center gap-1 text-[11px]"
              >
                <span>เปิด Staff Portal</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              เมื่อระบบเปิดตั๋วสำเร็จ จะนำเลขตั๋วไปผูกเข้ากับ Incident คู่ขนานของวงจรเดียวกันทันทีโดยอัตโนมัติ
              พร้อมตรวจสอบค้นหาตั๋วเดิมที่เจ้าหน้าที่อาจเปิดไว้แล้วบน osTicket ก่อนยิงคำขอเสมอเพื่อป้องกันการเกิดตั๋วซ้ำซ้อน
            </p>
          </div>

          {/* Actions */}
          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า osTicket'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
