import { OpsBadge, OpsStat, OpsStatGroup, OpsStatStrip } from '@/components/ops/ui';
import { computeHeadwayCountdowns } from '@/lib/controlService/headwayCountdown';
import type { DepotConsoleSnapshot } from '@/lib/controlService/depotConsoleData';
import { depotCorridorLabel, corridorDetection } from '@/lib/ops/depotCorridors';
import { countdownTone, depotVehiclesOnCorridors, formatCountdown, tightestCountdown } from '@/lib/ops/depotConsoleModel';
import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';

/**
 * The band pinned under the chrome: what this depot has out, and what the
 * selected corridor is doing.
 *
 * Split into CAPTIONED GROUPS rather than one row of numbers, which is what
 * `OpsStatGroup` exists for. The strip genuinely mixes populations — a depot's
 * whole reporting fleet, the subset the control service places on a mapped
 * corridor, and readings from one corridor — and side by side without captions
 * those read as one set of facts about one thing. On this console that
 * misreading is the expensive one: "42 vehicles" beside "1 pair bunched" would
 * suggest the console is watching all 42 for bunching, when in the ordinary
 * case it is watching six of them on one corridor and cannot watch the rest at
 * all.
 */
export function DepotStatusStrip({
  fleet,
  console: snapshot,
  depotLabel,
}: {
  fleet: OpsFleetSnapshot;
  console: DepotConsoleSnapshot;
  depotLabel: string;
}) {
  const onCorridors = depotVehiclesOnCorridors(snapshot.corridors);
  const selected = snapshot.selectedCorridor;
  const countdowns = computeHeadwayCountdowns(snapshot.headwayPairs);
  const tightest = tightestCountdown(countdowns);
  const detection = selected ? corridorDetection(selected) : null;

  return (
    <OpsStatStrip>
      <OpsStatGroup label={`${depotLabel} — whole depot`}>
        <OpsStat
          label="Vehicles reporting"
          value={fleet.buses.length}
          tone={fleet.source === 'unavailable' ? 'critical' : 'default'}
          hint={fleet.source === 'unavailable' ? 'feed unavailable' : undefined}
        />
        <OpsStat
          label="On a mapped corridor"
          value={onCorridors}
          unit={`of ${fleet.buses.length}`}
          // The gap between these two is the honest headline of this console
          // and is stated rather than left to be inferred from two numbers.
          hint={
            fleet.buses.length === 0
              ? undefined
              : `${fleet.buses.length - onCorridors} on roads not yet surveyed`
          }
        />
        <OpsStat label="Corridors running" value={snapshot.corridors.length} />
      </OpsStatGroup>

      <OpsStatGroup label="Bunching detection — this depot">
        <OpsStat
          label="Can report bunching"
          value={snapshot.coverage.detecting}
          unit={`of ${snapshot.coverage.running}`}
          tone={snapshot.coverage.detecting === 0 && snapshot.coverage.running > 0 ? 'warn' : 'default'}
          hint={`${snapshot.mappedCorridorCount} corridors mapped statewide`}
        />
        <OpsStat
          label="Observation-only"
          value={snapshot.coverage.observationOnly}
          hint={snapshot.coverage.unknown > 0 ? `${snapshot.coverage.unknown} unknown` : 'no measured target headway'}
        />
      </OpsStatGroup>

      {selected && (
        <OpsStatGroup label={`Corridor ${depotCorridorLabel(selected)}`}>
          <OpsStat label="This depot's buses on it" value={selected.depotVehicleCount} />
          {detection === 'observation-only' ? (
            // Deliberately NOT a zero. This corridor has no measured target
            // headway, so "0 pairs" would be a reading nobody took.
            <OpsStat label="Headway pairs" value="—" hint="detection off for this corridor" />
          ) : !snapshot.headwayRead ? (
            <OpsStat label="Headway pairs" value="—" tone="warn" hint="reading could not be taken" />
          ) : (
            <>
              <OpsStat
                label="Headway pairs"
                value={snapshot.headwayPairs.length}
                hint={
                  snapshot.crossDepotPairCount > 0
                    ? `${snapshot.crossDepotPairCount} more paired with another depot`
                    : undefined
                }
              />
              <OpsStat
                label="Tightest cushion"
                value={formatCountdown(tightest?.countdownSeconds ?? null)}
                tone={
                  tightest ? countdownTone(tightest.countdownSeconds, tightest.targetHeadwaySeconds) : 'default'
                }
                hint={tightest ? `behind ${tightest.leaderVehicleId}` : 'no pair with a current sample'}
              />
            </>
          )}
        </OpsStatGroup>
      )}

      <OpsStatGroup label="Feed">
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <OpsBadge variant={badgeVariant(fleet.source)}>{fleet.source}</OpsBadge>
          {snapshot.source === 'unavailable' && <OpsBadge variant="critical">corridors stale</OpsBadge>}
        </div>
      </OpsStatGroup>
    </OpsStatStrip>
  );
}

function badgeVariant(source: OpsFleetSnapshot['source']) {
  switch (source) {
    case 'live':
      return 'live' as const;
    case 'cache':
      return 'neutral' as const;
    case 'fixture':
      return 'fixture' as const;
    case 'unavailable':
      return 'critical' as const;
  }
}
