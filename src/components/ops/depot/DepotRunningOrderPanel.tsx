import {
  OpsAlert,
  OpsEmptyState,
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
import { countdownTone, depotReadingsUnavailable, formatCountdown } from '@/lib/ops/depotConsoleModel';

const COUNTDOWN_TONE_CLASS = {
  default: 'border-ops-line-strong text-ops-muted',
  good: 'border-alert-green/40 bg-alert-green/10 text-ops-good',
  warn: 'border-alert-amber/50 bg-alert-amber/10 text-ops-warn',
  critical: 'border-alert-crimson/50 bg-alert-crimson/10 text-ops-danger',
} as const;

/**
 * Running order and headway countdown for the selected corridor.
 *
 * ─── WHAT "RUNNING ORDER" ACTUALLY IS ────────────────────────────────────
 *
 * Distance along the route, furthest first. It is NOT a scheduled departure
 * order — nothing in this system publishes one — and the caption says so
 * rather than letting the column header imply it. This is the closest real
 * signal the control service exposes, and calling it what it is costs one
 * sentence.
 *
 * ─── WHY THE LEADER COLUMN CAN BE BLANK ──────────────────────────────────
 *
 * A headway pair names a leader and a follower, and corridors are shared, so
 * the leader in front of one of this depot's buses is routinely another
 * depot's. Those pairs are removed server-side (see depotConsoleData.ts) —
 * printing the leader's registration here would reopen, through a tooltip, the
 * boundary the vehicle scoping closed. The count of them is surfaced instead,
 * so an operator learns their bus is in a pair without learning whose bus it
 * is paired with.
 */
export function DepotRunningOrderPanel({ snapshot }: { snapshot: DepotConsoleSnapshot }) {
  const { selectedCorridor, vehicles } = snapshot;

  if (selectedCorridor === null) {
    // Two ways to have no corridor, and they are not the same fact. The
    // first is a reading — the control service answered and places none of
    // this depot's buses on a mapped corridor — and it comes with a real
    // explanation about survey coverage. The second is the absence of a
    // reading, and saying any of that would be inventing the survey claim.
    if (depotReadingsUnavailable(snapshot)) {
      return (
        <OpsSection title="Running order">
          <OpsAlert tone="warning">
            The control service did not answer and no earlier reading is held, so which corridors this depot is
            running is unknown. This is not a statement that it is running none.
          </OpsAlert>
        </OpsSection>
      );
    }
    return (
      <OpsSection title="Running order">
        <OpsAlert tone="info">
          The control service is not placing any of this depot&apos;s vehicles on a mapped corridor right now, so
          there is no running order to show. The depot may well be busy — only part of the state&apos;s route network
          has been surveyed into the control database.
        </OpsAlert>
      </OpsSection>
    );
  }

  const countdowns = computeHeadwayCountdowns(snapshot.headwayPairs);
  const countdownByFollower = new Map(countdowns.map((countdown) => [countdown.followerVehicleId, countdown]));
  const observationOnly = describeCorridorObservationOnly(selectedCorridor);

  return (
    <OpsSection
      title={`Running order · ${depotCorridorLabel(selectedCorridor)}`}
      description="Ordered by distance along the route, furthest first. That is a measured position, not a scheduled departure order — this system publishes no departure order to compare against."
    >
      {observationOnly && (
        <OpsAlert tone="info" className="mb-3">
          {observationOnly}
        </OpsAlert>
      )}

      {!observationOnly && !snapshot.headwayRead && (
        <OpsAlert tone="warning" className="mb-3">
          The headway reading for this corridor could not be taken, so the countdown column is unknown rather than
          clear. The positions below are still this depot&apos;s own.
        </OpsAlert>
      )}

      {vehicles.length === 0 ? (
        <OpsEmptyState>
          None of this depot&apos;s vehicles is currently reporting a position on {depotCorridorLabel(selectedCorridor)}.
        </OpsEmptyState>
      ) : (
        <OpsTableFrame>
          <table className={opsTableClass}>
            <thead>
              <tr className={opsTheadRowClass}>
                <th className={opsThClass}>Vehicle</th>
                <th className={opsThClass}>Stop state</th>
                <th className={opsThClass}>Current stop</th>
                <th className={opsThClass}>Along route</th>
                <th className={opsThClass}>Headway cushion</th>
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
                    <td className={`${opsTdClass} font-mono text-xs`}>{vehicle.vehicleId}</td>
                    <td className={`${opsTdMutedClass} text-xs`}>{vehicle.stopState.replace(/_/g, ' ')}</td>
                    <td className={`${opsTdMutedClass} text-xs`}>{vehicle.currentStopId ?? '—'}</td>
                    <td className={opsTdNumericClass}>
                      {vehicle.distanceAlongRouteMeters === null
                        ? '—'
                        : `${Math.round(vehicle.distanceAlongRouteMeters).toLocaleString()} m`}
                    </td>
                    <td className={opsTdClass}>
                      {countdown ? (
                        <span
                          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${COUNTDOWN_TONE_CLASS[tone]}`}
                          title={`Behind ${countdown.leaderVehicleId}, also this depot's; target ${countdown.targetHeadwaySeconds}s`}
                        >
                          {countdown.overdue ? 'Overdue ' : ''}
                          {formatCountdown(countdown.countdownSeconds)}
                        </span>
                      ) : (
                        <span className="text-xs text-ops-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </OpsTableFrame>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-ops-faint">
        Cushion is the time remaining before a follower closes to within its corridor&apos;s target headway of the bus
        ahead; red means it already has.{' '}
        {snapshot.crossDepotPairCount > 0 ? (
          <>
            {snapshot.crossDepotPairCount}{' '}
            {snapshot.crossDepotPairCount === 1 ? 'further pair involves' : 'further pairs involve'} one of this
            depot&apos;s buses and one from another depot; those are not shown, because the other depot&apos;s vehicles
            are not this depot&apos;s to see. A blank cushion can therefore mean the bus ahead belongs to someone else.
          </>
        ) : (
          'A blank cushion means no pair with a current sample covers that bus.'
        )}
      </p>
    </OpsSection>
  );
}
