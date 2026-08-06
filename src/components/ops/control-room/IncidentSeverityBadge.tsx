import type { IncidentSeverity } from '@/models/control';

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  warning: 'Warning',
  bunched: 'Bunched',
  severe: 'Severe',
};

const SEVERITY_CLASS: Record<IncidentSeverity, string> = {
  warning: 'border-[#e8b34a]/40 bg-[#e8b34a]/10 text-[#e8c07a]',
  bunched: 'border-[#f0857d]/40 bg-[#f0857d]/10 text-[#f5a89f]',
  severe: 'border-[#f0857d]/70 bg-[#f0857d]/20 text-[#ffb3a8]',
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
