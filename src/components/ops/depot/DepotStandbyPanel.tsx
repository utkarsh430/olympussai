import { OpsEmptyState, OpsIdentifier, OpsSection } from '@/components/ops/ui';
import type { StandbyCandidate } from '@/lib/ops/fleetView';

/**
 * Which of this depot's buses currently READ as free.
 *
 * Worked out from the live feed — no trip assigned, and the engine not
 * confirmed off — and labelled as exactly that. It is not the duty roster:
 * this system holds no crew or bay records at all, so nothing here knows
 * whether a bus that looks free has a driver, is booked, or is in the shed with
 * its wheels off. The reason to keep it anyway is that it is the depot's own
 * fleet and the operator can check any row by walking outside, which is exactly
 * the kind of claim a worked-out guess is allowed to make.
 *
 * Deliberately does NOT offer to put any of these into service. Doing that is
 * one of the instructions nothing in this system works out and that changes no
 * state — see DepotActionsPanel, which is rendered directly below this on the
 * same tab so the two facts arrive together.
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
      title={`Reading as free · ${depotLabel}`}
      description="Worked out from the live feed: no trip assigned, and the engine not confirmed off. This is not the duty roster — treat it as a starting point, not a guarantee."
    >
      {standby.length === 0 ? (
        <OpsEmptyState>
          None of this depot&apos;s buses currently reads as free. That is a reading of the live
          feed, not a statement that the yard is empty.
        </OpsEmptyState>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {standby.slice(0, 12).map(({ bus, idleMinutes }) => (
            <li
              key={bus.id}
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
            >
              <OpsIdentifier className="text-foreground">{bus.registrationNumber}</OpsIdentifier>
              <span className="mx-1.5">·</span>
              {idleMinutes === null ? 'age of reading unknown' : `updated ${idleMinutes} min ago`}
            </li>
          ))}
        </ul>
      )}
      {standby.length > 12 && (
        <p className="mt-2 text-[11px] text-subtle">Showing 12 of {standby.length}.</p>
      )}
    </OpsSection>
  );
}
