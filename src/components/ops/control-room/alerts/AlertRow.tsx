import type { BunchingAlert } from '@/models/control';
import { OpsIdentifier } from '@/components/ops/ui';
import { incidentSeverityMeaning } from '@/lib/ops/vocabulary';
import { IncidentSeverityBadge } from '../IncidentSeverityBadge';

/**
 * How long until this pair is forecast to bunch, in words.
 *
 * Null is NOT rendered as "0" or as "safe". On a predicted alert it means the
 * forecaster has stopped having an opinion - the corridor's samples went too
 * sparse or too noisy to fit a trend - and that is the absence of evidence,
 * not evidence of recovery. The two are opposite in meaning and would be
 * indistinguishable if this returned a number.
 */
export function countdownLabel(secondsToBunching: number | null, severity: string): string | null {
  if (severity !== 'predicted') return null;
  if (secondsToBunching === null) return 'No current countdown';
  const minutes = Math.round(secondsToBunching / 60);
  if (minutes < 1) return 'Bunching now';
  return `~${minutes} min to bunching`;
}

/** The two buses, named the way an operator says them rather than by role. */
export function memberSummary(members: BunchingAlert['members']): {
  front: string | null;
  behind: string | null;
} {
  const front = members.find((m) => m.role === 'leader')?.vehicleId ?? null;
  const behind = members.find((m) => m.role === 'follower')?.vehicleId ?? null;
  return { front, behind };
}

/**
 * One alert, as a row in the network-wide inbox.
 *
 * ─── WHAT THIS ROW HAS TO EARN ───────────────────────────────────────────
 *
 * An operator scans this list top-down and stops partway, so every row is
 * competing for a decision that costs them a corridor's worth of attention.
 * It therefore leads with the three things that decide whether to open it -
 * how bad, which route, and how soon - and nothing else.
 *
 * The predicted rung needs one extra thing the others do not: a REASON. A row
 * claiming a bunch is coming, about two buses whose gap is demonstrably still
 * fine, reads as a malfunction unless the sentence explaining it sits beside
 * it. That is what `incidentSeverityMeaning` supplies here, and it is why the
 * meaning is rendered inline for `predicted` and not for the measured rungs,
 * which need no defence.
 */
export function AlertRow({
  alert,
  selected,
  onSelect,
}: {
  alert: BunchingAlert;
  selected: boolean;
  onSelect: (alertId: string) => void;
}) {
  const { front, behind } = memberSummary(alert.members);
  const countdown = countdownLabel(alert.secondsToBunching, alert.severity);
  const meaning = alert.severity === 'predicted' ? incidentSeverityMeaning(alert.severity) : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(alert.id)}
        aria-current={selected ? 'true' : undefined}
        className={`ops-well w-full px-4 py-3 text-left transition-colors ${
          selected ? 'ring-2 ring-primary/50' : 'hover:bg-muted/50'
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <IncidentSeverityBadge severity={alert.severity} />
          <span className="text-sm font-medium">
            {alert.routePublicName}
            <span className="text-muted-foreground">
              {' '}
              · {alert.directionName ?? alert.directionCode}
            </span>
          </span>
          {countdown ? (
            <span className="ml-auto text-xs font-medium tabular-nums text-primary">{countdown}</span>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {front ? (
            <>
              <span>In front</span>
              <OpsIdentifier>{front}</OpsIdentifier>
            </>
          ) : null}
          {behind ? (
            <>
              <span>· Behind</span>
              <OpsIdentifier>{behind}</OpsIdentifier>
            </>
          ) : null}
        </div>

        {meaning ? <p className="mt-1.5 text-xs text-muted-foreground">{meaning}</p> : null}
      </button>
    </li>
  );
}
