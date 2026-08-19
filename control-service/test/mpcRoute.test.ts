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
}));

const { createApp } = await import('../src/app.js');
type MpcSolveResult = import('../src/mpc/solver.js').MpcSolveResult;
const { stateStore } = await import('../src/state/store.js');
const { listActiveVehicleIds, listRecentlyCommandedVehicleIds } = await import(
  '../src/db/commands.js'
);

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
        hFwdSeconds: 540,
        hBwdSeconds: 660,
        deviationSeconds: -60,
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

    // The mid-route candidate is real, safe, and simply not the one selected.
    const midCandidate = body.safeCandidates.find((c) => c.vehicleId === 'veh-mid');
    expect(midCandidate).toMatchObject({ actionType: 'two_way_hold', vehicleId: 'veh-mid' });
    expect(midCandidate?.holdSeconds).toBeGreaterThan(0);

    // safeCandidates is exactly candidateActions minus the rejected ones, so
    // a consumer never has to compute that difference itself.
    expect(body.candidateActions).toHaveLength(body.safeCandidates.length + body.rejectedCandidates.length);
    expect(body.safeCandidates.map((c) => c.vehicleId)).toEqual([
      'veh-terminal',
      'veh-mid',
    ]);

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
    expect(body.predictiveAdvisory.candidates).toHaveLength(2);
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
    expect(response.body.candidateActions).toHaveLength(1);
    expect(response.body.rejectedCandidates[0].reasons).toEqual(['conflicting_active_command']);
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

  it('only ever proposes the three hold types the control laws implement', async () => {
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
        hFwdSeconds: 400,
        hBwdSeconds: 600,
        deviationSeconds: -200,
        computedAt: fresh,
      }),
    ]);

    const response = await request(createApp())
      .post('/v1/mpc/solve')
      .set('Authorization', AUTH_HEADER)
      .send({ routeDirectionId: ROUTE_DIRECTION_ID });

    const body = response.body as MpcSolveResult;
    const holdTypes = new Set(['terminal_dispatch_hold', 'two_way_hold', 'self_equalizing_hold']);
    const everyType: string[] = [
      ...body.candidateActions.map((c) => c.actionType),
      ...body.predictiveAdvisory.candidates.map((c) => c.actionType),
    ];
    expect(everyType.length).toBeGreaterThan(0);
    expect(everyType.every((t) => holdTypes.has(t))).toBe(true);
    expect(body.selectedActionType).toBe('self_equalizing_hold');
  });
});
