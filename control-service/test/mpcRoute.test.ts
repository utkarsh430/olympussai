// POST /v1/mpc/solve at the HTTP layer, against the REAL solver.
//
// Deliberately different from test/mpcSolver.test.ts, which calls solve()
// directly to exercise each control law. This file exists because the web
// app now calls this endpoint over the wire
// (src/lib/controlService/recommendations.ts -> POST
// /api/ops/control-room/recommendations), so the thing that has to be true
// is that a seeded route-direction produces a real recommendation IN THE
// RESPONSE BODY, with the evidence a human needs to override it: the
// rejected candidates and their reasons, and the advisory kept separate
// from the committed choice.
//
// Nothing is mocked except db/commands.js#listActiveVehicleIds, which is the
// only Postgres read on the path. The five control-law modules, the hard
// safety filter and the occupancy-weighted advisory all run for real.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/db/commands.js', () => ({
  listActiveVehicleIds: vi.fn(),
  listRecentlyCommandedVehicleIds: vi.fn(),
  countBoardingLimitCommands: vi.fn(),
}));

// Only the one reader terminal dispatch needs; the rest of the module stays
// real because this test mounts the whole app and other routers read from it.
// A bus standing at the origin has no speed to divide a gap by, so
// `stop_visits.departed_at` is the only thing that can say how long it has
// been waiting - see mpc/terminalDispatch.ts.
vi.mock('../src/headway/repository.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/headway/repository.js')>()),
  loadLastStopDeparture: vi.fn(),
}));

const { createApp } = await import('../src/app.js');
type MpcSolveResult = import('../src/mpc/solver.js').MpcSolveResult;
const { stateStore } = await import('../src/state/store.js');
const { listActiveVehicleIds, listRecentlyCommandedVehicleIds, countBoardingLimitCommands } =
  await import('../src/db/commands.js');
const { loadLastStopDeparture } = await import('../src/headway/repository.js');

const AUTH_HEADER = 'Bearer test-service-token-secret-value';
const ROUTE_DIRECTION_ID = '11111111-1111-1111-1111-111111111111';
const TERMINAL_STOP_ID = 'stop-lucknow-charbagh';

function policy(overrides: Partial<Parameters<typeof stateStore.loadActivePolicies>[0][number]> = {}) {
  return {
    id: 'policy-1',
    routeDirectionId: ROUTE_DIRECTION_ID,
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: 600,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
    kf: 0.4,
    kb: 0.2,
    selfEqualizingK: 0.5,
    maxHoldSeconds: 120,
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

function vehicle(overrides: Partial<Parameters<typeof stateStore.loadVehicleStates>[0][number]>) {
  return {
    vehicleId: 'veh-x',
    tripId: null,
    routeDirectionId: ROUTE_DIRECTION_ID,
    position: null,
    distanceAlongRouteMeters: null,
    speedKmph: null,
    headingDegrees: null,
    // A holdable state, and a real one: 'in_motion' is not among the six
    // values `vehicle_states.stop_state` admits. mpc/eligibility.ts reads
    // this field, so a fixture outside the vocabulary silently produced no
    // candidates.
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

function headwayPair(overrides: Partial<Parameters<typeof stateStore.loadHeadwayStates>[0][number]>) {
  return {
    id: 'h-x',
    routeDirectionId: ROUTE_DIRECTION_ID,
    leaderVehicleId: 'veh-leader',
    followerVehicleId: 'veh-follower',
    hFwdSeconds: 600,
    hBwdSeconds: 600,
    targetHeadwaySeconds: 600,
    deviationSeconds: 0,
    /** Nothing here exercises the forecast gate; a pair with no forecast is the deployed state on every corridor. */
    forecastHFwdSeconds: null,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('POST /v1/mpc/solve', () => {
  beforeEach(() => {
    stateStore._resetForTests();
    vi.mocked(listActiveVehicleIds).mockReset();
    vi.mocked(listActiveVehicleIds).mockResolvedValue(new Set());
    vi.mocked(listRecentlyCommandedVehicleIds).mockReset();
    vi.mocked(listRecentlyCommandedVehicleIds).mockResolvedValue(new Set());
    vi.mocked(countBoardingLimitCommands).mockReset();
    // Never called on a corridor that has not enabled alighting-only, which is
    // every corridor unless a test says otherwise. Resolving 0 here would let
    // an accidental call pass unnoticed; rejecting makes it a failure.
    vi.mocked(countBoardingLimitCommands).mockRejectedValue(
      new Error('the refusal meter must not be read on a corridor with alighting-only off'),
    );
    vi.mocked(loadLastStopDeparture).mockReset();
    // veh-terminal is 120s behind the bus that just left, which is what the
    // scenario below has always meant - it was previously expressed as an
    // h_fwd, a quantity a stationary bus cannot produce.
    vi.mocked(loadLastStopDeparture).mockResolvedValue(new Date(Date.now() - 120_000));
  });

  it('rejects an unauthenticated caller before the solver runs', async () => {
    const response = await request(createApp())
      .post('/v1/mpc/solve')
      .send({ routeDirectionId: ROUTE_DIRECTION_ID });

    expect(response.status).toBe(401);
    expect(listActiveVehicleIds).not.toHaveBeenCalled();
  });

  it('answers 400 for a request with no route-direction', async () => {
    const response = await request(createApp())
      .post('/v1/mpc/solve')
      .set('Authorization', AUTH_HEADER)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });

  it('answers 404 for a route-direction with no active policy, rather than an empty recommendation', async () => {
    const response = await request(createApp())
      .post('/v1/mpc/solve')
      .set('Authorization', AUTH_HEADER)
      .send({ routeDirectionId: ROUTE_DIRECTION_ID });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('no_active_policy');
  });

  /**
   * The scenario the whole endpoint exists for, seeded end to end:
   *
   *   veh-terminal  dwelling at the origin, 120s behind the bus that just
   *                 left against a 600s target -> terminal dispatch wants to
   *                 hold it for the 480s shortfall, clamped to the 120s cap.
   *   veh-mid       mid-route, 60s behind its leader with the follower behind
   *                 it comfortably spaced -> two-way holding proposes a small
   *                 corrective hold.
   *   veh-stale     mid-route and badly bunched, but its leader has not been
   *                 heard from in 10 minutes -> the hard safety filter must
   *                 refuse it, and say why.
   *   veh-busy      mid-route and bunched, but already has a command in
   *                 flight -> refused as a conflicting active command.
   */
  it('returns a real recommendation, the rejected candidates with their reasons, and a separate advisory', async () => {
    const fresh = new Date().toISOString();
    const tenMinutesAgo = new Date(Date.now() - 600_000).toISOString();

    stateStore.loadActivePolicies([policy()]);
    stateStore.loadTerminalStops([{ routeDirectionId: ROUTE_DIRECTION_ID, stopId: TERMINAL_STOP_ID }]);
    stateStore.loadVehicleStates([
      vehicle({
        vehicleId: 'veh-terminal',
        stopState: 'dwelling_at_stop',
        currentStopId: TERMINAL_STOP_ID,
        occupancyCount: 12,
        observedAt: fresh,
      }),
      vehicle({ vehicleId: 'veh-terminal-leader', observedAt: fresh }),
      vehicle({ vehicleId: 'veh-mid', occupancyCount: 48, observedAt: fresh }),
      vehicle({ vehicleId: 'veh-mid-leader', observedAt: fresh }),
      vehicle({ vehicleId: 'veh-stale', observedAt: fresh }),
      vehicle({ vehicleId: 'veh-stale-leader', observedAt: tenMinutesAgo }),
      vehicle({ vehicleId: 'veh-busy', observedAt: fresh }),
      vehicle({ vehicleId: 'veh-busy-leader', observedAt: fresh }),
    ]);
    stateStore.loadHeadwayStates([
      headwayPair({
        id: 'h-terminal',
        leaderVehicleId: 'veh-terminal-leader',
        followerVehicleId: 'veh-terminal',
        hFwdSeconds: 120,
        hBwdSeconds: 600,
        deviationSeconds: -480,
        computedAt: fresh,
      }),
      headwayPair({
        id: 'h-mid',
        leaderVehicleId: 'veh-mid-leader',
        followerVehicleId: 'veh-mid',
        // Inside the corridor's warning threshold (0.5 x 600 = 300s), so a
        // mid-route candidate is generated at all. At 540s the pair is 90% of
        // target and mpc/actionThreshold.ts skips it before any law sees it.
        hFwdSeconds: 240,
        hBwdSeconds: 660,
        deviationSeconds: -360,
        computedAt: fresh,
      }),
      headwayPair({
        id: 'h-stale',
        leaderVehicleId: 'veh-stale-leader',
        followerVehicleId: 'veh-stale',
        hFwdSeconds: 200,
        hBwdSeconds: 600,
        deviationSeconds: -400,
        computedAt: fresh,
      }),
      headwayPair({
        id: 'h-busy',
        leaderVehicleId: 'veh-busy-leader',
        followerVehicleId: 'veh-busy',
        hFwdSeconds: 300,
        hBwdSeconds: 600,
        deviationSeconds: -300,
        computedAt: fresh,
      }),
    ]);
    vi.mocked(listActiveVehicleIds).mockResolvedValue(new Set(['veh-busy']));

    const response = await request(createApp())
      .post('/v1/mpc/solve')
      .set('Authorization', AUTH_HEADER)
      .send({ routeDirectionId: ROUTE_DIRECTION_ID });

    expect(response.status).toBe(200);
    const body = response.body as MpcSolveResult;

    // Terminal dispatch is the control hierarchy's default first line, so it
    // wins over the cheaper mid-route candidate — and the response now names
    // the bus, not just the action type.
    expect(body.selectedActionType).toBe('terminal_dispatch_hold');
    expect(body.selectedAction).toMatchObject({
      actionType: 'terminal_dispatch_hold',
      vehicleId: 'veh-terminal',
      holdSeconds: 120, // 480s shortfall clamped to the policy's 120s cap
      routeDirectionId: ROUTE_DIRECTION_ID,
    });
    expect(body.expectedRecoverySeconds).toBe(120);

    // The mid-route candidates are real, safe, and simply not the ones
    // selected. `veh-mid` carries TWO: the tuned two-way hold and the
    // closed-form one, which key on the same follower by design so an
    // outcome review can compare them. The lookup names the action type
    // rather than trusting sort order.
    const midCandidate = body.safeCandidates.find(
      (c) => c.vehicleId === 'veh-mid' && c.actionType === 'two_way_hold',
    );
    expect(midCandidate).toMatchObject({ actionType: 'two_way_hold', vehicleId: 'veh-mid' });
    expect(midCandidate?.holdSeconds).toBeGreaterThan(0);
    expect(
      body.safeCandidates.some((c) => c.vehicleId === 'veh-mid' && c.actionType === 'cost_optimal_hold'),
    ).toBe(true);

    // ─── ALIGHTING-ONLY IS WITHHELD, AND SAYS SO ────────────────────────
    //
    // The structural conditions for it hold on the tightest pair - 120s of gap
    // on a 600s corridor, with the bus behind close enough that anyone left
    // standing waits two minutes - and `veh-terminal-leader` is the LEADER,
    // which is the bus this law acts on. This policy does not enable it, which
    // is the shipped state of every corridor, so the proposal is not offered.
    //
    // The empty list is not the assertion that matters. `boardingLimitAvailability`
    // is: it distinguishes this corridor, where the law found something and is
    // not allowed to say so, from a corridor where it found nothing.
    expect(body.boardingLimitCandidates).toEqual([]);
    expect(body.boardingLimitAvailability).toMatchObject({
      offered: false,
      withheldReason: 'disabled_for_corridor',
      refusalsInWindow: null,
      withheldCandidateCount: 1,
    });

    // AND it is absent from `safeCandidates` too, which is the assertion with
    // teeth: the control-room console renders every safe candidate that is not
    // the selected one as an approvable alternative
    // (EngineRecommendationPanel), so a withheld proposal left in this list
    // would still be issuable to a driver.
    expect(body.safeCandidates.some((c) => c.actionType === 'boarding_limit')).toBe(false);
    expect(body.candidateActions.some((c) => c.actionType === 'boarding_limit')).toBe(false);

    // safeCandidates is exactly candidateActions minus the rejected ones, so
    // a consumer never has to compute that difference itself. A WITHHELD
    // candidate is not a rejected one - the safety filter had no opinion about
    // it - so it must appear in neither list rather than becoming a third
    // state no reader has a branch for.
    expect(body.candidateActions).toHaveLength(body.safeCandidates.length + body.rejectedCandidates.length);
    expect(new Set(body.safeCandidates.map((c) => c.vehicleId))).toEqual(
      new Set(['veh-terminal', 'veh-mid']),
    );

    // Both refusals survive to the wire with their reasons attached — this is
    // the evidence an operator overriding the engine has to be able to read.
    const rejections = Object.fromEntries(
      body.rejectedCandidates.map((r) => [r.candidate.vehicleId, r.reasons]),
    );
    expect(rejections['veh-stale']).toEqual(['stale_state']);
    expect(rejections['veh-busy']).toEqual(['conflicting_active_command']);

    // The advisory is scored over the safe candidates only, and is labelled
    // so nothing downstream can mistake its ranking for the committed choice.
    expect(body.predictiveAdvisory.label).toBe('PREDICTIVE');
    // Three safe HOLDS: the terminal one, and both of veh-mid's. The
    // alighting-only candidate is deliberately absent - the advisory scores
    // what a hold costs the people aboard, which is meaningless for an action
    // whose hold length is zero and whose cost falls at the roadside.
    expect(body.predictiveAdvisory.candidates).toHaveLength(3);
    expect(
      body.predictiveAdvisory.candidates.every((c) => c.actionType !== 'boarding_limit'),
    ).toBe(true);
    expect(body.predictiveAdvisory.controllerVersion).toBe('occupancy-weighted-mpc-v1');
    // veh-mid has a live 48/60 occupancy reading; veh-terminal has 12/60. Both
    // are fresh, so neither falls back to the mid-load estimate.
    expect(
      body.predictiveAdvisory.candidates.every((c) => !c.occupancyEstimated),
    ).toBe(true);
    // The advisory may rank a different candidate first than the committed
    // selection, and that is allowed precisely because it cannot commit.
    expect(body.selectedAction?.actionType).toBe('terminal_dispatch_hold');

    expect(body.controllerVersion).toBe('terminal-two-way-self-equalizing-v1');
    expect(body.constraints).toMatchObject({ maxHoldSeconds: 120, cooldownSeconds: 60, staleAfterSeconds: 90 });
  });

  /**
   * The same corridor and the same buses as the test above, switched on.
   *
   * Read the two together: nothing about the geometry, the demand or the law
   * changed between them. The only difference is one column of
   * `route_policies`, which is the whole point - saying yes on one corridor is
   * a row, not a deploy, and saying no again is the same row.
   */
  function bunchedPairAtTheTerminal(policyOverrides: Record<string, unknown>) {
    const fresh = new Date().toISOString();
    stateStore.loadActivePolicies([policy(policyOverrides)]);
    stateStore.loadTerminalStops([{ routeDirectionId: ROUTE_DIRECTION_ID, stopId: TERMINAL_STOP_ID }]);
    stateStore.loadVehicleStates([
      vehicle({
        vehicleId: 'veh-follower',
        stopState: 'dwelling_at_stop',
        currentStopId: 'stop-mid-route',
        observedAt: fresh,
      }),
      // The LEADER is the bus this law acts on, and it has to be standing
      // somewhere it could act. Not the terminal: people START journeys there,
      // so refusing them is refusing the service rather than rebalancing it.
      vehicle({
        vehicleId: 'veh-leader',
        stopState: 'dwelling_at_stop',
        currentStopId: 'stop-mid-route',
        observedAt: fresh,
      }),
    ]);
    stateStore.loadHeadwayStates([
      headwayPair({
        id: 'h-pair',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 120,
        hBwdSeconds: 600,
        deviationSeconds: -480,
        computedAt: fresh,
      }),
    ]);
  }

  const solveBody = async (): Promise<MpcSolveResult> => {
    const response = await request(createApp())
      .post('/v1/mpc/solve')
      .set('Authorization', AUTH_HEADER)
      .send({ routeDirectionId: ROUTE_DIRECTION_ID });
    expect(response.status).toBe(200);
    return response.body as MpcSolveResult;
  };

  it('offers alighting-only on a corridor that has enabled it, with its refusal budget attached', async () => {
    bunchedPairAtTheTerminal({
      alightingOnlyEnabled: true,
      alightingOnlyMaxRefusals: 4,
      alightingOnlyRefusalWindowSeconds: 1800,
    });
    // Two of these instructions already issued on this corridor in the window.
    vi.mocked(countBoardingLimitCommands).mockResolvedValue(2);

    const body = await solveBody();

    expect(body.boardingLimitCandidates.map((c) => c.vehicleId)).toEqual(['veh-leader']);
    // The cost travels WITH the proposal. An operator approving this is shown
    // how much of the corridor's refusal budget it has already spent, not only
    // what the action is supposed to buy.
    expect(body.boardingLimitAvailability).toEqual({
      offered: true,
      withheldReason: null,
      refusalsInWindow: 2,
      maxRefusals: 4,
      windowSeconds: 1800,
      remainingRefusals: 2,
      withheldCandidateCount: 0,
    });
    // The meter is read for the corridor being solved, over its own window.
    expect(countBoardingLimitCommands).toHaveBeenCalledWith(ROUTE_DIRECTION_ID, 1800);
  });

  it('stops proposing alighting-only once the corridor hits its refusal bound, and says why', async () => {
    bunchedPairAtTheTerminal({
      alightingOnlyEnabled: true,
      alightingOnlyMaxRefusals: 4,
      alightingOnlyRefusalWindowSeconds: 1800,
    });
    vi.mocked(countBoardingLimitCommands).mockResolvedValue(4);

    const body = await solveBody();

    expect(body.boardingLimitCandidates).toEqual([]);
    expect(body.boardingLimitAvailability).toMatchObject({
      offered: false,
      withheldReason: 'refusal_tripwire',
      refusalsInWindow: 4,
      maxRefusals: 4,
      remainingRefusals: 0,
      // The law DID want to act. That is the difference between a tripped
      // corridor and a quiet one, and it is the number an operator deciding
      // whether to raise the bound is deciding about.
      withheldCandidateCount: 1,
    });

    // The bound has to bind on every path out of the solver, not only the one
    // the alternatives panel reads. A candidate left in `safeCandidates` is
    // stageable and issuable from the engine console.
    expect(body.safeCandidates.some((c) => c.actionType === 'boarding_limit')).toBe(false);
    expect(body.candidateActions.some((c) => c.actionType === 'boarding_limit')).toBe(false);
    expect(body.candidateActions).toHaveLength(
      body.safeCandidates.length + body.rejectedCandidates.length,
    );
  });

  it('withholds alighting-only when the refusal meter cannot be read, rather than assuming zero', async () => {
    bunchedPairAtTheTerminal({ alightingOnlyEnabled: true });
    vi.mocked(countBoardingLimitCommands).mockRejectedValue(new Error('database is unreachable'));

    // Failing closed must not mean failing the solve: the other four laws are
    // unaffected by this one's meter, and taking the whole corridor's control
    // offline because a count could not be read would be a far larger harm
    // than the one this tripwire exists to bound.
    const body = await solveBody();

    expect(body.boardingLimitCandidates).toEqual([]);
    expect(body.boardingLimitAvailability).toMatchObject({
      offered: false,
      withheldReason: 'refusal_tripwire',
      refusalsInWindow: null,
      remainingRefusals: null,
    });
    expect(body.safeCandidates.some((c) => c.actionType === 'boarding_limit')).toBe(false);
  });


  it('proposes nothing but still reports the refusals when every candidate is unsafe', async () => {
    const fresh = new Date().toISOString();

    stateStore.loadActivePolicies([policy()]);
    stateStore.loadVehicleStates([
      vehicle({ vehicleId: 'veh-a', observedAt: fresh }),
      vehicle({ vehicleId: 'veh-a-leader', observedAt: fresh }),
    ]);
    stateStore.loadHeadwayStates([
      headwayPair({
        id: 'h-a',
        leaderVehicleId: 'veh-a-leader',
        followerVehicleId: 'veh-a',
        hFwdSeconds: 300,
        hBwdSeconds: 600,
        deviationSeconds: -300,
        computedAt: fresh,
      }),
    ]);
    vi.mocked(listActiveVehicleIds).mockResolvedValue(new Set(['veh-a']));

    const response = await request(createApp())
      .post('/v1/mpc/solve')
      .set('Authorization', AUTH_HEADER)
      .send({ routeDirectionId: ROUTE_DIRECTION_ID });

    expect(response.status).toBe(200);
    expect(response.body.selectedAction).toBeNull();
    expect(response.body.selectedActionType).toBeNull();
    expect(response.body.safeCandidates).toEqual([]);
    // Two candidates for one pair: the tuned two-way law and the closed-form
    // cost-optimal law both key on the same follower. Both are refused for
    // the same reason, and the refusal is reported per candidate.
    expect(response.body.candidateActions).toHaveLength(2);
    expect(
      (response.body.rejectedCandidates as { reasons: string[] }[]).every((r) =>
        r.reasons.includes('conflicting_active_command'),
      ),
    ).toBe(true);
    expect(response.body.predictiveAdvisory.candidates).toEqual([]);
  });

  it('proposes nothing and refuses nothing on a route that is already evenly spaced', async () => {
    const fresh = new Date().toISOString();

    stateStore.loadActivePolicies([policy()]);
    stateStore.loadVehicleStates([
      vehicle({ vehicleId: 'veh-a', observedAt: fresh }),
      vehicle({ vehicleId: 'veh-a-leader', observedAt: fresh }),
    ]);
    stateStore.loadHeadwayStates([
      headwayPair({
        id: 'h-a',
        leaderVehicleId: 'veh-a-leader',
        followerVehicleId: 'veh-a',
        hFwdSeconds: 600,
        hBwdSeconds: 600,
        deviationSeconds: 0,
        computedAt: fresh,
      }),
    ]);

    const response = await request(createApp())
      .post('/v1/mpc/solve')
      .set('Authorization', AUTH_HEADER)
      .send({ routeDirectionId: ROUTE_DIRECTION_ID });

    expect(response.status).toBe(200);
    expect(response.body.candidateActions).toEqual([]);
    expect(response.body.rejectedCandidates).toEqual([]);
    expect(response.body.selectedAction).toBeNull();
  });

  it('only ever proposes the four hold types the control laws implement', async () => {
    const fresh = new Date().toISOString();

    stateStore.loadActivePolicies([policy({ kf: null, kb: null, selfEqualizingK: 0.5 })]);
    stateStore.loadVehicleStates([
      vehicle({ vehicleId: 'veh-a', observedAt: fresh }),
      vehicle({ vehicleId: 'veh-a-leader', observedAt: fresh }),
    ]);
    stateStore.loadHeadwayStates([
      headwayPair({
        id: 'h-a',
        leaderVehicleId: 'veh-a-leader',
        followerVehicleId: 'veh-a',
        // Inside the warning threshold, so the laws are actually asked - the
        // point of this test is WHICH action types they may return.
        hFwdSeconds: 250,
        hBwdSeconds: 600,
        deviationSeconds: -350,
        computedAt: fresh,
      }),
    ]);

    const response = await request(createApp())
      .post('/v1/mpc/solve')
      .set('Authorization', AUTH_HEADER)
      .send({ routeDirectionId: ROUTE_DIRECTION_ID });

    const body = response.body as MpcSolveResult;
    const holdTypes = new Set([
      'terminal_dispatch_hold',
      'two_way_hold',
      'self_equalizing_hold',
      'cost_optimal_hold',
    ]);
    const everyType: string[] = [
      ...body.candidateActions.map((c) => c.actionType),
      ...body.predictiveAdvisory.candidates.map((c) => c.actionType),
    ];
    expect(everyType.length).toBeGreaterThan(0);
    expect(everyType.every((t) => holdTypes.has(t))).toBe(true);
    // The cost-optimal candidate is GENERATED here (both gaps are known) and
    // would outrank the self-equalising one on passenger-seconds, because it
    // is the argmin of exactly that quantity. It is still not selected: see
    // COST_OPTIMAL_SELECTION_ENABLED for why an uncalibrated lambda must not
    // be allowed to displace a tuned gain by winning a sort.
    expect(everyType).toContain('cost_optimal_hold');
    expect(body.selectedActionType).toBe('self_equalizing_hold');
  });
});
