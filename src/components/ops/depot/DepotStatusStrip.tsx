import { OpsBadge, OpsReadingStat, OpsStat, OpsStatGroup, OpsStatStrip } from '@/components/ops/ui';
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
import {
  notYetComputed,
  observed,
  unavailable,
  type ConsoleReading,
} from '@/lib/ops/consoleReadings';

/** What every unread tile says under its `n/a`. The control room's words, deliberately. */
const DID_NOT_ANSWER = 'the control service did not answer';

/**
 * The band pinned under the chrome: what this depot has out, and what the
 * selected corridor is doing.
 *
 * Split into CAPTIONED GROUPS rather than one row of numbers, which is what
 * `OpsStatGroup` exists for. The strip genuinely mixes populations — a depot's
 * whole reporting fleet, the subset the control service places on a surveyed
 * corridor, and readings from one corridor — and side by side without captions
 * those read as one set of facts about one thing. On this console that
 * misreading is the expensive one: "42 buses" beside "1 pair closing up" would
 * suggest the console is watching all 42, when in the ordinary case it is
 * watching six of them on one corridor and cannot watch the rest at all.
 *
 * ─── THE TWO POPULATIONS HAVE TWO SEPARATE UPSTREAMS ─────────────────────
 *
 * "Buses reporting" comes from the live feed; everything beside it comes from
 * the control service. Those fail independently, and this strip's job when one
 * of them is down is to keep saying what the OTHER one measured while refusing
 * to state anything for the one that did not answer.
 *
 * It used to state it anyway. With the control service unread, the corridor
 * tiles rendered the data layer's zeros as measurements — "Corridors running
 * 0", "Can report bunching 0 of 0", and, worst of the four, "195 on roads not
 * yet surveyed" beside a live feed reporting 195 buses. Every tile below goes
 * through `ConsoleReading` and `OpsReadingStat`, so an unread tile prints `n/a`
 * and CANNOT print a number.
 *
 * ─── WHY THESE ARE THE FOUNDATION'S PRIMITIVE AND NOT A LOCAL ONE ────────
 *
 * This file used to carry its own `ReadingStat`, a near-copy of the control
 * room's tile. It differed in one detail that turned out to matter: it dimmed
 * an unobserved tile with `opacity-70`. The palette's third text tier is
 * measured at 5.41:1 on the card and 4.81:1 on the page — 70% opacity drops
 * both under the 4.5:1 the measurement was chosen to clear, so the tiles an
 * operator most needs to read during an outage were the least readable ones on
 * the strip. `OpsReadingStat` carries the same two presentational rules that
 * were the real point (an unobserved reading drops its unit, and never takes
 * the tone its value would have had) without that.
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
        // corridor list is a statement about the road network that nobody took.
        fleet.buses.length === 0
          ? ''
          : `${fleet.buses.length - depotVehiclesOnCorridors(snapshot.corridors)} on roads not yet surveyed`,
      );

  const running: ConsoleReading =
    coverage === null ? unavailable(DID_NOT_ANSWER) : observed(coverage.running, '');

  const detecting: ConsoleReading =
    coverage === null
      ? unavailable(DID_NOT_ANSWER)
      : observed(
          coverage.detecting,
          snapshot.mappedCorridorCount === null
            ? ''
            : `${snapshot.mappedCorridorCount} corridors surveyed statewide`,
        );

  const watchOnly: ConsoleReading =
    coverage === null
      ? unavailable(DID_NOT_ANSWER)
      : observed(
          coverage.observationOnly,
          coverage.unknown > 0 ? `${coverage.unknown} unknown` : 'no planned gap set',
        );

  return (
    <OpsStatStrip>
      <OpsStatGroup label={`${depotLabel} — whole depot`}>
        <OpsStat
          label="Buses reporting"
          value={fleet.buses.length}
          tone={fleet.source === 'unavailable' ? 'critical' : 'default'}
          hint={fleet.source === 'unavailable' ? 'live feed unavailable' : undefined}
        />
        <OpsReadingStat
          label="On a surveyed corridor"
          reading={onCorridors}
          // The denominator is the live feed's own measurement and survives a
          // control-service outage, but `OpsReadingStat` drops it beside an
          // `n/a`: "n/a of 195" invites the missing half to be read as zero.
          unit={`of ${fleet.buses.length}`}
        />
        <OpsReadingStat label="Corridors this depot is on" reading={running} />
      </OpsStatGroup>

      <OpsStatGroup label="Buses closing up — can it be checked?">
        <OpsReadingStat
          label="Corridors that can be checked"
          reading={detecting}
          unit={coverage === null ? undefined : `of ${coverage.running}`}
          tone={
            coverage !== null && coverage.detecting === 0 && coverage.running > 0
              ? 'warn'
              : 'default'
          }
        />
        <OpsReadingStat label="Watch-only" reading={watchOnly} />
      </OpsStatGroup>

      {selected && (
        <OpsStatGroup label={`Corridor ${depotCorridorLabel(selected)}`}>
          <OpsStat label="This depot's buses on it" value={selected.depotVehicleCount} />
          {detection !== 'detecting' ? (
            // Deliberately NOT a zero. No planned gap has been set for this
            // corridor, so "0 pairs" would be a reading nobody took.
            <OpsReadingStat
              label="Pairs of buses being watched"
              reading={notYetComputed(
                detection === 'observation-only'
                  ? 'no planned gap set for this corridor'
                  : 'the control service does not say whether this corridor has a planned gap',
              )}
            />
          ) : !snapshot.headwayRead ? (
            // `n/a`, not `-`. The gap reading was ATTEMPTED and could not be
            // taken, which is the unknown case; this tile used to print the
            // "nothing to report" dash for it, which is the one substitution
            // the whole vocabulary exists to prevent.
            <OpsReadingStat
              label="Pairs of buses being watched"
              reading={unavailable('the gap reading could not be taken')}
            />
          ) : (
            <>
              <OpsStat
                label="Pairs of buses being watched"
                value={snapshot.headwayPairs.length}
                hint={
                  snapshot.crossDepotPairCount > 0
                    ? `${snapshot.crossDepotPairCount} more paired with another depot`
                    : undefined
                }
              />
              <OpsStat
                label="Least time in hand"
                value={formatCountdown(tightest?.countdownSeconds ?? null)}
                tone={
                  tightest
                    ? countdownTone(tightest.countdownSeconds, tightest.targetHeadwaySeconds)
                    : 'default'
                }
                hint={
                  tightest ? `behind ${tightest.leaderVehicleId}` : 'no pair with a fresh reading'
                }
              />
            </>
          )}
        </OpsStatGroup>
      )}

      <OpsStatGroup label="Where this comes from">
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <OpsBadge variant={badgeVariant(fleet.source)}>{feedLabel(fleet.source)}</OpsBadge>
          {/* Two different chips, because they are two different facts.
              "out of date" says these readings are real and old; "not read"
              says there are none. One chip for both would put the outage that
              has data and the outage that has none under the same word. */}
          {unread ? (
            <OpsBadge variant="critical">corridors not read</OpsBadge>
          ) : (
            snapshot.source === 'unavailable' && (
              <OpsBadge variant="critical">corridors out of date</OpsBadge>
            )
          )}
        </div>
      </OpsStatGroup>
    </OpsStatStrip>
  );
}

/**
 * The provenance chip's word.
 *
 * `live`/`fixture` are the product's provenance vocabulary and stay recognisable,
 * but `cache` and `unavailable` were wire values leaking onto a chip: "cache"
 * is not a claim about the data an operator can act on, and "unavailable" beside
 * a populated table reads as a contradiction.
 */
function feedLabel(source: OpsFleetSnapshot['source']): string {
  switch (source) {
    case 'live':
      return 'live';
    case 'cache':
      return 'last reading held';
    case 'fixture':
      return 'fixture';
    case 'unavailable':
      return 'live feed not read';
  }
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
