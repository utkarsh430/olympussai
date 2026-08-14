import { OpsEmptyState, OpsSection } from '@/components/ops/ui';
import type { StandbyCandidate } from '@/lib/ops/fleetView';

/**
 * Which of this depot's vehicles currently READ as idle.
 *
 * A heuristic over the live feed — no active trip assignment, ignition not
 * confirmed off — and labelled as one. It is not a duty roster: this system
 * has no crew-duty or bay data at all, so nothing here knows whether a bus
 * that looks idle has a driver, is booked, or is in the shed with its wheels
 * off. The reason to keep it anyway is that it is the depot's own fleet and
 * the operator can verify any row by walking outside, which is exactly the
 * kind of claim a heuristic is allowed to make.
 *
 * Deliberately does NOT offer to inject any of these into service. Standby
 * injection is one of the instructions nothing in this system generates and
 * that changes no state — see DepotActionsPanel, which is rendered directly
 * below this on the same tab so the two facts arrive together.
 */
export function DepotStandbyPanel({
  standby,
  depotLabel,
}: {
  standby: StandbyCandidate[];
  depotLabel: string;
}) {
  return (
    <OpsSection
      title={`Reading as idle · ${depotLabel}`}
      description="Live-feed heuristic: no active trip assignment, and ignition not confirmed off. Not a duty roster — this system holds no crew or bay data to check against."
    >
      {standby.length === 0 ? (
        <OpsEmptyState>
          None of this depot&apos;s vehicles currently reads as idle. That is a reading of the live feed, not a
          statement that the yard is empty.
        </OpsEmptyState>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {standby.slice(0, 12).map(({ bus, idleMinutes }) => (
            <li key={bus.id} className="rounded-md border border-ops-line px-3 py-2 text-xs text-ops-muted">
              <span className="font-mono text-ops-ink">{bus.registrationNumber}</span>
              <span className="mx-1.5">·</span>
              {idleMinutes === null ? 'freshness unknown' : `updated ${idleMinutes}m ago`}
            </li>
          ))}
        </ul>
      )}
      {standby.length > 12 && (
        <p className="mt-2 text-[11px] text-ops-faint">
          Showing 12 of {standby.length}.
        </p>
      )}
    </OpsSection>
  );
}
