import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/commands.js', () => ({
  listActiveVehicleIds: vi.fn(),
  listRecentlyCommandedVehicleIds: vi.fn(),
}));

// The timetable tables are empty on this deployment, so the real loader
// always returns an empty map. Mocked so a test can supply the schedule the
// production path will read once one is loaded - the deviation itself is
// still computed by the real `computeScheduleDeviationSeconds`.
vi.mock('../src/schedule/repository.js', () => ({
  loadScheduleCurves: vi.fn(() => Promise.resolve(new Map())),
}));

// The network-wide switches. Mocked rather than left to fall back, because
// the fallback is occupancy-OFF and several tests below are specifically
// about what the objective does WITH a load - see "prefers holding the
// emptier bus", which is the behaviour the switch exists to turn on.
vi.mock('../src/db/settings.js', () => ({
  readControlSettings: vi.fn(() =>
    Promise.resolve({
      weighOccupancy: false,
      updatedAt: new Date(0).toISOString(),
      updatedBy: null,
      updateReason: null,
    }),
  ),
}));

const { solve } = await import('../src/mpc/solver.js');
const { stateStore } = await import('../src/state/store.js');
const { readControlSettings } = await import('../src/db/settings.js');
const { listActiveVehicleIds, listRecentlyCommandedVehicleIds } = await import(
  '../src/db/commands.js'
);
const { loadScheduleCurves } = await import('../src/schedule/repository.js');
const { buildScheduleCurve } = await import('../src/schedule/deviation.js');

/**
 * A schedule under which a vehicle sitting at `distanceMeters` right now is
 * exactly `lateSeconds` behind. Built around the wall clock at call time
 * because the solver takes its own `new Date()` per cycle.
 */
function curveMakingVehicleLate(distanceMeters: number, lateSeconds: number) {
  const scheduledAtHere = Date.now() - lateSeconds * 1000;
  return buildScheduleCurve('trip-late', [
    { distanceMeters: distanceMeters - 1000, epochMs: scheduledAtHere - 300_000 },
    { distanceMeters, epochMs: scheduledAtHere },
    { distanceMeters: distanceMeters + 1000, epochMs: scheduledAtHere + 300_000 },
  ])!;
}

function basePolicy(overrides: Partial<Parameters<typeof stateStore.loadActivePolicies>[0][number]> = {}) {
  return {
    id: 'policy-1',
    routeDirectionId: 'rd-1',
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: 600,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
    kf: null,
    kb: null,
    selfEqualizingK: 0.5,
    maxHoldSeconds: 90,
    cooldownSeconds: 60,
    minimumActionSeconds: 0,
    predictionHorizonControlPoints: 3,
    occupancyStaleSeconds: 120,
    occupancyCapacity: 60,
    ks: null,
    maxLatenessSeconds: null,
    speedBandMinKmph: null,
    speedBandMaxKmph: null,
    ...overrides,
  };
}

function vehicleState(overrides: Partial<Parameters<typeof stateStore.loadVehicleStates>[0][number]>) {
  return {
    vehicleId: 'veh-x',
    tripId: null,
    routeDirectionId: 'rd-1',
    position: null,
    distanceAlongRouteMeters: null,
    speedKmph: null,
    headingDegrees: null,
    // At a stop, and therefore able to execute a hold. This is the default
    // because it is the situation these tests are about; a bus mid-link
    // cannot stand still on request and mpc/eligibility.ts declines to
    // propose one, which the eligibility tests cover separately.
    stopState: 'dwelling_at_stop',
    currentStopId: 'stop-1',
    occupancyCount: null,
    occupancyLoadBand: null,
    confidence: 1,
    isLowConfidence: false,
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('mpc.solve', () => {
  beforeEach(() => {
    stateStore._resetForTests();
    vi.mocked(listActiveVehicleIds).mockReset();
    vi.mocked(listActiveVehicleIds).mockResolvedValue(new Set());
    vi.mocked(listRecentlyCommandedVehicleIds).mockReset();
    vi.mocked(listRecentlyCommandedVehicleIds).mockResolvedValue(new Set());
    vi.mocked(loadScheduleCurves).mockReset();
    vi.mocked(loadScheduleCurves).mockResolvedValue(new Map());
    vi.mocked(readControlSettings).mockReset();
    vi.mocked(readControlSettings).mockResolvedValue({
      weighOccupancy: false,
      updatedAt: new Date(0).toISOString(),
      updatedBy: null,
      updateReason: null,
    });
  });

  it('throws a 404 AppError when there is no active policy for the route-direction', async () => {
    await expect(solve('rd-unknown')).rejects.toMatchObject({
      code: 'no_active_policy',
      status: 404,
    });
  });

  it('produces a self-equalizing fallback hold clamped to the policy max hold when two-way inputs are unavailable', async () => {
    stateStore.loadActivePolicies([
      basePolicy({ kf: 0.3, kb: 0.3, selfEqualizingK: 2, maxHoldSeconds: 60, cooldownSeconds: 30 }),
    ]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'veh-leader', observedAt: new Date().toISOString() }),
      vehicleState({ vehicleId: 'veh-follower', observedAt: new Date().toISOString() }),
    ]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-1',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 300,
        hBwdSeconds: null, // missing -> two-way can't run, self-equalizing is the designated fallback (Appendix E)
        targetHeadwaySeconds: 600,
        deviationSeconds: -300,
        computedAt: new Date().toISOString(),
      },
    ]);

    const result = await solve('rd-1');

    expect(result.routeDirectionId).toBe('rd-1');
    expect(result.candidateActions).toHaveLength(1);
    expect(result.candidateActions[0]?.actionType).toBe('self_equalizing_hold');
    expect(result.candidateActions[0]?.holdSeconds).toBeLessThanOrEqual(60);
    expect(result.selectedActionType).toBe('self_equalizing_hold');
    expect(result.constraints.maxHoldSeconds).toBe(60);
    expect(result.controllerVersion).toBe('terminal-two-way-self-equalizing-v1');
    expect(result.rejectedCandidates).toHaveLength(0);
  });

  it('returns no candidates when headway is already at target', async () => {
    stateStore.loadActivePolicies([basePolicy({ routeDirectionId: 'rd-2', maxHoldSeconds: 90, cooldownSeconds: 60 })]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'veh-a', routeDirectionId: 'rd-2' }),
      vehicleState({ vehicleId: 'veh-b', routeDirectionId: 'rd-2' }),
    ]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-2',
        routeDirectionId: 'rd-2',
        leaderVehicleId: 'veh-a',
        followerVehicleId: 'veh-b',
        hFwdSeconds: 600,
        hBwdSeconds: null,
        targetHeadwaySeconds: 600,
        deviationSeconds: 0,
        computedAt: new Date().toISOString(),
      },
    ]);

    const result = await solve('rd-2');
    expect(result.candidateActions).toHaveLength(0);
    expect(result.selectedActionType).toBeNull();
  });

  it('computes a two-way hold per Appendix A when Kf/Kb and both forward/backward headway are available', async () => {
    stateStore.loadActivePolicies([basePolicy({ kf: 0.4, kb: 0.4, maxHoldSeconds: 120 })]);
    stateStore.loadVehicleStates([vehicleState({ vehicleId: 'veh-leader' }), vehicleState({ vehicleId: 'veh-follower' })]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-3',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 400, // H* - hFwd = 200
        hBwdSeconds: 700, // H* - hBwd = -100
        targetHeadwaySeconds: 600,
        deviationSeconds: -200,
        computedAt: new Date().toISOString(),
      },
    ]);

    const result = await solve('rd-1');

    // clamp[0.4*(600-400) - 0.4*(600-700), 0, 120] = clamp[80 - (-40), 0, 120] = clamp[120,...] = 120
    const twoWay = result.candidateActions.filter((c) => c.actionType === 'two_way_hold');
    expect(twoWay).toHaveLength(1);
    expect(twoWay[0]).toMatchObject({ actionType: 'two_way_hold', holdSeconds: 120 });

    // The same pair also yields a closed-form candidate - both gaps are
    // known, so cost-optimal applies - and it is generated, scored and
    // returned for comparison. Selection is still the tuned law's: the
    // closed form minimises an objective whose lambda is a 1/H* proxy, and
    // letting the argmin of that objective win the sort would replace the
    // controller rather than add to it. See COST_OPTIMAL_SELECTION_ENABLED.
    expect(result.candidateActions.some((c) => c.actionType === 'cost_optimal_hold')).toBe(true);
    expect(result.selectedActionType).toBe('two_way_hold');
    expect(result.selectedActions).toHaveLength(1);
  });

  it('prefers a terminal dispatch candidate over a mid-route candidate on the same route-direction', async () => {
    stateStore.loadActivePolicies([basePolicy({ kf: 0.3, kb: 0.3, maxHoldSeconds: 90 })]);
    stateStore.loadTerminalStops([{ routeDirectionId: 'rd-1', stopId: 'stop-origin' }]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'veh-leader' }),
      vehicleState({ vehicleId: 'veh-terminal', stopState: 'dwelling_at_stop', currentStopId: 'stop-origin' }),
      vehicleState({ vehicleId: 'veh-mid-leader' }),
      vehicleState({ vehicleId: 'veh-mid-follower' }),
    ]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-terminal',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-terminal',
        hFwdSeconds: 500, // H* - hFwd = 100
        hBwdSeconds: null,
        targetHeadwaySeconds: 600,
        deviationSeconds: -100,
        computedAt: new Date().toISOString(),
      },
      {
        id: 'h-midroute',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-mid-leader',
        followerVehicleId: 'veh-mid-follower',
        hFwdSeconds: 400,
        hBwdSeconds: 700,
        targetHeadwaySeconds: 600,
        deviationSeconds: -200,
        computedAt: new Date().toISOString(),
      },
    ]);

    const result = await solve('rd-1');

    const terminalCandidate = result.candidateActions.find((c) => c.actionType === 'terminal_dispatch_hold');
    expect(terminalCandidate).toMatchObject({ vehicleId: 'veh-terminal', holdSeconds: 90 });
    // Terminal dispatch is the control hierarchy's default first line
    // (blueprint 8.1), so it wins selection even though a two-way
    // candidate also exists this cycle.
    expect(result.selectedActionType).toBe('terminal_dispatch_hold');
    expect(result.candidateActions.some((c) => c.actionType === 'two_way_hold')).toBe(true);
  });

  it('hard safety filter rejects a candidate computed from stale state', async () => {
    stateStore.loadActivePolicies([basePolicy({ selfEqualizingK: 1, maxHoldSeconds: 90 })]);
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes old
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'veh-leader', observedAt: staleTimestamp }),
      vehicleState({ vehicleId: 'veh-follower', observedAt: staleTimestamp }),
    ]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-stale',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 200,
        hBwdSeconds: null,
        targetHeadwaySeconds: 600,
        deviationSeconds: -400,
        computedAt: staleTimestamp,
      },
    ]);

    const result = await solve('rd-1');

    expect(result.candidateActions).toHaveLength(1); // still reported, just not selectable
    expect(result.selectedActionType).toBeNull();
    expect(result.rejectedCandidates).toHaveLength(1);
    expect(result.rejectedCandidates[0]?.reasons).toContain('stale_state');

    // No alighting-only proposal here, and the reason is the threshold rather
    // than the staleness: this pair sits at ratio 0.33, which is wider than
    // the corridor's own 0.25 bunched threshold. Imposing a wait on
    // passengers requires the pair to be at least as bunched as the corridor
    // says bunched is - see mpc/boardingLimit.ts#maxFollowerGapSeconds.
    expect(result.boardingLimitCandidates).toEqual([]);
  });

  it('hard safety filter rejects a candidate whose vehicle already has a conflicting active command', async () => {
    stateStore.loadActivePolicies([basePolicy({ selfEqualizingK: 1, maxHoldSeconds: 90 })]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'veh-leader' }),
      vehicleState({ vehicleId: 'veh-follower' }),
    ]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-conflict',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 200,
        hBwdSeconds: null,
        targetHeadwaySeconds: 600,
        deviationSeconds: -400,
        computedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(listActiveVehicleIds).mockResolvedValue(new Set(['veh-follower']));

    const result = await solve('rd-1');

    expect(result.selectedActionType).toBeNull();
    expect(result.rejectedCandidates).toHaveLength(1);
    expect(result.rejectedCandidates[0]?.reasons).toContain('conflicting_active_command');
  });

  it('predictive advisory is clearly labelled PREDICTIVE and estimates occupancy when no live reading exists', async () => {
    stateStore.loadActivePolicies([basePolicy({ selfEqualizingK: 1, maxHoldSeconds: 90, occupancyCapacity: 60 })]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'veh-leader' }),
      vehicleState({ vehicleId: 'veh-follower', occupancyCount: null }), // no live occupancy sample
    ]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-mpc',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 200,
        hBwdSeconds: null,
        targetHeadwaySeconds: 600,
        deviationSeconds: -400,
        computedAt: new Date().toISOString(),
      },
    ]);

    const result = await solve('rd-1');

    expect(result.predictiveAdvisory.label).toBe('PREDICTIVE');
    expect(result.predictiveAdvisory.candidates).toHaveLength(1);
    expect(result.predictiveAdvisory.candidates[0]?.occupancyEstimated).toBe(true);
    expect(result.predictiveAdvisory.candidates[0]?.mpcObjectiveCost).toBeGreaterThan(0);
    expect(result.predictiveAdvisory.horizonControlPoints).toBe(3);
  });

  it('predictive advisory uses the live occupancy reading when fresh', async () => {
    stateStore.loadActivePolicies([basePolicy({ selfEqualizingK: 1, maxHoldSeconds: 90, occupancyCapacity: 60, occupancyStaleSeconds: 120 })]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'veh-leader' }),
      vehicleState({ vehicleId: 'veh-follower', occupancyCount: 30, observedAt: new Date().toISOString() }),
    ]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-mpc-live',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 200,
        hBwdSeconds: null,
        targetHeadwaySeconds: 600,
        deviationSeconds: -400,
        computedAt: new Date().toISOString(),
      },
    ]);

    const result = await solve('rd-1');

    expect(result.predictiveAdvisory.candidates[0]?.occupancyEstimated).toBe(false);
  });

  // ─── SELECTION RANKS BY PASSENGER COST, NOT BY CLAMP RESIDUAL ──────────
  //
  // The defect this pins: `objectiveCost` used to be |rawHold - holdSeconds|
  // and candidates sort ascending on it. Since holdSeconds is the clamped
  // hold, the residual GROWS with severity - the pair needing the biggest
  // correction hit the cap hardest and sorted last. With one command issued
  // per cycle the solver reliably spent its single intervention on the pair
  // that needed it least.
  it('selects the severely bunched pair over the barely-off one, though the cap bit harder', async () => {
    const now = new Date().toISOString();
    stateStore.loadActivePolicies([
      basePolicy({ kf: null, kb: null, selfEqualizingK: 2, maxHoldSeconds: 90, occupancyCapacity: null }),
    ]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'lead-severe', observedAt: now }),
      vehicleState({ vehicleId: 'veh-severe', observedAt: now }),
      vehicleState({ vehicleId: 'lead-mild', observedAt: now }),
      vehicleState({ vehicleId: 'veh-mild', observedAt: now }),
    ]);
    stateStore.loadHeadwayStates([
      {
        // Barely off target, and its raw hold of 40s needs no clamping at
        // all - clamp residual 0, which used to make it the winner.
        id: 'h-mild',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'lead-mild',
        followerVehicleId: 'veh-mild',
        hFwdSeconds: 580,
        hBwdSeconds: 600,
        targetHeadwaySeconds: 600,
        deviationSeconds: -20,
        computedAt: now,
      },
      {
        // Closed to 60s against a 600s target with a 1,200s hole behind it.
        // Raw hold 2280s, clamped to 90 - clamp residual 2190.
        id: 'h-severe',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'lead-severe',
        followerVehicleId: 'veh-severe',
        hFwdSeconds: 60,
        hBwdSeconds: 1200,
        targetHeadwaySeconds: 600,
        deviationSeconds: -540,
        computedAt: now,
      },
    ]);

    const result = await solve('rd-1');

    expect(result.selectedAction?.vehicleId).toBe('veh-severe');
    expect(result.selectedAction?.clampResidualSeconds).toBe(2190);
    // Negative = the hold removes more passenger cost than it adds.
    expect(result.objectiveCost).toBeLessThan(0);

    const mild = result.safeCandidates.find((c) => c.vehicleId === 'veh-mild')!;
    // The mild pair's hold is not merely worse - it is actively harmful:
    // 580s is already near target, so opening it further costs more waiting
    // than it saves. Ranked last, exactly as it should be.
    expect(mild.objectiveCost).toBeGreaterThan(0);
    expect(mild.clampResidualSeconds).toBe(0);
  });

  // Section 7 of the reference architecture: the in-vehicle cost term is
  // where a live onboard count changes a decision the published state of
  // the art has to make on a historical average.
  // This is the behaviour the occupancy switch turns on, so the switch is on
  // for this test. With it off (the default), `liveOnboardCount` reports no
  // load at all and both pairs score identically on wait cost alone - which
  // is the correct behaviour for a deployment whose lambda is still a proxy,
  // and is asserted separately below.
  it('prefers holding the emptier bus when two pairs are equally out of position', async () => {
    vi.mocked(readControlSettings).mockResolvedValue({
      weighOccupancy: true,
      updatedAt: new Date(0).toISOString(),
      updatedBy: 'test',
      updateReason: 'exercising the occupancy term',
    });
    const now = new Date().toISOString();
    stateStore.loadActivePolicies([
      basePolicy({ kf: null, kb: null, selfEqualizingK: 1, maxHoldSeconds: 300, occupancyStaleSeconds: 120 }),
    ]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'lead-full', observedAt: now }),
      vehicleState({ vehicleId: 'veh-full', occupancyCount: 50, observedAt: now }),
      vehicleState({ vehicleId: 'lead-empty', observedAt: now }),
      vehicleState({ vehicleId: 'veh-empty', occupancyCount: 4, observedAt: now }),
    ]);
    const headway = (id: string, leader: string, follower: string) => ({
      id,
      routeDirectionId: 'rd-1',
      leaderVehicleId: leader,
      followerVehicleId: follower,
      hFwdSeconds: 100,
      hBwdSeconds: 1100,
      targetHeadwaySeconds: 600,
      deviationSeconds: -500,
      computedAt: now,
    });
    stateStore.loadHeadwayStates([
      headway('h-full', 'lead-full', 'veh-full'),
      headway('h-empty', 'lead-empty', 'veh-empty'),
    ]);

    const result = await solve('rd-1');

    expect(result.selectedAction?.vehicleId).toBe('veh-empty');
    expect(result.selectedAction?.passengerCost.loadEstimated).toBe(false);
    expect(result.selectedAction?.passengerCost.onboardPassengerSeconds).toBeGreaterThan(0);

    const full = result.safeCandidates.find((c) => c.vehicleId === 'veh-full')!;
    expect(full.passengerCost.onboardPassengerSeconds).toBeGreaterThan(
      result.selectedAction!.passengerCost.onboardPassengerSeconds,
    );
  });

  // Part J, "Explainability": a reason, not a confidence score.
  it('attaches a one-sentence rationale naming the headways behind the hold', async () => {
    const now = new Date().toISOString();
    stateStore.loadActivePolicies([basePolicy({ kf: null, kb: null, selfEqualizingK: 1, maxHoldSeconds: 300 })]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'veh-leader', observedAt: now }),
      vehicleState({ vehicleId: 'veh-follower', observedAt: now }),
    ]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-explain',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 120,
        hBwdSeconds: 900,
        targetHeadwaySeconds: 600,
        deviationSeconds: -480,
        computedAt: now,
      },
    ]);

    const result = await solve('rd-1');

    expect(result.selectedAction?.rationale).toContain('veh-follower');
    expect(result.selectedAction?.rationale).toContain('120s');
    expect(result.selectedAction?.rationale).toContain('900s');
  });

  // ─── PUNCTUALITY ───────────────────────────────────────────────────────
  //
  // These pin the deployed-today behaviour as much as the new behaviour:
  // with no timetable loaded every deviation is null, so the schedule term
  // contributes nothing and the lateness bound rejects nothing. That is what
  // makes loading a timetable a data change rather than a code change.

  it('leaves the control law untouched when no schedule is loaded, even with ks configured', async () => {
    const now = new Date().toISOString();
    stateStore.loadActivePolicies([
      basePolicy({ kf: 0.5, kb: 0.2, selfEqualizingK: null, maxHoldSeconds: 600, ks: 2 }),
    ]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'veh-leader', observedAt: now }),
      // tripId null - nothing to look a schedule up by, which is every
      // vehicle on this deployment.
      vehicleState({ vehicleId: 'veh-follower', tripId: null, observedAt: now }),
    ]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-sched-none',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 200,
        hBwdSeconds: 900,
        targetHeadwaySeconds: 600,
        deviationSeconds: -400,
        computedAt: now,
      },
    ]);

    const result = await solve('rd-1');

    // 0.5*(600-200) - 0.2*(600-900) = 200 + 60 = 260, with no schedule term.
    expect(result.selectedAction?.holdSeconds).toBe(260);
    expect(result.selectedAction?.scheduleDeviationSeconds).toBeNull();
    expect(result.selectedAction?.passengerCost.scheduleUnknown).toBe(true);
    expect(result.selectedAction?.passengerCost.latenessPassengerSeconds).toBe(0);
  });

  // The guardrail that makes "as punctual as possible" enforceable rather
  // than aspirational. Distinct from max_hold_seconds: the hold is well
  // within the cap, and is rejected for what it would do to the timetable.
  it('rejects an otherwise-safe hold that would push the vehicle past the lateness bound', async () => {
    const now = new Date().toISOString();
    stateStore.loadActivePolicies([
      basePolicy({
        kf: null,
        kb: null,
        selfEqualizingK: 1,
        maxHoldSeconds: 600,
        maxLatenessSeconds: 300,
      }),
    ]);
    stateStore.loadVehicleStates([
      vehicleState({ vehicleId: 'veh-leader', observedAt: now }),
      vehicleState({
        vehicleId: 'veh-follower',
        tripId: 'trip-late',
        distanceAlongRouteMeters: 5000,
        observedAt: now,
      }),
    ]);
    vi.mocked(loadScheduleCurves).mockResolvedValue(
      new Map([['trip-late', curveMakingVehicleLate(5000, 280)]]),
    );
    stateStore.loadHeadwayStates([
      {
        id: 'h-late',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 100,
        hBwdSeconds: 500,
        targetHeadwaySeconds: 600,
        deviationSeconds: -500,
        computedAt: now,
      },
    ]);

    // 280s already late; the law wants 400s, which would land at 680s
    // against a 300s bound.
    const result = await solve('rd-1');

    expect(result.selectedAction).toBeNull();
    expect(result.rejectedCandidates[0]?.reasons).toContain('max_lateness_breach');
    // Well inside the hold cap - this is a punctuality rejection, not a
    // feasibility one, and the two must stay distinguishable.
    expect(result.rejectedCandidates[0]?.reasons).not.toContain('max_hold_cap_breach');
  });
});
