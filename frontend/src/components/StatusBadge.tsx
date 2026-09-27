import React from 'react';
import { 
  AlertTriangle, 
  RotateCw, 
  CheckCircle2, 
  AlertOctagon, 
  HelpCircle,
  Zap,
  WifiOff,
  Activity,
  Clock,
  Layers,
  PowerOff
} from 'lucide-react';
import { IncidentStatus, ClassificationType, ConfidenceType } from '../types';

interface StatusBadgeProps {
  status: IncidentStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  switch (status) {
    case 'DOWN':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
          <AlertTriangle className="w-3.5 h-3.5" />
          DOWN
        </span>
      );
    case 'FLAPPING':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/25">
          <Activity className="w-3.5 h-3.5 animate-pulse text-fuchsia-400" />
          FLAPPING
        </span>
      );
    case 'STABILIZING':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/25">
          <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
          STABILIZING (SOAK)
        </span>
      );
    case 'RECOVERY_CHECK':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/25">
          <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
          RECOVERY CHECK
        </span>
      );
    case 'RECOVERED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
          <CheckCircle2 className="w-3.5 h-3.5" />
          RECOVERED
        </span>
      );
    case 'VERIFICATION_FAILED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/25">
          <AlertOctagon className="w-3.5 h-3.5" />
          VERIF FAILED
        </span>
      );
    case 'MANUAL_REVIEW_REQUIRED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/25">
          <HelpCircle className="w-3.5 h-3.5" />
          MANUAL REVIEW
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground border border-border">
          {status}
        </span>
      );
  }
};

interface ClassificationBadgeProps {
  classification: ClassificationType | null;
  confidence?: ConfidenceType;
}

export const ClassificationBadge: React.FC<ClassificationBadgeProps> = ({ classification, confidence }) => {
  if (!classification) {
    return <span className="text-xs text-muted-foreground italic">— Pending —</span>;
  }

  const renderConfidence = () => {
    if (!confidence) return null;
    const color = 
      confidence === 'HIGH' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' :
      confidence === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400 border-amber-500/25' :
      'bg-muted text-muted-foreground border-border';
    return (
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${color}`}>
        {confidence}
      </span>
    );
  };

  switch (classification) {
    case 'DEVICE_REBOOT_RELATED':
      return (
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/25">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            Device Reboot
          </span>
          {renderConfidence()}
        </div>
      );
    case 'DEVICE_REBOOT_SUSPECTED':
      return (
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            Reboot Suspected
          </span>
          {renderConfidence()}
        </div>
      );
    case 'CONNECTIVITY_LOSS':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/25">
          <WifiOff className="w-3.5 h-3.5 text-blue-400" />
          Connectivity Loss
        </span>
      );
    case 'LINK_FLAPPING':
      return (
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/25">
            <Activity className="w-3.5 h-3.5 text-fuchsia-400" />
            Link Flapping
          </span>
          {renderConfidence()}
        </div>
      );
    case 'PARENT_DEVICE_DOWN':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/25">
          <Layers className="w-3.5 h-3.5 text-rose-400" />
          Parent Device Down
        </span>
      );
    case 'PHYSICAL_LINK_FAILURE':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-orange-500/10 text-orange-400 border border-orange-500/25">
          <WifiOff className="w-3.5 h-3.5 text-orange-400" />
          Physical Link Failure
        </span>
      );
    case 'ADMIN_SHUTDOWN':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/25">
          <PowerOff className="w-3.5 h-3.5 text-slate-400" />
          Admin Shutdown
        </span>
      );
    case 'CONNECTIVITY_RECOVERED':
      return (
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            Link Recovered
          </span>
          {renderConfidence()}
        </div>
      );
    case 'UNABLE_TO_VERIFY':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground border border-border">
          <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
          Unable to Verify
        </span>
      );
    default:
      return <span className="text-xs text-muted-foreground">{classification}</span>;
  }
};
