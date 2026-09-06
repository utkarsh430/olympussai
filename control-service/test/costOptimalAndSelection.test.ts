// The closed-form hold, and how many instructions one corridor may get at once.
//
// Two changes are covered here and they pull in opposite directions, which is
// why they are tested together:
//
//   * A FOURTH control law that computes the exact minimiser of the passenger
//     cost - the only candidate derived from the operator's priorities rather
//     than tuned to approximate them.
//   * A selection policy that may now return several actions, where it used to
//     return one and starve every problem after the first.
//
// The load-bearing assertions are the restraints on both: that the closed form
// cannot win a sort it is guaranteed to win until the parameter it depends on
// is measured, and that no bus can ever be named twice in one cycle.
import { describe, it, expect } from 'vitest';
import { computeCostOptimalCandidates, MIN_MEANINGFUL_HOLD_SECONDS } from '../src/mpc/costOptimalHold.js';
import { optimalHoldSeconds } from '../src/mpc/objective.js';
import { selectActions, DEFAULT_MAX_CONCURRENT_ACTIONS } from '../src/mpc/solver.js';
import type { CandidateAction } from '../src/mpc/types.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../src/state/store.js';

const NOW = new Date('2026-08-20T06:00:00.000Z');

function policy(overrides: Partial<RoutePolicyRow> = {}): RoutePolicyRow {
  return {
    id: 'p-1',
    routeDirectionId: 'rd-1',
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: 600,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
    kf: 0.4,
    kb: 0.2,
    selfEqualizingK: 0.35,
    maxHoldSeconds: 600,
    cooldownSeconds: 60,
    minimumActionSeconds: 0,
    predictionHorizonControlPoints: 3,
    occupancyStaleSeconds: null,
    occupancyCapacity: null,
    ks: null,
    maxLatenessSeconds: null,
    speedBandMinKmph: null,
    speedBandMaxKmph: null,
    maxConcurrentActions: null,
    ...overrides,
  };
}

function headway(overrides: Partial<HeadwayStateRow> = {}): HeadwayStateRow {
  return {
    id: 'h-1',
    routeDirectionId: 'rd-1',
    leaderVehicleId: 'lead',
    followerVehicleId: 'follow',
    hFwdSeconds: 300,
    hBwdSeconds: 900,
    targetHeadwaySeconds: 600,
    deviationSeconds: -300,
    computedAt: NOW.toISOString(),
    ...overrides,
  };
}

/** A bus dwelling at a stop, i.e. one that could actually take a hold. */
function atStop(vehicleId: string): VehicleStateRow {
  return {
    vehicleId,
    routeDirectionId: 'rd-1',
    distanceAlongRouteMeters: 1000,
    speedKmph: 0,
    stopState: 'dwelling_at_stop',
    currentStopId: 'stop-5',
    occupancyCount: null,
    occupancyLoadBand: null,
    observedAt: NOW.toISOString(),
    isLowConfidence: false,
    confidence: 0.9,
  } as VehicleStateRow;
}

describe('computeCostOptimalCandidates', () => {
  // d* = (h_bwd - h_fwd)/2 with no load and no operator weight: the even
  // headway split. 300s ahead, 900s behind -> 300s of hold evens both to 600.
  it('computes the even-headway split when nothing is aboard to weigh against it', () => {
    const candidates = computeCostOptimalCandidates(
      [headway()],
      new Set(),
      policy(),
      new Map([['follow', atStop('follow')]]),
      NOW,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.actionType).toBe('cost_optimal_hold');
    expect(candidates[0]!.holdSeconds).toBe(300);
    // The optimum of a cost function must reduce that cost.
    expect(candidates[0]!.objectiveCost).toBeLessThan(0);
  });

  // ─── THE CALIBRATION LANDMINE, DEFUSED ─────────────────────────────────
  //
  // This assertion used to run the other way, and the reversal is deliberate.
  //
  // It previously pinned that a SINGLE onboard passenger silenced this law,
  // and that pin was correct for as long as it stood: the closed form was fed
  // the live load, the penalty it subtracts is
  //
  //     (w_v x L + w_c) / (2 x w_h x lambda)
  //
  // and with lambda PROXIED as 1/H* that is H*/2 seconds cancelled PER
  // PASSENGER - 300 s on this 600 s corridor. One person aboard wiped out the
  // even-headway split. Recording that as the expected behaviour was the right
  // call while `occupancy_count` was NULL on every seeded corridor, because the
  // hazard was inert and the test was documenting it rather than endorsing it.
  //
  // The test's own comment named the day it would come due: "It stops being
  // inert on the day occupancy is connected, and the failure is silent." That
  // day arrived. Three fleet trials on the urban, suburban and intercity
  // presets each reported `lawCoverage` of exactly 0 for `cost_optimal` in the
  // occupancy-weighed phase, against 310-578 generating decisions in the blind
  // phase of the same trial - a controller that had quietly stopped proposing
  // anything, looking exactly like a network with no problems.
  //
  // What changed is NOT that lambda was calibrated. It has not been, and the
  // restraint this file exists to enforce is untouched: `cost_optimal` still
  // prices its candidate through the same `computePassengerCost` as the other
  // four laws, still carries the load in that score, and still cannot win a
  // sort it is not entitled to win. What changed is that the uncalibrated term
  // is no longer fed to the ARGMIN, where it could only ever delete the law.
  // The load now binds on the action through
  // `actionThreshold.ts#occupancyAdjustedMaxHoldSeconds`, which can shorten a
  // hold and can never invert one. See costOptimalOccupancy.test.ts for the
  // reproduction, the mechanism, and what the fix deliberately leaves alone.
  it('is no longer silenced by a single onboard passenger', () => {
    // The urban fleet-trial corridor, which is where the zero was measured:
    // 360 s headway, 120 s cap, 60 seats (fleetTrial/presets.ts#URBAN_CORRIDOR).
    const urban = policy({ targetHeadwaySeconds: 360, maxHoldSeconds: 120, occupancyCapacity: 60 });
    const bunched = headway({ hFwdSeconds: 90, hBwdSeconds: 630, targetHeadwaySeconds: 360 });
    const onePassenger = { ...atStop('follow'), occupancyCount: 1 } as VehicleStateRow;

    const loaded = computeCostOptimalCandidates(
      [bunched], new Set(), urban, new Map([['follow', onePassenger]]), NOW,
    );
    // Was zero before the fix. The argmin is no longer handed the uncalibrated
    // load, so d* = (630 - 90)/2 = 270 s survives; the taper - not the argmin -
    // is what the passenger costs the hold, scaling the 120 s cap to 118 s.
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.holdSeconds).toBe(118);
    expect(loaded[0]!.objectiveCost).toBeLessThan(0);
  });

  // ─── AND THE RESTRAINT THAT DID NOT MOVE ───────────────────────────────
  //
  // The fix is to the ARGMIN only. The SCORE still carries the load, through
  // the same `computePassengerCost` the other four laws price with, so this
  // law still declines whenever that score says the hold is harmful - which,
  // with lambda proxied as 1/H*, it still often does. What has changed is the
  // reason: a healthy d* now reaching a check that judges it, rather than an
  // argmin flattened to zero before anything was judged at all.
  //
  // This is the assertion that stops the fix being "tidied" into removing the
  // load from the score as well. That would restore every load and hand this
  // law a systematically lower cost than the candidates it is sorted against
  // - the sort it must not win until lambda is measured.
  it('still declines when its own score says the hold is harmful, with d* healthy', () => {
    const busy = { ...atStop('follow'), occupancyCount: 30 } as VehicleStateRow;
    expect(
      computeCostOptimalCandidates(
        [headway()], new Set(), policy({ occupancyCapacity: 60 }),
        new Map([['follow', busy]]), NOW,
      ),
    ).toHaveLength(0);

    // Not because the closed form collapsed: the even-headway split is intact.
    expect(
      optimalHoldSeconds({ hFwdSeconds: 300, hBwdSeconds: 900, targetHeadwaySeconds: 600, loadPassengers: null }),
    ).toBe(300);
  });

  // ─── THE REFUSALS ──────────────────────────────────────────────────────

  // Without h_bwd the closed form collapses to half the forward shortfall,
  // which is a different and worse controller wearing the optimum's name.
  // selfEqualizing.ts owns that case.
  it('says nothing about a pair whose bus behind is unobserved', () => {
    expect(
      computeCostOptimalCandidates(
        [headway({ hBwdSeconds: null })], new Set(), policy(),
        new Map([['follow', atStop('follow')]]), NOW,
      ),
    ).toHaveLength(0);
  });

  // A hold is executed by standing still at a stop; naming one to a bus doing
  // 45 km/h mid-link is an instruction its driver cannot follow.
  it('says nothing about a bus that could not execute a hold', () => {
    const moving = { ...atStop('follow'), stopState: 'departed_stop', speedKmph: 45 } as VehicleStateRow;
    expect(
      computeCostOptimalCandidates(
        [headway()], new Set(), policy(), new Map([['follow', moving]]), NOW,
      ),
    ).toHaveLength(0);
  });

  it('says nothing about a bus already regulated by terminal dispatch', () => {
    expect(
      computeCostOptimalCandidates(
        [headway()], new Set(['follow']), policy(),
        new Map([['follow', atStop('follow')]]), NOW,
      ),
    ).toHaveLength(0);
  });

  // A driver asked to wait nine seconds will not measure it, and the request
  // spends the willingness to take the next instruction seriously.
  it('says nothing when the optimal hold is too short to be worth asking for', () => {
    const barelyBunched = headway({ hFwdSeconds: 590, hBwdSeconds: 610 }); // d* = 10s
    const candidates = computeCostOptimalCandidates(
      [barelyBunched], new Set(), policy(), new Map([['follow', atStop('follow')]]), NOW,
    );
    expect(MIN_MEANINGFUL_HOLD_SECONDS).toBeGreaterThan(10);
    expect(candidates).toHaveLength(0);
  });

  // A clamped optimum is just another feasible point. If the cap has pulled it
  // far enough that the objective scores it as harmful, it must not appear on
  // a list sorted by that objective.
  it('never emits a candidate its own objective says makes things worse', () => {
    const candidates = computeCostOptimalCandidates(
      [headway({ hFwdSeconds: 100, hBwdSeconds: 1800 })],
      new Set(),
      policy({ maxHoldSeconds: 20 }), // clamps d*=850 down to 20
      new Map([['follow', atStop('follow')]]),
      NOW,
    );
    expect(candidates.every((c) => c.objectiveCost < 0)).toBe(true);
  });
});

function candidate(overrides: Partial<CandidateAction> = {}): CandidateAction {
  return {
    actionType: 'two_way_hold',
    vehicleId: 'veh-1',
    involvedVehicleIds: ['veh-1', 'lead'],
    holdSeconds: 120,
    objectiveCost: -100,
    clampResidualSeconds: 0,
    passengerCost: {
      waitPassengerSeconds: -100,
      onboardPassengerSeconds: 0,
      operatorPassengerSeconds: 0,
      latenessPassengerSeconds: 0,
      netPassengerSeconds: -100,
      loadEstimated: true,
      backwardEstimated: false,
      scheduleUnknown: true,
    },
    rationale: 'test',
    scheduleDeviationSeconds: null,
    routeDirectionId: 'rd-1',
    stateAsOf: NOW.toISOString(),
    headwayDeviationSeconds: -300,
    targetHeadwaySeconds: 600,
    ...overrides,
  };
}

describe('selectActions', () => {
  // The change this makes: a corridor with three problems gets three
  // instructions, not one and a two-cycle queue behind it.
  it('proposes one action per bunched pair, up to the cap', () => {
    const midRoute = [
      candidate({ vehicleId: 'veh-1', objectiveCost: -300 }),
      candidate({ vehicleId: 'veh-2', objectiveCost: -200 }),
      candidate({ vehicleId: 'veh-3', objectiveCost: -100 }),
    ];
    const selected = selectActions([], midRoute, 3, false);
    expect(selected.map((c) => c.vehicleId)).toEqual(['veh-1', 'veh-2', 'veh-3']);
  });

  it('honours a corridor that will only accept one instruction at a time', () => {
    const midRoute = [candidate({ vehicleId: 'veh-1' }), candidate({ vehicleId: 'veh-2' })];
    expect(selectActions([], midRoute, 1, false)).toHaveLength(1);
  });

  // THE LOAD-BEARING ONE. Three laws key on the same follower, so the same
  // bus routinely appears two or three times in the safe pool with different
  // hold lengths. "Hold veh-1 for 90s" and "hold veh-1 for 140s" together is
  // not two options - it is one instruction nobody can follow.
  it('never names the same bus twice, however many laws proposed it', () => {
    const midRoute = [
      candidate({ vehicleId: 'veh-1', holdSeconds: 90, objectiveCost: -300 }),
      candidate({ vehicleId: 'veh-1', holdSeconds: 140, actionType: 'self_equalizing_hold', objectiveCost: -250 }),
      candidate({ vehicleId: 'veh-2', objectiveCost: -100 }),
    ];
    const selected = selectActions([], midRoute, 3, false);
    expect(selected).toHaveLength(2);
    expect(selected[0]).toMatchObject({ vehicleId: 'veh-1', holdSeconds: 90 });
    expect(selected[1]!.vehicleId).toBe('veh-2');
  });

  // A terminal hold costs no passenger their seat and no driver their
  // schedule, so it is always the cheapest place to spend a correction -
  // even when a mid-route candidate scores better on passenger-seconds.
  it('keeps terminal dispatch ahead of a better-scoring mid-route hold', () => {
    const terminal = [candidate({ vehicleId: 'veh-t', actionType: 'terminal_dispatch_hold', objectiveCost: -10 })];
    const midRoute = [candidate({ vehicleId: 'veh-m', objectiveCost: -900 })];
    expect(selectActions(terminal, midRoute, 3, false)[0]!.vehicleId).toBe('veh-t');
  });

  // The closed form is the argmin of the ranking function, so it wins every
  // sort by construction. Until lambda is measured that is a claim the
  // deployment cannot support, so it is shown and not selected.
  it('will not select a cost-optimal hold while lambda is still a proxy', () => {
    const midRoute = [
      candidate({ vehicleId: 'veh-1', actionType: 'cost_optimal_hold', objectiveCost: -900 }),
      candidate({ vehicleId: 'veh-2', actionType: 'two_way_hold', objectiveCost: -100 }),
    ];
    const selected = selectActions([], midRoute, 3, false);
    expect(selected.map((c) => c.actionType)).toEqual(['two_way_hold']);
  });

  it('does select it once the calibration is declared', () => {
    const midRoute = [
      candidate({ vehicleId: 'veh-1', actionType: 'cost_optimal_hold', objectiveCost: -900 }),
      candidate({ vehicleId: 'veh-2', actionType: 'two_way_hold', objectiveCost: -100 }),
    ];
    expect(selectActions([], midRoute, 3, true)[0]!.actionType).toBe('cost_optimal_hold');
  });

  it('proposes nothing when nothing is safe', () => {
    expect(selectActions([], [], DEFAULT_MAX_CONCURRENT_ACTIONS, false)).toEqual([]);
  });
});
