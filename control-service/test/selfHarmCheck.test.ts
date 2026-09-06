// The self-harm check on the four laws that never had one.
//
// `cost_optimal` has scored its own proposed action against the passenger-cost
// objective and refused to emit a hold that objective prices as harmful since
// it was written (`mpc/costOptimalHold.ts`, `if (score.objectiveCost >= 0)
// continue`). The other four laws price their candidate through the SAME
// `computePassengerCost` and then emit it whatever the answer.
//
// That is not a hypothetical gap. On the urban fleet trial with occupancy
// weighting ON, `occupancyContrast.meanObjectiveCostAware` is +1,028.8
// passenger-seconds, and that is the price of the SELECTED candidates - which
// are exactly these laws' holds, because `COST_OPTIMAL_SELECTION_ENABLED`
// defaults false and `cost_optimal` is therefore never selected.
//
// These tests pin the MECHANISM only: with the switch on, a hold the objective
// scores >= 0 is declined by the law that proposed it. Whether declining it is
// an improvement is a question about the objective, not about this code, and it
// is answered by measurement in docs/SELF_HARM_CHECK.md - where the answer is
// NO on every corridor. See `SELF_HARM_CHECK_ENABLED` in config/env.ts.
import { describe, it, expect } from 'vitest';
import { computeTwoWayCandidates } from '../src/mpc/twoWayHold.js';
import { computeSelfEqualizingCandidates } from '../src/mpc/selfEqualizing.js';
import { computeTerminalDispatchCandidates } from '../src/mpc/terminalDispatch.js';
import { computeBoardingLimitCandidates } from '../src/mpc/boardingLimit.js';
import { isScoredSelfHarmful } from '../src/mpc/selfHarmCheck.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../src/state/store.js';

const NOW = new Date('2026-09-05T08:00:00.000Z');

/** The urban fleet-trial corridor - see fleetTrial/presets.ts#URBAN_CORRIDOR. */
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
 * A textbook bunch on that corridor: the follower has closed to 90 s behind its
 * leader against a 360 s target, towing a 630 s gap behind it. Identical to the
 * fixture in `costOptimalOccupancy.test.ts`, deliberately - the whole question
 * here is what the OTHER laws do with the pair that one already declines.
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
    computedAt: NOW.toISOString(),
    ...overrides,
  };
}

/**
 * A bus dwelling at a stop carrying `load`.
 *
 * 29 is the urban preset's documented steady state (about half of 60 seats) -
 * the load a bus on this corridor actually carries when it is asked to wait,
 * not a worst case chosen to make the point.
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

const LOADED = new Map([['bus-follow', dwellingWithLoad('bus-follow', 29)]]);

describe('two_way declines a hold its own objective prices as harmful', () => {
  it('emits the harmful hold with the check off, and declines it with the check on', () => {
    const off = computeTwoWayCandidates(
      [bunchedPair()], new Set(), urbanPolicy(), LOADED, NOW, new Map(), new Set(), true, false,
    );
    // Today's behaviour, and the thing being questioned: the law emits a hold
    // its own score calls net-harmful.
    expect(off).toHaveLength(1);
    expect(off[0]!.objectiveCost).toBeGreaterThanOrEqual(0);

    const on = computeTwoWayCandidates(
      [bunchedPair()], new Set(), urbanPolicy(), LOADED, NOW, new Map(), new Set(), true, true,
    );
    expect(on).toHaveLength(0);
  });

  it('still emits a hold the objective prices as beneficial', () => {
    // The same law, the same switch, an empty bus. With no load to charge, the
    // wait term wins and the score goes negative - so the check must not fire.
    const empty = new Map([['bus-follow', dwellingWithLoad('bus-follow', 0)]]);
    const on = computeTwoWayCandidates(
      [bunchedPair()], new Set(), urbanPolicy(), empty, NOW, new Map(), new Set(), true, true,
    );
    expect(on).toHaveLength(1);
    expect(on[0]!.objectiveCost).toBeLessThan(0);
  });
});

describe('self_equalizing declines a hold its own objective prices as harmful', () => {
  // Self-equalizing only takes pairs two-way could not, so the pair must have
  // no h_bwd for this law to see it at all - see mpc/selfEqualizing.ts.
  const pair = bunchedPair({ hBwdSeconds: null });

  it('emits the harmful hold with the check off, and declines it with the check on', () => {
    const off = computeSelfEqualizingCandidates(
      [pair], new Set(), urbanPolicy(), LOADED, NOW, new Map(), new Set(), true, false,
    );
    expect(off).toHaveLength(1);
    expect(off[0]!.objectiveCost).toBeGreaterThanOrEqual(0);

    const on = computeSelfEqualizingCandidates(
      [pair], new Set(), urbanPolicy(), LOADED, NOW, new Map(), new Set(), true, true,
    );
    expect(on).toHaveLength(0);
  });
});

describe('terminal_dispatch declines a hold its own objective prices as harmful', () => {
  // Algorithm A regulates the ELAPSED departure headway and is deliberately not
  // gated by the mid-route action bar, so this fixture is a bus standing AT the
  // terminal 90 s after the previous one pulled out.
  const terminalStopId = 'stop-0';
  const atTerminal = (load: number | null) =>
    new Map([
      [
        'bus-follow',
        { ...dwellingWithLoad('bus-follow', load), currentStopId: terminalStopId, distanceAlongRouteMeters: 0 },
      ],
    ]) as Map<string, VehicleStateRow>;

  it('emits the harmful hold with the check off, and declines it with the check on', () => {
    const off = computeTerminalDispatchCandidates(
      [bunchedPair()], atTerminal(29), terminalStopId, urbanPolicy(), NOW, new Map(), true, 90, false,
    );
    expect(off).toHaveLength(1);
    expect(off[0]!.objectiveCost).toBeGreaterThanOrEqual(0);

    const on = computeTerminalDispatchCandidates(
      [bunchedPair()], atTerminal(29), terminalStopId, urbanPolicy(), NOW, new Map(), true, 90, true,
    );
    expect(on).toHaveLength(0);
  });

  it('still emits a hold the objective prices as beneficial', () => {
    const on = computeTerminalDispatchCandidates(
      [bunchedPair()], atTerminal(0), terminalStopId, urbanPolicy(), NOW, new Map(), true, 90, true,
    );
    expect(on).toHaveLength(1);
    expect(on[0]!.objectiveCost).toBeLessThan(0);
  });
});

describe('boarding_limit cannot take this check, and the check must not silence it', () => {
  // ─── THE ONE OF THE FOUR THAT HAS NO PRICE TO CHECK ────────────────────
  //
  // `mpc/boardingLimit.ts` sets `objectiveCost: 0` as a documented placeholder:
  // its cost (passengers left standing) needs lambda and its benefit (the dwell
  // the leader sheds) needs a fitted dwell model, so NEITHER side is priced.
  // Zero there means "nobody has measured this", not "this action is free" and
  // not "this action breaks even".
  //
  // `cost_optimal`'s guard is `objectiveCost >= 0`, and 0 satisfies it. Applying
  // that predicate here would decline 100% of alighting-only proposals on every
  // corridor forever - deleting a law on the strength of a sentinel. That is not
  // the same protection `cost_optimal` has; it is a different thing wearing its
  // name. So the check is not applied to this law, and this test is what stops
  // a later reader "finishing the job" by adding it.
  const leaderAtStop = new Map<string, VehicleStateRow>([
    ['bus-lead', dwellingWithLoad('bus-lead', 40)],
    ['bus-follow', dwellingWithLoad('bus-follow', 29)],
  ]);
  const tightPair = bunchedPair({ hFwdSeconds: 60, hBwdSeconds: 630 });

  it('prices every proposal at exactly zero, which the check would read as harmful', () => {
    const candidates = computeBoardingLimitCandidates(
      [tightPair], urbanPolicy(), leaderAtStop, new Map(), new Set(), undefined,
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.objectiveCost === 0)).toBe(true);

    // The whole reason this law is excluded, stated as an assertion: the
    // predicate `cost_optimal` uses is TRUE of the sentinel this law emits, so
    // wiring it in here would decline every alighting-only proposal ever made.
    expect(candidates.every((c) => isScoredSelfHarmful(c.objectiveCost))).toBe(true);
  });
});

// ─── THE COVERAGE TABLE HAS TO SAY WHAT HAPPENED ──────────────────────────
//
// CLAUDE.md: read the algorithm-coverage half of any report before believing
// its KPI half. A law silenced by the check generates nothing, which from the
// outside is indistinguishable from a law whose preconditions were never met -
// and the ladder in `deployedControlLaws.ts` would report every one of those
// declines as `no_hold_indicated`, which is untrue in the way that matters:
// the law DID indicate a hold and the objective refused it. `not_deviant_enough`
// was added to that ladder for exactly this reason once before.
describe('a law silenced by the check says so in its coverage record', () => {
  it('reports scored_self_harmful, not no_hold_indicated', async () => {
    const { createDeployedControlLawsController } = await import(
      '../src/rehearsal/deployedControlLaws.js'
    );

    const options = {
      // 900 s target, Kf 0.6 / Kb 0.3, 90 s cap, 52 seats - the rehearsal
      // fixture in test/rehearsal/deployedControlLaws.test.ts, which produces a
      // two-way hold of exactly 90 s on this chain.
      policy: urbanPolicy({
        routeDirectionId: 'rd-1',
        targetHeadwaySeconds: 900,
        kf: 0.6,
        kb: 0.3,
        selfEqualizingK: 0.5,
        maxHoldSeconds: 90,
        occupancyCapacity: null,
        maxLatenessSeconds: null,
      }),
      epochMs: Date.UTC(2026, 0, 1),
      modelledCapacity: 52,
      weighOccupancy: true,
    };
    const context = {
      routeDirectionId: 'rd-1',
      stopId: 'stop-5',
      vehicleId: 'SIM-02',
      now: 3600,
      leaderHeadwaySeconds: 120,
      targetHeadwaySeconds: 900,
      maxHoldSeconds: 90,
      isStateStale: false,
      onboardCount: 30,
      kinematics: {
        follower: { vehicleId: 'SIM-02', distanceAlongRouteMeters: 10_000, speedKmph: 60 },
        leader: { vehicleId: 'SIM-01', distanceAlongRouteMeters: 12_000, speedKmph: 6 },
        trailer: { vehicleId: 'SIM-03', distanceAlongRouteMeters: 8_000, speedKmph: 6 },
        corridor: [
          { vehicleId: 'SIM-01', distanceAlongRouteMeters: 12_000, speedKmph: 6 },
          { vehicleId: 'SIM-02', distanceAlongRouteMeters: 10_000, speedKmph: 60 },
          { vehicleId: 'SIM-03', distanceAlongRouteMeters: 8_000, speedKmph: 6 },
        ],
        totalDistanceMeters: 200_000,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const unchecked = createDeployedControlLawsController({ ...options, selfHarmCheckEnabled: false });
    unchecked.decide(context);
    // The law fires today, and the hold it emits is one its own objective
    // prices as harmful - which is the whole finding.
    expect(unchecked.decisions[0]!.coverage.generated.two_way).toBe(1);

    const checked = createDeployedControlLawsController({ ...options, selfHarmCheckEnabled: true });
    checked.decide(context);
    const coverage = checked.decisions[0]!.coverage;
    expect(coverage.generated.two_way).toBe(0);
    expect(coverage.declined.two_way).toBe('scored_self_harmful');
  });
});
