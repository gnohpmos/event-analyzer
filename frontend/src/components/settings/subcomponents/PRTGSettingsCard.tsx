import React from 'react';

interface PRTGSettingsCardProps {
  prtgToken: string;
}

export const PRTGSettingsCard: React.FC<PRTGSettingsCardProps> = ({ prtgToken }) => {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-between">
      <div>
        <div className="pb-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">PRTG Webhook Ingestion Reference</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Configuration details for incoming PRTG sensor notifications</p>
        </div>

        <div className="mt-5 space-y-3 text-xs">
          <div className="bg-muted/40 p-3 rounded-lg border border-border">
            <span className="text-muted-foreground block mb-1">PRTG Webhook Ingestion Endpoint:</span>
            <code className="text-primary font-mono text-[11px] block bg-card p-2 rounded border border-border select-all">
              http://&lt;HOST_IP&gt;:8089/api/v1/integrations/prtg/events/
            </code>
          </div>

          <div className="bg-muted/40 p-3 rounded-lg border border-border">
            <span className="text-muted-foreground block mb-1">Authentication Header:</span>
            <code className="text-emerald-400 font-mono text-[11px] block bg-card p-2 rounded border border-border select-all">
              Authorization: Bearer {prtgToken || 'prtg-secure-webhook-token-2026'}
            </code>
          </div>

          <div className="bg-muted/40 p-3 rounded-lg border border-border">
            <span className="text-muted-foreground block mb-1">PRTG Notification Template Body (POST):</span>
            <pre className="text-foreground font-mono text-[10px] bg-card p-2 rounded border border-border overflow-x-auto">
{`{
  "device": "%device",
  "ip": "%host",
  "sensor": "%sensor",
  "status": "%status",
  "down": "%down",
  "datetime": "%datetime",
  "message": "%message",
  "objid": "%objid"
}`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
