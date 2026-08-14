import type { IncidentSeverity } from '@/models/control';

import { INCIDENT_SEVERITY_LABEL } from '@/lib/ops/vocabulary';

/**
 * The three severities, named once in the shared vocabulary. "Warning" said
 * nothing about buses; "Closing up" says what is actually happening, and is
 * the same phrase the console band and the picker use.
 */
const SEVERITY_LABEL = INCIDENT_SEVERITY_LABEL;

const SEVERITY_CLASS: Record<IncidentSeverity, string> = {
  warning: 'border-warning/40 bg-warning/10 text-warning',
  bunched: 'border-destructive/40 bg-destructive/10 text-destructive',
  severe: 'border-destructive/70 bg-destructive/20 text-destructive',
};

/** Same badge shape as LiveBadge/FleetStatusTable's quality chip, so severity reads as part of the same visual language. */
export function IncidentSeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${SEVERITY_CLASS[severity]}`}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
