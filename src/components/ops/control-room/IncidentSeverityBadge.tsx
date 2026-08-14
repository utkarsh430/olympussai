import type { IncidentSeverity } from '@/models/control';

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  warning: 'Warning',
  bunched: 'Bunched',
  severe: 'Severe',
};

const SEVERITY_CLASS: Record<IncidentSeverity, string> = {
  warning: 'border-alert-amber/40 bg-alert-amber/10 text-ops-warn',
  bunched: 'border-alert-crimson/40 bg-alert-crimson/10 text-ops-danger',
  severe: 'border-alert-crimson/70 bg-alert-crimson/20 text-ops-danger',
};

/** Same badge shape as LiveBadge/FleetStatusTable's quality chip, so severity reads as part of the same visual language. */
export function IncidentSeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${SEVERITY_CLASS[severity]}`}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
