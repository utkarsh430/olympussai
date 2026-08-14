import Link from 'next/link';
import type { BunchingIncident } from '@/models/control';
import { OpsAlert, OpsEmptyState, OpsIdentifier } from '@/components/ops/ui';
import {
  causeClassLabel,
  controllabilityLabel,
  incidentRoleLabel,
  incidentStatusLabel,
} from '@/lib/ops/vocabulary';
import { IncidentSeverityBadge } from './IncidentSeverityBadge';

/**
 * Buses that have closed up on each other, right now, on one corridor.
 *
 * ─── THE EMPTY STATE IS THE INTERESTING PART ─────────────────────────────
 *
 * This panel used to say, whenever the list was empty:
 *
 *     "No active bunching incidents on this route-direction."
 *
 * On a corridor with a planned gap that is an all-clear and it is true. On one
 * WITHOUT a planned gap it is an all-clear about a corridor that is
 * structurally incapable of ever raising an incident — the detector does not
 * run there at all — and 561 of the network's 759 surveyed corridors are in
 * exactly that state. The sentence was reassurance drawn from an absence of
 * evidence, which is the one thing this product's honest-data vocabulary
 * exists to prevent. The depot console solved this properly months ago; the
 * control room's copy of the panel never got the same treatment.
 *
 * So the caller passes `canDetect` and the empty state branches on it. A
 * caller that genuinely does not know passes `undefined`, and the panel says
 * so rather than picking the friendlier of the two.
 *
 * ─── AND THE TAXONOMY ────────────────────────────────────────────────────
 *
 * `causeClass` and `controllability` used to render raw: "Cause: endogenous ·
 * Controllability: mitigable", in a mono face, to UPSRTC operations staff. Two
 * words of transit-research vocabulary, glossed nowhere in the product. They
 * now go through src/lib/ops/vocabulary.ts, which says what each one means in
 * a sentence. So does the member list: "leader" and "follower" are correct and
 * are also the two words most easily read backwards at speed, so the buses are
 * named "in front" and "behind".
 */
export function ActiveIncidentsPanel({
  incidents,
  canDetect,
}: {
  incidents: BunchingIncident[];
  /**
   * Whether this corridor can raise one of these at all.
   *
   * `true` — a planned gap is set and the check runs, so an empty list is a
   * real all-clear. `false` — no planned gap, so an empty list means the
   * question was never asked. `undefined` — the caller does not know, most
   * often because the control service does not report policy state, and the
   * panel must not guess.
   */
  canDetect?: boolean;
}) {
  if (incidents.length === 0) {
    if (canDetect === false) {
      return (
        <OpsAlert tone="info">
          No planned gap has been set for this corridor, so buses closing up cannot be checked here.
          This is not an all-clear — nothing has been looked at.
        </OpsAlert>
      );
    }
    if (canDetect === undefined) {
      return (
        <OpsEmptyState>
          Nothing reported on this corridor. This control service does not say whether it can check
          for buses closing up, so this is not confirmed as an all-clear.
        </OpsEmptyState>
      );
    }
    return <OpsEmptyState>No buses are closing up on this corridor right now.</OpsEmptyState>;
  }

  return (
    <ul className="space-y-3">
      {incidents.map((incident) => (
        <li
          key={incident.id}
          className="rounded-md border border-l-4 border-border border-l-destructive bg-destructive/[0.06] px-4 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IncidentSeverityBadge severity={incident.severity} />
              <span className="text-xs text-muted-foreground">
                {incidentStatusLabel(incident.status)}
              </span>
            </div>
            <span className="text-xs text-subtle">
              Started {new Date(incident.startedAt).toLocaleTimeString()}
            </span>
          </div>

          <p className="mt-2 text-sm text-foreground">
            {incident.members.length === 0 ? (
              'The buses involved were not recorded.'
            ) : (
              <>
                {incident.members.map((member, index) => (
                  <span key={member.vehicleId}>
                    {index > 0 ? ', ' : ''}
                    <OpsIdentifier>{member.vehicleId}</OpsIdentifier> (
                    {incidentRoleLabel(member.role)})
                  </span>
                ))}
              </>
            )}
          </p>

          <dl className="mt-2 space-y-0.5 text-xs leading-snug text-subtle">
            <div className="flex gap-1.5">
              <dt className="shrink-0">Cause:</dt>
              <dd>{causeClassLabel(incident.causeClass)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="shrink-0">What can be done:</dt>
              <dd>{controllabilityLabel(incident.controllability)}</dd>
            </div>
          </dl>

          <Link
            href={`/ops/control-room/incidents/${encodeURIComponent(incident.id)}`}
            className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
          >
            See what happened, step by step &rarr;
          </Link>
        </li>
      ))}
    </ul>
  );
}
