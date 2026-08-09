import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/commands.js', () => ({
  listActiveVehicleIds: vi.fn(),
}));

const { solve } = await import('../src/mpc/solver.js');
const { stateStore } = await import('../src/state/store.js');
const { listActiveVehicleIds } = await import('../src/db/commands.js');

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
    predictionHorizonControlPoints: 3,
    occupancyStaleSeconds: 120,
    occupancyCapacity: 60,
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
    stopState: 'off_route',
    currentStopId: null,
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
    expect(result.candidateActions).toHaveLength(1);
    expect(result.candidateActions[0]).toMatchObject({ actionType: 'two_way_hold', holdSeconds: 120 });
    expect(result.selectedActionType).toBe('two_way_hold');
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
});
