// Alighting-only: let people off, take nobody on, because the bus behind is
// right there.
//
// ─── WHY THIS LAW IS TESTED DIFFERENTLY FROM THE HOLDS ───────────────────
//
// Every hold buys spacing with delay, and its tests are mostly about whether
// the arithmetic is right. This one buys spacing by REMOVING delay, and its
// cost falls on a specific, identifiable group: the people standing at that
// stop who watch a bus with room on it go past them.
//
// So the assertions that matter here are the refusals. A hold that fires when
// it should not costs a bus ninety seconds. This action, fired when it should
// not, is the single most visible thing a control system can do to a
// passenger - and the reputational cost of getting it wrong once is not
// recovered by getting it right a hundred times.
import { describe, it, expect } from 'vitest';
import {
  computeBoardingLimitCandidates,
  DEFAULT_MAX_LEFT_BEHIND_WAIT_SECONDS,
  maxFollowerGapSeconds,
  MIN_FOLLOWER_GAP_SECONDS,
} from '../src/mpc/boardingLimit.js';
import { isHoldAction } from '../src/mpc/types.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../src/state/store.js';

/** Bunched at 0.25 x 600 = 150s, matching the shipped policy defaults. */
function policy(overrides: Partial<RoutePolicyRow> = {}): RoutePolicyRow {
  return {
    id: 'p-1',
    routeDirectionId: 'rd-1',
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: TARGET,
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

const NOW = new Date('2026-08-20T09:00:00.000Z');
const TARGET = 600;

function headway(overrides: Partial<HeadwayStateRow> = {}): HeadwayStateRow {
  return {
    id: 'h-1',
    routeDirectionId: 'rd-1',
    leaderVehicleId: 'lead',
    followerVehicleId: 'follow',
    // 120s apart on a 600s corridor: ratio 0.2, well inside the 0.35 bar,
    // and the people left behind wait two minutes.
    hFwdSeconds: 120,
    hBwdSeconds: 600,
    targetHeadwaySeconds: TARGET,
    deviationSeconds: -480,
    /** Nothing here exercises the forecast gate; a pair with no forecast is the deployed state on every corridor. */
    forecastHFwdSeconds: null,
    computedAt: NOW.toISOString(),
    ...overrides,
  };
}

function atStop(vehicleId: string, overrides: Partial<VehicleStateRow> = {}): VehicleStateRow {
  return {
    vehicleId,
    routeDirectionId: 'rd-1',
    distanceAlongRouteMeters: 5000,
    speedKmph: 0,
    stopState: 'dwelling_at_stop',
    currentStopId: 'stop-7',
    occupancyCount: null,
    occupancyLoadBand: null,
    observedAt: NOW.toISOString(),
    isLowConfidence: false,
    confidence: 0.95,
    ...overrides,
  } as VehicleStateRow;
}

/** The leader is the bus acted on, so it is the one that must be at a stop. */
function states(leaderOverrides: Partial<VehicleStateRow> = {}) {
  return new Map<string, VehicleStateRow>([
    ['lead', atStop('lead', leaderOverrides)],
    ['follow', atStop('follow')],
  ]);
}

function run(
  states_: ReadonlyMap<string, VehicleStateRow>,
  headways: HeadwayStateRow[] = [headway()],
  deviations: ReadonlyMap<string, number | null> = new Map(),
  controlPoints: ReadonlySet<string> = new Set(),
  terminalStopId?: string,
  policyOverrides: Partial<RoutePolicyRow> = {},
) {
  return computeBoardingLimitCandidates(
    headways,
    policy(policyOverrides),
    states_,
    deviations,
    controlPoints,
    terminalStopId,
  );
}

describe('computeBoardingLimitCandidates', () => {
  // THE INVERSION. Every other law acts on the FOLLOWER - the bus that is too
  // close to the one ahead. This one acts on the LEADER, the bus with another
  // right behind it. Backwards, it would tell the empty bus to stop picking up
  // while the full one kept absorbing demand, which accelerates the bunch.
  it('acts on the leader of the pair, not the follower every hold names', () => {
    const candidates = run(states());
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.vehicleId).toBe('lead');
    expect(candidates[0]!.involvedVehicleIds).toEqual(['lead', 'follow']);
  });

  it('is not a hold, and says so in a way the safety filter can read', () => {
    const candidate = run(states())[0]!;
    expect(candidate.actionType).toBe('boarding_limit');
    expect(candidate.holdSeconds).toBe(0);
    expect(isHoldAction(candidate.actionType)).toBe(false);
  });

  it('states both sides of the trade, cost first', () => {
    const candidate = run(states())[0]!;
    expect(candidate.rationale).toContain('take none on');
    expect(candidate.rationale).toContain('left standing');
    // The benefit is honestly reported as unmeasurable rather than guessed.
    expect(candidate.estimate.dwellSavingSeconds).toBeNull();
    expect(candidate.rationale).toContain('not yet measurable');
  });

  // The wait is measured; the passenger count is not available at all.
  //
  // With lambda proxied as 1/H*, any passenger figure lands between 0 and 1
  // regardless of the corridor or the time of day - a live solve produced
  // 0.0007. Rendered, that becomes "about 1 passenger" at a stop where forty
  // people are waiting: a confident, quotable number, wrong by orders of
  // magnitude, on the one decision that visibly inconveniences passengers.
  // Null makes it impossible to show wrongly rather than merely unwise.
  it('reports the measured wait and refuses to invent a passenger count', () => {
    const candidate = run(states())[0]!;
    expect(candidate.estimate.leftBehindWaitSeconds).toBe(120);
    expect(candidate.estimate.lambdaIsProxy).toBe(true);
    expect(candidate.estimate.leftBehindPassengers).toBeNull();
    expect(candidate.estimate.imposedWaitPassengerSeconds).toBeNull();
  });

  // Zero because NEITHER side can be priced - not because it is free. Safe to
  // publish only because the solver excludes this candidate from every
  // ranking; ranked, zero would sort FIRST and read as "costs nothing".
  it('publishes an unpriced cost of zero, and is kept out of every ranking', () => {
    const candidate = run(states())[0]!;
    expect(candidate.objectiveCost).toBe(0);
    expect(candidate.passengerCost.netPassengerSeconds).toBe(0);
    expect(candidate.passengerCost.loadEstimated).toBe(true);
  });

  // Below this the two buses are one position reported twice - a live solve
  // produced a 0.675s gap. Separating a bus from itself refuses passengers
  // for nothing.
  it('refuses a sub-minute gap that is a measurement artefact rather than two buses', () => {
    expect(run(states(), [headway({ hFwdSeconds: 0.675 })])).toHaveLength(0);
    expect(run(states(), [headway({ hFwdSeconds: MIN_FOLLOWER_GAP_SECONDS - 1 })])).toHaveLength(0);
    expect(run(states(), [headway({ hFwdSeconds: MIN_FOLLOWER_GAP_SECONDS })])).toHaveLength(1);
  });

  it('states a short wait in seconds rather than rounding it up to a minute', () => {
    const short = run(states(), [headway({ hFwdSeconds: 40 })])[0]!;
    expect(short.rationale).toContain('waits 40s');
    const long = run(states(), [headway({ hFwdSeconds: 120 })])[0]!;
    expect(long.rationale).toContain('waits about 2 min');
  });

  it('offers the tightest pair first, because that is the one imposing the shortest wait', () => {
    const candidates = run(
      new Map<string, VehicleStateRow>([
        ['lead-a', atStop('lead-a')],
        ['lead-b', atStop('lead-b')],
        ['follow-a', atStop('follow-a')],
        ['follow-b', atStop('follow-b')],
      ]),
      [
        headway({ id: 'h-a', leaderVehicleId: 'lead-a', followerVehicleId: 'follow-a', hFwdSeconds: 140 }),
        headway({ id: 'h-b', leaderVehicleId: 'lead-b', followerVehicleId: 'follow-b', hFwdSeconds: 60 }),
      ],
    );
    expect(candidates.map((c) => c.vehicleId)).toEqual(['lead-b', 'lead-a']);
  });

  // The same leader can appear in several pairs at once - the boot-time
  // rehydrate keeps the latest sample per (leader, follower) across all
  // history, so a bus that had a different follower an hour ago is still
  // carrying that pair. A live solve produced three proposals naming one
  // vehicle. Those are not three options; they are one instruction that
  // cannot be followed.
  it('never proposes the same bus twice, and keeps the most urgent pairing', () => {
    const candidates = run(
      new Map<string, VehicleStateRow>([
        ['lead', atStop('lead')],
        ['follow-old', atStop('follow-old')],
        ['follow-now', atStop('follow-now')],
      ]),
      [
        headway({ id: 'h-old', followerVehicleId: 'follow-old', hFwdSeconds: 140 }),
        headway({ id: 'h-now', followerVehicleId: 'follow-now', hFwdSeconds: 45 }),
      ],
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.estimate.leftBehindWaitSeconds).toBe(45);
  });

  // ─── THE PLATOON CASE ──────────────────────────────────────────────────
  //
  // Bunching is not always two buses. Four in a row (A B C D) produce THREE
  // consecutive pairs - (A,B), (B,C), (C,D) - so B and C are each a follower
  // of the pair ahead and a leader of the pair behind at the same time.
  //
  // Without the front-of-bunch guard, B and C were proposed a hold (correct:
  // they are too close to the bus ahead) AND drop-off-only (as leaders),
  // which is the opposite instruction to the same driver at the same stop.
  //
  // The guard encodes the assumption the action rests on: a leader that is
  // itself bunched did not arrive after a normal gap, so its stop is not full
  // of waiting passengers and its dwell is not what is dragging it late.
  it('proposes this only for the bus at the head of a bunch, never one in the middle', () => {
    const platoon = new Map<string, VehicleStateRow>([
      ['A', atStop('A')],
      ['B', atStop('B')],
      ['C', atStop('C')],
      ['D', atStop('D')],
    ]);
    const gap = 60; // ratio 0.1 - severely bunched
    const candidates = run(platoon, [
      headway({ id: 'ab', leaderVehicleId: 'A', followerVehicleId: 'B', hFwdSeconds: gap }),
      headway({ id: 'bc', leaderVehicleId: 'B', followerVehicleId: 'C', hFwdSeconds: gap }),
      headway({ id: 'cd', leaderVehicleId: 'C', followerVehicleId: 'D', hFwdSeconds: gap }),
    ]);

    // A only. B and C lead a pair but are themselves bunched; D leads nothing.
    expect(candidates.map((c) => c.vehicleId)).toEqual(['A']);
  });

  it('lets a leader act once the bus in front of it is properly clear', () => {
    const states_ = new Map<string, VehicleStateRow>([
      ['A', atStop('A')],
      ['B', atStop('B')],
      ['C', atStop('C')],
    ]);
    // B is 900s behind A - a healthy gap - and C is right on B's tail.
    const candidates = run(states_, [
      headway({ id: 'ab', leaderVehicleId: 'A', followerVehicleId: 'B', hFwdSeconds: 900 }),
      headway({ id: 'bc', leaderVehicleId: 'B', followerVehicleId: 'C', hFwdSeconds: 60 }),
    ]);
    expect(candidates.map((c) => c.vehicleId)).toEqual(['B']);
  });

  // ─── THE REFUSALS ──────────────────────────────────────────────────────

  // A pair that merely qualifies as "bunched" gets a hold. Making passengers
  // pay for the fix needs a higher bar than reporting the problem does.
  it('refuses a pair that is only mildly closed up', () => {
    // One second wider than this corridor calls bunched.
    const threshold = maxFollowerGapSeconds(policy());
    expect(threshold).toBe(150);
    expect(run(states(), [headway({ hFwdSeconds: threshold + 1 })])).toHaveLength(0);
    expect(run(states(), [headway({ hFwdSeconds: threshold })])).toHaveLength(1);
  });

  // The bar for making passengers pay must never be looser than the bar for
  // calling the pair bunched. A corridor tuned to a stricter threshold gets a
  // stricter bar here, automatically.
  it('follows the corridor down when its bunched threshold is tightened', () => {
    const stillBunchedByDefault = headway({ hFwdSeconds: 140 });
    expect(run(states(), [stillBunchedByDefault])).toHaveLength(1);
    expect(
      run(states(), [stillBunchedByDefault], new Map(), new Set(), undefined, {
        bunchedThresholdRatio: 0.2, // 120s
      }),
    ).toHaveLength(0);
  });

  // THE ONE THAT MATTERS MOST. The bound is absolute seconds, not a ratio of
  // headway - on a 1800s corridor, "25% of target" is a 450s wait for someone
  // who just watched a bus refuse them, and no spacing benefit is worth that.
  it('refuses when the people left standing would wait too long, however bunched the pair', () => {
    const longCorridor = headway({ targetHeadwaySeconds: 1800, hFwdSeconds: 300 });
    // Ratio 0.17 - comfortably inside the 0.25 bunched threshold, which on a
    // 1800s corridor permits a 450s gap. So the RATIO check passes and only
    // the absolute cap refuses this. That is the whole point of having an
    // absolute bound: harm to a person is measured in minutes of their life,
    // not as a fraction of a headway.
    expect(maxFollowerGapSeconds(policy({ targetHeadwaySeconds: 1800 }))).toBe(450);
    expect(DEFAULT_MAX_LEFT_BEHIND_WAIT_SECONDS).toBeLessThan(300);
    expect(
      run(states(), [longCorridor], new Map(), new Set(), undefined, { targetHeadwaySeconds: 1800 }),
    ).toHaveLength(0);
  });

  // People START journeys at a terminal. There is no "take the next one in two
  // minutes" - there is a queue whose trip has not begun, and refusing them is
  // refusing the service rather than rebalancing it.
  it('never does this at a terminal', () => {
    expect(
      run(states({ currentStopId: 'stop-terminal' }), [headway()], new Map(), new Set(), 'stop-terminal'),
    ).toHaveLength(0);
  });

  // The justification is that the leader is losing time it needs back. A bus
  // running AHEAD has time in hand and should be spending it at the stop.
  it('refuses when the leader is already early', () => {
    expect(run(states(), [headway()], new Map([['lead', -120]]))).toHaveLength(0);
  });

  it('still fires when no timetable exists, on the bunching evidence alone', () => {
    // Every corridor is in this state today. Requiring a schedule would make
    // the law structurally silent rather than merely cautious.
    const candidates = run(states(), [headway()], new Map([['lead', null]]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.passengerCost.scheduleUnknown).toBe(true);
  });

  it('fires for a leader that is genuinely late', () => {
    const candidates = run(states(), [headway()], new Map([['lead', 420]]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.scheduleDeviationSeconds).toBe(420);
    expect(candidates[0]!.rationale).toContain('7 min behind schedule');
  });

  // The instruction is given to a driver at a stop. A bus mid-link cannot act
  // on "take nobody on here".
  it('refuses when the leader is not at a stop to act on it', () => {
    expect(run(states({ stopState: 'departed_stop', speedKmph: 40 }))).toHaveLength(0);
  });

  it('respects designated control points when a corridor has them', () => {
    expect(run(states(), [headway()], new Map(), new Set(['stop-99']))).toHaveLength(0);
    expect(run(states(), [headway()], new Map(), new Set(['stop-7']))).toHaveLength(1);
  });

  it('says nothing about a pair whose gap could not be measured', () => {
    expect(run(states(), [headway({ hFwdSeconds: null })])).toHaveLength(0);
  });
});
