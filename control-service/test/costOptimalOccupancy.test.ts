// Why `cost_optimal` falls completely silent when occupancy weighting is on.
//
// Three fleet trials on the urban / suburban / intercity presets each reported
// `lawCoverage` of exactly 0 for `cost_optimal` in the occupancy-weighed phase,
// against 310-578 generating decisions in the occupancy-blind phase of the same
// trial. No other law goes to zero. This file reproduces that at the level of
// the law itself and, more importantly, pins WHICH of the two occupancy-
// dependent code paths is responsible, because the two call for different fixes.
//
// ─── THE TWO CANDIDATE MECHANISMS ────────────────────────────────────────
//
//   (1) The closed form degenerates. `optimalHoldSeconds` subtracts
//       (w_v x L + w_c) / (2 x w_h x lambda) from the even-headway split, and
//       with lambda PROXIED as 1/H* that penalty is L x H*/2 SECONDS PER
//       PASSENGER - 180 s each on the urban corridor's 360 s headway. `d*` is
//       floored at 0, so a bus carrying anybody asks for no hold at all and the
//       law returns before it ever scores anything.
//
//   (2) The taper clamps, and the clamped hold scores as harmful.
//       `occupancyAdjustedMaxHoldSeconds` scales `maxHoldSeconds` by
//       (1 - loadFactor), and `costOptimalHold.ts`'s self-harm check then drops
//       any candidate whose own objective scores it >= 0.
//
// Only (1) is real, and (2) cannot be: see the second test for the proof.
import { describe, it, expect } from 'vitest';
import { computeCostOptimalCandidates } from '../src/mpc/costOptimalHold.js';
import { optimalHoldSeconds, scoreHold } from '../src/mpc/objective.js';
import { occupancyAdjustedMaxHoldSeconds } from '../src/mpc/actionThreshold.js';
import { clamp } from '../src/mpc/math.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../src/state/store.js';

const NOW = new Date('2026-09-05T08:00:00.000Z');

/**
 * The urban fleet-trial corridor, which is where the zero was measured:
 * 24 km city trunk, 360 s planned headway, 120 s hold cap, 60 seats.
 * See fleetTrial/presets.ts#URBAN_CORRIDOR.
 */
function urbanPolicy(overrides: Partial<RoutePolicyRow> = {}): RoutePolicyRow {
  return {
    id: 'p-urban',
    routeDirectionId: 'fleet-trial-urban',
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: 360,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
    kf: 0.4,
    kb: 0.2,
    selfEqualizingK: 0.35,
    maxHoldSeconds: 120,
    cooldownSeconds: 60,
    minimumActionSeconds: 0,
    predictionHorizonControlPoints: 3,
    occupancyStaleSeconds: null,
    occupancyCapacity: 60,
    ks: null,
    maxLatenessSeconds: 120,
    speedBandMinKmph: null,
    speedBandMaxKmph: null,
    maxConcurrentActions: null,
    ...overrides,
  };
}

/**
 * A textbook bunch on that corridor: the follower has closed to 90 s behind
 * its leader against a 360 s target and is towing a 630 s gap behind it. The
 * even-headway split asks for a 270 s hold, which the 120 s cap trims to 120 -
 * a hold this law emits happily with occupancy off.
 */
function bunchedPair(overrides: Partial<HeadwayStateRow> = {}): HeadwayStateRow {
  return {
    id: 'h-1',
    routeDirectionId: 'fleet-trial-urban',
    leaderVehicleId: 'bus-lead',
    followerVehicleId: 'bus-follow',
    hFwdSeconds: 90,
    hBwdSeconds: 630,
    targetHeadwaySeconds: 360,
    deviationSeconds: -270,
    /** Nothing here exercises the forecast gate; a pair with no forecast is the deployed state on every corridor. */
    forecastHFwdSeconds: null,
    computedAt: NOW.toISOString(),
    ...overrides,
  };
}

/**
 * A bus dwelling at a stop with a live occupancy reading.
 *
 * `load` defaults to 29, the urban preset's documented steady state
 * (`rate x H* / 60 / alightingFraction`, about half of 60 seats) - the load a
 * bus on this corridor actually carries when it is asked to wait, not a
 * worst case chosen to make the point.
 */
function dwellingWithLoad(vehicleId: string, load: number | null): VehicleStateRow {
  return {
    vehicleId,
    routeDirectionId: 'fleet-trial-urban',
    distanceAlongRouteMeters: 8_000,
    speedKmph: 0,
    stopState: 'dwelling_at_stop',
    currentStopId: 'stop-9',
    occupancyCount: load,
    occupancyLoadBand: null,
    observedAt: NOW.toISOString(),
    isLowConfidence: false,
    confidence: 0.9,
  } as VehicleStateRow;
}

function candidatesFor(load: number | null, weighOccupancy: boolean) {
  return computeCostOptimalCandidates(
    [bunchedPair()],
    new Set(),
    urbanPolicy(),
    new Map([['bus-follow', dwellingWithLoad('bus-follow', load)]]),
    NOW,
    new Map(),
    new Set(),
    weighOccupancy,
  );
}

describe('cost_optimal under the network-wide occupancy switch', () => {
  // ─── THE REPRODUCTION ──────────────────────────────────────────────────
  //
  // Same corridor, same bunch, same bus. The only thing that moves is the
  // switch. Before the fix this returned nothing at EVERY load, including a
  // single passenger, because the closed form had already floored d* to 0.
  it('still proposes a hold for a bunched bus when occupancy weighting is on', () => {
    const blind = candidatesFor(29, false);
    expect(blind).toHaveLength(1);
    expect(blind[0]!.holdSeconds).toBe(120);

    // The closed form no longer prices the uncalibrated load, so the law has
    // something to say again. The taper binds the load on the ACTION instead:
    // a lightly loaded bus keeps nearly the whole 120 s cap.
    const light = candidatesFor(1, true);
    expect(light).toHaveLength(1);
    expect(light[0]!.holdSeconds).toBe(118);
    expect(light[0]!.objectiveCost).toBeLessThan(0);
  });

  // ─── WHAT THIS FIX DOES NOT DO, PINNED SO IT IS NOT MISREAD ────────────
  //
  // The law is restored, not made unconditional. Above about five passengers
  // it still declines - but for a DIFFERENT and legitimate reason, and the
  // distinction is the point of this test.
  //
  // The closed form is now clean. What still bites is the self-harm check:
  // `scoreHold` charges `w_v x L x d` in REAL passenger-seconds while the
  // wait term it is netted against is scaled by the SAME understated
  // lambda = 1/H*, so the objective genuinely scores these holds as harmful
  // and `cost_optimal` - alone among the five laws - declines to emit one it
  // judges harmful. That is the check doing its job on a mis-calibrated
  // objective, not the defect this change fixes.
  //
  // Removing the load from the score here as well would restore every load,
  // and must NOT be done: the other four laws all price through the same
  // `computePassengerCost`, so this law would get a systematically lower cost
  // than the candidates it is ranked against and would win a sort it is not
  // entitled to win until lambda is measured. See
  // costOptimalAndSelection.test.ts and COST_OPTIMAL_SELECTION_ENABLED.
  //
  // The remedy for the residual is calibrating lambda from real boardings, or
  // giving the other four laws the same self-check. Both are separate work.
  it('still declines a heavily loaded bus, now via the self-harm check', () => {
    for (const load of [15, 29, 55]) {
      expect(candidatesFor(load, true), `load ${load}`).toHaveLength(0);
    }

    // And the reason really is the score, not the closed form: d* is now a
    // healthy 270 s at every one of those loads.
    expect(
      optimalHoldSeconds({
        hFwdSeconds: 90,
        hBwdSeconds: 630,
        targetHeadwaySeconds: 360,
        loadPassengers: null,
      }),
    ).toBe(270);
  });

  // ─── WHICH MECHANISM: (1), NOT (2) ─────────────────────────────────────
  //
  // `optimalHoldSeconds` itself is UNCHANGED by the fix and still charges the
  // full penalty - it is a faithful argmin and is the right answer the day
  // lambda is measured. This pins why it could not be fed the live load: the
  // penalty is L x H*/2 seconds per passenger, so it returned 0 for every load
  // above one and `costOptimalHold.ts` dropped the pair at
  // `if (rawHold <= 0) continue` - twenty lines before the self-harm check the
  // original diagnosis blamed.
  it('would still degenerate to zero if the live load were fed to the argmin', () => {
    const evenHeadwaySplit = optimalHoldSeconds({
      hFwdSeconds: 90,
      hBwdSeconds: 630,
      targetHeadwaySeconds: 360,
      loadPassengers: null,
    });
    expect(evenHeadwaySplit).toBe(270);

    // L x H*/2 = 180 s cancelled per passenger on a 360 s corridor. Two
    // passengers already exceed the whole 270 s split.
    for (const load of [1, 2, 15, 29, 55]) {
      const withLoad = optimalHoldSeconds({
        hFwdSeconds: 90,
        hBwdSeconds: 630,
        targetHeadwaySeconds: 360,
        loadPassengers: load,
      });
      if (load === 1) expect(withLoad).toBe(90);
      else expect(withLoad).toBe(0);
    }
  });

  // The taper is exonerated, and this is the assertion that does it.
  //
  // A clamp can only move the hold DOWN, and the objective net of the load
  // term is lambda x d x (d - 2 d*), which is strictly negative for every
  // 0 < d < 2 d*. Clamping lands inside that window by construction, so a
  // tapered hold is always scored as still worth doing. The taper shortens
  // holds; it cannot silence the law.
  it('never scores a tapered hold as harmful, at any load', () => {
    const rawHold = optimalHoldSeconds({
      hFwdSeconds: 90,
      hBwdSeconds: 630,
      targetHeadwaySeconds: 360,
      loadPassengers: null,
    });

    for (let load = 0; load <= 60; load++) {
      const tapered = occupancyAdjustedMaxHoldSeconds(120, load, 60);
      const holdSeconds = Math.round(clamp(rawHold, 0, tapered));
      const score = scoreHold(
        { hFwdSeconds: 90, hBwdSeconds: 630, targetHeadwaySeconds: 360 },
        'bus-follow',
        holdSeconds,
        rawHold,
        null,
        null,
      );
      expect(
        score.objectiveCost,
        `taper at load ${load} produced hold ${holdSeconds}s scored ${score.objectiveCost}`,
      ).toBeLessThan(0);
    }

    // The floor is real: even a crush-loaded bus keeps a third of the cap.
    expect(occupancyAdjustedMaxHoldSeconds(120, 60, 60)).toBe(30);
  });
});
