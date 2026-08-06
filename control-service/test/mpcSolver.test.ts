import { describe, it, expect, beforeEach } from 'vitest';
import { solve } from '../src/mpc/solver.js';
import { stateStore } from '../src/state/store.js';

describe('mpc.solve', () => {
  beforeEach(() => {
    stateStore._resetForTests();
  });

  it('throws a 404 AppError when there is no active policy for the route-direction', async () => {
    await expect(solve('rd-unknown')).rejects.toMatchObject({
      code: 'no_active_policy',
      status: 404,
    });
  });

  it('produces a self-equalizing hold recommendation clamped to the policy max hold', async () => {
    stateStore.loadActivePolicies([
      {
        id: 'policy-1',
        routeDirectionId: 'rd-1',
        operatingPeriod: 'all',
        dayType: 'all',
        targetHeadwaySeconds: 600,
        bunchedThresholdRatio: 0.25,
        warningThresholdRatio: 0.5,
        kf: 0.3,
        kb: 0.3,
        selfEqualizingK: 2, // deliberately large so the raw hold exceeds maxHoldSeconds
        maxHoldSeconds: 60,
        cooldownSeconds: 30,
      },
    ]);
    stateStore.loadHeadwayStates([
      {
        id: 'h-1',
        routeDirectionId: 'rd-1',
        leaderVehicleId: 'veh-leader',
        followerVehicleId: 'veh-follower',
        hFwdSeconds: 300,
        hBwdSeconds: null,
        targetHeadwaySeconds: 600,
        deviationSeconds: -300, // follower is bunched onto the leader
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
    expect(result.controllerVersion).toBe('self-equalizing-v1');
  });

  it('returns no candidates when headway is already at target', async () => {
    stateStore.loadActivePolicies([
      {
        id: 'policy-2',
        routeDirectionId: 'rd-2',
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
      },
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
});
