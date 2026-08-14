import {
  OpsAlert,
  OpsEmptyState,
  OpsIdentifier,
  OpsSection,
  OpsStack,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdNumericClass,
  opsTheadRowClass,
  opsThClass,
  opsTrClass,
} from '@/components/ops/ui';
import { IncidentSeverityBadge } from '@/components/ops/control-room/IncidentSeverityBadge';
import type { BunchingIncident } from '@/models/control';
import type { DepotConsoleSnapshot } from '@/lib/controlService/depotConsoleData';
import {
  depotCorridorLabel,
  describeCorridorObservationOnly,
  describeDepotDetectionCoverage,
} from '@/lib/ops/depotCorridors';
import { countdownTone, formatCountdown } from '@/lib/ops/depotConsoleModel';
import { computeHeadwayCountdowns } from '@/lib/controlService/headwayCountdown';
import { describeCause, describeControllability } from '@/lib/ops/incidentCause';

/** Time-in-hand text tone, on the palette's measured text weights. */
const TONE_TEXT = {
  default: 'text-muted-foreground',
  good: 'text-success',
  warn: 'text-warning',
  critical: 'text-destructive',
} as const;

/**
 * Buses closing up on this depot's corridors.
 *
 * ─── THE ONE THING THIS PANEL MUST NOT DO ────────────────────────────────
 *
 * Render empty and let that read as "all clear". 561 of the 759 surveyed
 * corridors have no planned gap set, so for a great many depots this panel is
 * structurally incapable of ever reporting anything — and an empty panel is
 * exactly what a quiet, healthy corridor also looks like. Every empty state
 * below therefore states WHICH of the two it is: this corridor cannot be
 * checked, or the reading could not be taken, or the buses really are spaced
 * correctly right now.
 *
 * The incidents are the ones already narrowed and redacted for this depot by
 * `narrowIncidentsToScope` — buses outside the depot are removed and the
 * evidence blob is dropped wholesale, so an incident spanning two depots shows
 * the operator their own bus without handing them anyone else's.
 */
export function DepotBunchingPanel({
  snapshot,
  incidents,
  depotLabel,
}: {
  snapshot: DepotConsoleSnapshot;
  incidents: readonly BunchingIncident[];
  depotLabel: string;
}) {
  const { selectedCorridor, coverage } = snapshot;
  const observationOnly = selectedCorridor
    ? describeCorridorObservationOnly(selectedCorridor)
    : null;
  const countdowns = computeHeadwayCountdowns(snapshot.headwayPairs);

  return (
    <OpsStack gap="tight">
      {/* The coverage sentence is a MEASUREMENT of this depot's corridors, so
          it can only be written when the corridors were measured. With
          `coverage` null its `running === 0` branch would have claimed the
          control service "is not placing any of this depot's buses on a
          surveyed corridor right now ... a gap in the survey" — a confident
          claim about the state's road network, produced by a process that
          never reached the control service. */}
      {coverage === null ? (
        <OpsAlert tone="warning">
          The control service did not answer and no earlier reading is held, so how many of{' '}
          {depotLabel}&apos;s corridors can be checked for buses closing up is unknown rather than
          none. Nothing on this panel is an all-clear.
        </OpsAlert>
      ) : (
        <OpsAlert tone={coverage.detecting === 0 ? 'warning' : 'info'}>
          {describeDepotDetectionCoverage(coverage, depotLabel)}
        </OpsAlert>
      )}

      {selectedCorridor === null ? null : (
        <>
          <OpsSection
            title={`Happening now · ${depotCorridorLabel(selectedCorridor)}`}
            description="Found automatically by the control service's own gap check, and drawn on the map beside this."
          >
            {observationOnly ? (
              <OpsAlert tone="info">{observationOnly}</OpsAlert>
            ) : incidents.length === 0 ? (
              <OpsEmptyState>
                No buses are closing up on this corridor. This corridor does have a planned gap set,
                so this is a real all-clear rather than a corridor that cannot be checked.
              </OpsEmptyState>
            ) : (
              <ul className="space-y-2">
                {incidents.map((incident) => (
                  <li key={incident.id} className="ops-well px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <IncidentSeverityBadge severity={incident.severity} />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        since {new Date(incident.startedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {describeCause(incident.causeClass)}{' '}
                      {describeControllability(incident.controllability)}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      This depot&apos;s buses involved:{' '}
                      <OpsIdentifier className="text-foreground">
                        {incident.members.map((member) => member.vehicleId).join(', ')}
                      </OpsIdentifier>
                      . Buses from other depots in the same incident are not listed here.
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </OpsSection>

          <OpsSection
            title="Pairs of buses being watched"
            description="Pairs where both the bus in front and the bus behind belong to this depot. Time in hand is measured against this corridor's planned gap."
          >
            {observationOnly ? (
              <OpsEmptyState>
                No planned gap has been set for this corridor, so no pair can be judged against one.
              </OpsEmptyState>
            ) : !snapshot.headwayRead ? (
              <OpsAlert tone="warning">
                The gap reading could not be taken for this corridor, so whether its buses are
                closing up is unknown — not clear.
              </OpsAlert>
            ) : countdowns.length === 0 ? (
              <OpsEmptyState>
                {snapshot.crossDepotPairCount > 0
                  ? `No pair on this corridor has both buses from ${depotLabel}. ${snapshot.crossDepotPairCount} ${snapshot.crossDepotPairCount === 1 ? 'pair puts' : 'pairs put'} one of this depot's buses with another depot's, and those are not this depot's to see.`
                  : 'The control service reports no pair of buses one behind the other on this corridor right now.'}
              </OpsEmptyState>
            ) : (
              <OpsTableFrame>
                <table className={opsTableClass}>
                  <thead>
                    <tr className={opsTheadRowClass}>
                      <th className={opsThClass}>Bus in front</th>
                      <th className={opsThClass}>Bus behind</th>
                      <th className={opsThClass}>Gap now</th>
                      <th className={opsThClass}>Planned gap</th>
                      <th className={opsThClass}>Time in hand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countdowns.map((countdown) => (
                      <tr key={countdown.pairId} className={opsTrClass}>
                        <td className={opsTdClass}>
                          <OpsIdentifier className="text-xs">
                            {countdown.leaderVehicleId}
                          </OpsIdentifier>
                        </td>
                        <td className={opsTdClass}>
                          <OpsIdentifier className="text-xs">
                            {countdown.followerVehicleId}
                          </OpsIdentifier>
                        </td>
                        <td className={opsTdNumericClass}>
                          {formatCountdown(countdown.currentHeadwaySeconds)}
                        </td>
                        <td className={opsTdNumericClass}>
                          {formatCountdown(countdown.targetHeadwaySeconds)}
                        </td>
                        <td
                          className={`${opsTdNumericClass} ${TONE_TEXT[countdownTone(countdown.countdownSeconds, countdown.targetHeadwaySeconds)]}`}
                        >
                          {countdown.overdue ? 'overdue ' : ''}
                          {formatCountdown(countdown.countdownSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </OpsTableFrame>
            )}
          </OpsSection>
        </>
      )}
    </OpsStack>
  );
}
