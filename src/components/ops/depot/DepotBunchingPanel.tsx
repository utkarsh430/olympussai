import {
  OpsAlert,
  OpsEmptyState,
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
import { depotCorridorLabel, describeCorridorObservationOnly, describeDepotDetectionCoverage } from '@/lib/ops/depotCorridors';
import { countdownTone, formatCountdown } from '@/lib/ops/depotConsoleModel';
import { computeHeadwayCountdowns } from '@/lib/controlService/headwayCountdown';

const TONE_TEXT = {
  default: 'text-ops-muted',
  good: 'text-alert-green',
  warn: 'text-alert-amber',
  critical: 'text-ops-danger',
} as const;

/**
 * Bunching on this depot's corridors.
 *
 * ─── THE ONE THING THIS PANEL MUST NOT DO ────────────────────────────────
 *
 * Render empty and let that read as "all clear". 561 of the 759 mapped
 * corridors carry no measured target headway, so for a great many depots this
 * panel is structurally incapable of ever reporting anything — and an empty
 * panel is exactly what a quiet, healthy corridor also looks like. Every empty
 * state below therefore states WHICH of the two it is: detection is off for
 * this corridor, or the reading could not be taken, or the corridor really is
 * spaced correctly right now.
 *
 * The incidents are the ones already narrowed and redacted for this depot by
 * `narrowIncidentsToScope` — members outside the depot are removed and the
 * evidence blob is dropped wholesale, so a mixed-depot incident shows the
 * operator their own bus without handing them anyone else's.
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
  const { selectedCorridor } = snapshot;
  const coverageSentence = describeDepotDetectionCoverage(snapshot.coverage, depotLabel);
  const observationOnly = selectedCorridor ? describeCorridorObservationOnly(selectedCorridor) : null;
  const countdowns = computeHeadwayCountdowns(snapshot.headwayPairs);

  return (
    <OpsStack gap="tight">
      <OpsAlert tone={snapshot.coverage.detecting === 0 ? 'warning' : 'info'}>{coverageSentence}</OpsAlert>

      {selectedCorridor === null ? null : (
        <>
          <OpsSection
            title={`Open incidents · ${depotCorridorLabel(selectedCorridor)}`}
            description="Raised by the control service's own headway sweep, and drawn on the map beside this."
          >
            {observationOnly ? (
              <OpsAlert tone="info">{observationOnly}</OpsAlert>
            ) : incidents.length === 0 ? (
              <OpsEmptyState>
                No open bunching incident on this corridor. This corridor does carry a measured target headway, so this
                is a real all-clear rather than an absence of detection.
              </OpsEmptyState>
            ) : (
              <ul className="space-y-2">
                {incidents.map((incident) => (
                  <li key={incident.id} className="ops-well px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <IncidentSeverityBadge severity={incident.severity} />
                      <span className="font-mono text-xs text-ops-muted">
                        since {new Date(incident.startedAt).toLocaleTimeString()}
                      </span>
                      <span className="text-xs text-ops-faint">
                        {incident.causeClass.replace(/_/g, ' ')} · {incident.controllability.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-ops-muted">
                      This depot&apos;s buses involved:{' '}
                      <span className="font-mono text-ops-ink">
                        {incident.members.map((member) => member.vehicleId).join(', ')}
                      </span>
                      . Other depots&apos; buses in the same incident are not listed here.
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </OpsSection>

          <OpsSection
            title="Headway pairs"
            description="Leader-and-follower pairs where both buses are this depot's. The corridor's measured target is what the cushion is judged against."
          >
            {observationOnly ? (
              <OpsEmptyState>
                No target headway has been measured for this corridor, so no pair can be judged against one.
              </OpsEmptyState>
            ) : !snapshot.headwayRead ? (
              <OpsAlert tone="warning">
                The headway reading could not be taken for this corridor, so whether its buses are bunched is unknown —
                not clear.
              </OpsAlert>
            ) : countdowns.length === 0 ? (
              <OpsEmptyState>
                {snapshot.crossDepotPairCount > 0
                  ? `No pair on this corridor has both buses from ${depotLabel}. ${snapshot.crossDepotPairCount} ${snapshot.crossDepotPairCount === 1 ? 'pair pairs' : 'pairs pair'} one of this depot's buses with another depot's, and those are not this depot's to see.`
                  : 'The control service reports no leader-and-follower pair on this corridor right now.'}
              </OpsEmptyState>
            ) : (
              <OpsTableFrame>
                <table className={opsTableClass}>
                  <thead>
                    <tr className={opsTheadRowClass}>
                      <th className={opsThClass}>Leader</th>
                      <th className={opsThClass}>Follower</th>
                      <th className={opsThClass}>Current gap</th>
                      <th className={opsThClass}>Target</th>
                      <th className={opsThClass}>Cushion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countdowns.map((countdown) => (
                      <tr key={countdown.pairId} className={opsTrClass}>
                        <td className={`${opsTdClass} font-mono text-xs`}>{countdown.leaderVehicleId}</td>
                        <td className={`${opsTdClass} font-mono text-xs`}>{countdown.followerVehicleId}</td>
                        <td className={opsTdNumericClass}>{formatCountdown(countdown.currentHeadwaySeconds)}</td>
                        <td className={opsTdNumericClass}>{formatCountdown(countdown.targetHeadwaySeconds)}</td>
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
