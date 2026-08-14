import {
  OpsAlert,
  OpsEmptyState,
  OpsIdentifier,
  OpsSection,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsTdNumericClass,
  opsTheadRowClass,
  opsThClass,
  opsTrClass,
} from '@/components/ops/ui';
import { computeHeadwayCountdowns } from '@/lib/controlService/headwayCountdown';
import type { DepotConsoleSnapshot } from '@/lib/controlService/depotConsoleData';
import { depotCorridorLabel, describeCorridorObservationOnly } from '@/lib/ops/depotCorridors';
import {
  countdownTone,
  depotReadingsUnavailable,
  formatCountdown,
} from '@/lib/ops/depotConsoleModel';
import { stopStateLabel } from '@/lib/ops/vehicleActivity';

/**
 * The time-in-hand chip, on semantic tokens.
 *
 * `instrument-*` are the alert hues at INSTRUMENT weight — a fill, a chip
 * border, a map mark — and `text-success`/`warning`/`destructive` are the same
 * three hues at TEXT weight. Using the instrument hue for the border and the
 * text hue for the word is what keeps the chip legible on both grounds in both
 * themes; it used to be a hard-coded dark-mode alert palette that had no light
 * value at all.
 *
 * Colour is never the only encoding here: the chip carries the word "Overdue"
 * when it is, and the number is signed.
 */
const COUNTDOWN_TONE_CLASS = {
  default: 'border-border text-muted-foreground',
  good: 'border-instrument-success/50 bg-instrument-success/10 text-success',
  warn: 'border-instrument-warning/60 bg-instrument-warning/10 text-warning',
  critical: 'border-instrument-danger/60 bg-instrument-danger/10 text-destructive',
} as const;

/**
 * Running order and time in hand for the selected corridor.
 *
 * ─── WHAT "RUNNING ORDER" ACTUALLY IS ────────────────────────────────────
 *
 * Distance along the route, furthest first. It is NOT a scheduled departure
 * order — nothing in this system publishes one — and the caption says so
 * rather than letting the column header imply it. This is the closest real
 * signal the control service exposes, and calling it what it is costs one
 * sentence.
 *
 * ─── WHY THE BUS-IN-FRONT COLUMN CAN BE BLANK ────────────────────────────
 *
 * A pair names a bus in front and a bus behind, and corridors are shared, so
 * the bus in front of one of this depot's is routinely another depot's. Those
 * pairs are removed server-side (see depotConsoleData.ts) — printing the other
 * depot's registration here would reopen, through a tooltip, the boundary the
 * vehicle scoping closed. The count of them is surfaced instead, so an operator
 * learns their bus is in a pair without learning whose bus it is paired with.
 */
export function DepotRunningOrderPanel({ snapshot }: { snapshot: DepotConsoleSnapshot }) {
  const { selectedCorridor, vehicles } = snapshot;

  if (selectedCorridor === null) {
    // Two ways to have no corridor, and they are not the same fact. The first
    // is a reading — the control service answered and places none of this
    // depot's buses on a surveyed corridor — and it comes with a real
    // explanation about survey coverage. The second is the ABSENCE of a
    // reading, and saying any of that would be inventing the survey claim.
    if (depotReadingsUnavailable(snapshot)) {
      return (
        <OpsSection title="Running order">
          <OpsAlert tone="warning">
            The control service did not answer and no earlier reading is held, so which corridors
            this depot is on is unknown. This is not a statement that it is on none.
          </OpsAlert>
        </OpsSection>
      );
    }
    return (
      <OpsSection title="Running order">
        <OpsAlert tone="info">
          The control service is not placing any of this depot&apos;s buses on a surveyed corridor
          right now, so there is no running order to show. The depot may well be busy — only part of
          the state&apos;s roads have been surveyed into the control database.
        </OpsAlert>
      </OpsSection>
    );
  }

  const countdowns = computeHeadwayCountdowns(snapshot.headwayPairs);
  const countdownByFollower = new Map(
    countdowns.map((countdown) => [countdown.followerVehicleId, countdown]),
  );
  const observationOnly = describeCorridorObservationOnly(selectedCorridor);

  return (
    <OpsSection
      title={`Running order · ${depotCorridorLabel(selectedCorridor)}`}
      description="Ordered by how far along the route each bus is, furthest first. That is a measured position, not a departure order — this system publishes no departure order to compare against."
    >
      {observationOnly && (
        <OpsAlert tone="info" className="mb-3">
          {observationOnly}
        </OpsAlert>
      )}

      {!observationOnly && !snapshot.headwayRead && (
        <OpsAlert tone="warning" className="mb-3">
          The gap reading for this corridor could not be taken, so the time-in-hand column is
          unknown rather than clear. The positions below are still this depot&apos;s own.
        </OpsAlert>
      )}

      {vehicles.length === 0 ? (
        <OpsEmptyState>
          None of this depot&apos;s buses is reporting a position on{' '}
          {depotCorridorLabel(selectedCorridor)} right now.
        </OpsEmptyState>
      ) : (
        <OpsTableFrame>
          <table className={opsTableClass}>
            <thead>
              <tr className={opsTheadRowClass}>
                <th className={opsThClass}>Bus</th>
                <th className={opsThClass}>What it is doing</th>
                <th className={opsThClass}>Stop reference</th>
                <th className={opsThClass}>Distance along route</th>
                <th className={opsThClass}>Time in hand</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => {
                const countdown = countdownByFollower.get(vehicle.vehicleId);
                const tone = countdown
                  ? countdownTone(countdown.countdownSeconds, countdown.targetHeadwaySeconds)
                  : 'default';
                return (
                  <tr key={vehicle.vehicleId} className={opsTrClass}>
                    <td className={opsTdClass}>
                      <OpsIdentifier className="text-xs">{vehicle.vehicleId}</OpsIdentifier>
                    </td>
                    <td className={`${opsTdMutedClass} text-xs`}>
                      {stopStateLabel(vehicle.stopState)}
                    </td>
                    <td className={`${opsTdMutedClass} text-xs`}>
                      {vehicle.currentStopId === null ? (
                        <span title="not beside a stop right now">
                          <span aria-hidden>—</span>
                          <span className="sr-only">nothing to report</span>
                        </span>
                      ) : (
                        <OpsIdentifier>{vehicle.currentStopId}</OpsIdentifier>
                      )}
                    </td>
                    <td className={opsTdNumericClass}>
                      {vehicle.distanceAlongRouteMeters === null ? (
                        <span title="the live feed did not give a distance">
                          <span aria-hidden>n/a</span>
                          <span className="sr-only">unknown, could not be read</span>
                        </span>
                      ) : (
                        `${Math.round(vehicle.distanceAlongRouteMeters).toLocaleString()} m`
                      )}
                    </td>
                    <td className={opsTdClass}>
                      {countdown ? (
                        <span
                          // `whitespace-nowrap`: without it the word and the
                          // number break inside the pill on a narrow column,
                          // and a two-line chip reads as a rendering fault
                          // rather than as one reading.
                          className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${COUNTDOWN_TONE_CLASS[tone]}`}
                          title={`Behind ${countdown.leaderVehicleId}, also this depot's. Planned gap ${countdown.targetHeadwaySeconds}s.`}
                        >
                          {countdown.overdue ? 'Overdue ' : ''}
                          {formatCountdown(countdown.countdownSeconds)}
                        </span>
                      ) : (
                        <span
                          className="text-xs text-subtle"
                          title="no pair with a fresh reading covers this bus"
                        >
                          <span aria-hidden>—</span>
                          <span className="sr-only">nothing to report</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </OpsTableFrame>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-subtle">
        Time in hand is how long before a bus closes to within the planned gap of the bus in front;
        red means it already has. The stop reference is the code the live feed sends — this system
        holds no stop names for it here.{' '}
        {snapshot.crossDepotPairCount > 0 ? (
          <>
            {snapshot.crossDepotPairCount}{' '}
            {snapshot.crossDepotPairCount === 1 ? 'further pair involves' : 'further pairs involve'}{' '}
            one of this depot&apos;s buses and one from another depot; those are not shown, because
            the other depot&apos;s buses are not this depot&apos;s to see. A blank time in hand can
            therefore mean the bus in front belongs to someone else.
          </>
        ) : (
          'A blank time in hand means no pair with a fresh reading covers that bus.'
        )}
      </p>
    </OpsSection>
  );
}
