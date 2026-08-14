import { OpsBadge, OpsStat, OpsStatGroup, OpsStatStrip, type OpsTone } from '@/components/ops/ui';
import { computeHeadwayCountdowns } from '@/lib/controlService/headwayCountdown';
import type { DepotConsoleSnapshot } from '@/lib/controlService/depotConsoleData';
import { depotCorridorLabel, corridorDetection } from '@/lib/ops/depotCorridors';
import {
  countdownTone,
  depotReadingsUnavailable,
  depotVehiclesOnCorridors,
  formatCountdown,
  tightestCountdown,
} from '@/lib/ops/depotConsoleModel';
import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { isObserved, observed, readingDisplay, unavailable, type ConsoleReading } from '@/lib/ops/consoleReadings';

/** What every unread tile says under its `n/a`. The control room's words, deliberately. */
const DID_NOT_ANSWER = 'the control service did not answer';

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
 *
 * ─── THE TWO POPULATIONS HAVE TWO SEPARATE UPSTREAMS ─────────────────────
 *
 * "Vehicles reporting" comes from the live feed; everything beside it comes
 * from the control service. Those fail independently, and this strip's job
 * when one of them is down is to keep saying what the OTHER one measured
 * while refusing to state anything for the one that did not answer.
 *
 * It used to state it anyway. With the control service unread, the corridor
 * tiles rendered the data layer's zeros as measurements — "Corridors running
 * 0", "Can report bunching 0 of 0", "0 corridors mapped statewide", and, worst
 * of the four, "195 on roads not yet surveyed" beside a live feed reporting
 * 195 buses. The true readings that shift were 34 corridors, 14 detecting, 759
 * mapped, and 62 of the 195 on a mapped corridor. Every tile below now goes
 * through `ConsoleReading`, so an unread tile prints `n/a` and cannot print a
 * number: the glyph, and the "unknown, not zero" meaning behind it, are the
 * control room's (src/lib/ops/consoleReadings.ts) rather than a second
 * invention here.
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
  const selected = snapshot.selectedCorridor;
  const countdowns = computeHeadwayCountdowns(snapshot.headwayPairs);
  const tightest = tightestCountdown(countdowns);
  const detection = selected ? corridorDetection(selected) : null;

  // `coverage` is null exactly when nothing was read, so this one branch
  // decides all four corridor tiles at once — they come from the same two
  // calls and are known together or not at all.
  const coverage = snapshot.coverage;
  const unread = depotReadingsUnavailable(snapshot);

  const onCorridors: ConsoleReading = unread
    ? unavailable(DID_NOT_ANSWER)
    : observed(
        depotVehiclesOnCorridors(snapshot.corridors),
        // The gap between this and the whole fleet is the honest headline of
        // this console and is stated rather than left to be inferred from two
        // numbers — but only when both numbers were measured. Claiming buses
        // are "on roads not yet surveyed" on the strength of an unread
        // corridor list is a statement about the route network that nobody
        // took.
        fleet.buses.length === 0
          ? ''
          : `${fleet.buses.length - depotVehiclesOnCorridors(snapshot.corridors)} on roads not yet surveyed`,
      );

  const running: ConsoleReading = coverage === null ? unavailable(DID_NOT_ANSWER) : observed(coverage.running, '');

  const detecting: ConsoleReading =
    coverage === null
      ? unavailable(DID_NOT_ANSWER)
      : observed(
          coverage.detecting,
          snapshot.mappedCorridorCount === null ? '' : `${snapshot.mappedCorridorCount} corridors mapped statewide`,
        );

  const observationOnly: ConsoleReading =
    coverage === null
      ? unavailable(DID_NOT_ANSWER)
      : observed(
          coverage.observationOnly,
          coverage.unknown > 0 ? `${coverage.unknown} unknown` : 'no measured target headway',
        );

  return (
    <OpsStatStrip>
      <OpsStatGroup label={`${depotLabel} — whole depot`}>
        <OpsStat
          label="Vehicles reporting"
          value={fleet.buses.length}
          tone={fleet.source === 'unavailable' ? 'critical' : 'default'}
          hint={fleet.source === 'unavailable' ? 'feed unavailable' : undefined}
        />
        <ReadingStat
          label="On a mapped corridor"
          reading={onCorridors}
          // The denominator is the live feed's own measurement and survives a
          // control-service outage, but it is dropped beside an `n/a`: "n/a of
          // 195" invites the missing half to be read as zero.
          unit={`of ${fleet.buses.length}`}
        />
        <ReadingStat label="Corridors running" reading={running} />
      </OpsStatGroup>

      <OpsStatGroup label="Bunching detection — this depot">
        <ReadingStat
          label="Can report bunching"
          reading={detecting}
          unit={coverage === null ? undefined : `of ${coverage.running}`}
          tone={coverage !== null && coverage.detecting === 0 && coverage.running > 0 ? 'warn' : 'default'}
        />
        <ReadingStat label="Observation-only" reading={observationOnly} />
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
          {/* Two different badges, because they are two different facts.
              "stale" says these readings are real and old; "n/a" says there
              are none. One badge for both would put the outage that has data
              and the outage that has none under the same word. */}
          {unread ? (
            <OpsBadge variant="critical">corridors n/a</OpsBadge>
          ) : (
            snapshot.source === 'unavailable' && <OpsBadge variant="critical">corridors stale</OpsBadge>
          )}
        </div>
      </OpsStatGroup>
    </OpsStatStrip>
  );
}

/**
 * One tile driven by a `ConsoleReading`.
 *
 * Mirrors the control room's `ConsoleKpiTileView`, including the two
 * presentational rules that matter: an unobserved reading drops its unit, and
 * it never takes the tone its value would have had. An `n/a` drawn in alert
 * amber reads as a measurement that is bad rather than as one that was never
 * taken — the same lie by a different route.
 */
function ReadingStat({
  label,
  reading,
  unit,
  tone = 'default',
}: {
  label: string;
  reading: ConsoleReading;
  unit?: string;
  tone?: OpsTone;
}) {
  const real = isObserved(reading);
  return (
    <OpsStat
      label={label}
      value={readingDisplay(reading)}
      unit={real ? unit : undefined}
      hint={reading.detail === '' ? undefined : reading.detail}
      tone={real ? tone : 'default'}
      className={real ? undefined : 'opacity-70'}
    />
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
