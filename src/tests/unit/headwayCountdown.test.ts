import { describe, it, expect } from 'vitest';
import { computeHeadwayCountdowns } from '@/lib/controlService/headwayCountdown';
import type { HeadwayPairMetric } from '@/models/control';

function pair(overrides: Partial<HeadwayPairMetric> = {}): HeadwayPairMetric {
  return {
    id: 'h-1',
    routeDirectionId: 'rd-1',
    leaderVehicleId: 'veh-a',
    followerVehicleId: 'veh-b',
    gapMeters: 500,
    hFwdSeconds: 200,
    hBwdSeconds: 100,
    targetHeadwaySeconds: 300,
    deviationSeconds: -100,
    confidence: 0.9,
    ...overrides,
  };
}

describe('computeHeadwayCountdowns', () => {
  it('returns positive cushion when the current headway is under target', () => {
    const [countdown] = computeHeadwayCountdowns([pair({ hFwdSeconds: 200, targetHeadwaySeconds: 300 })]);
    expect(countdown?.countdownSeconds).toBe(100);
    expect(countdown?.overdue).toBe(false);
  });

  it('flags overdue once the current headway exceeds target', () => {
    const [countdown] = computeHeadwayCountdowns([pair({ hFwdSeconds: 350, targetHeadwaySeconds: 300 })]);
    expect(countdown?.countdownSeconds).toBe(-50);
    expect(countdown?.overdue).toBe(true);
  });

  it('reports null (not zero) when there is no current forward-headway sample', () => {
    const [countdown] = computeHeadwayCountdowns([pair({ hFwdSeconds: null })]);
    expect(countdown?.countdownSeconds).toBeNull();
    expect(countdown?.currentHeadwaySeconds).toBeNull();
    expect(countdown?.overdue).toBe(false);
  });

  it('preserves pair identity fields for lookup by follower vehicle', () => {
    const [countdown] = computeHeadwayCountdowns([pair({ id: 'h-9', followerVehicleId: 'veh-z', leaderVehicleId: 'veh-y' })]);
    expect(countdown).toMatchObject({ pairId: 'h-9', followerVehicleId: 'veh-z', leaderVehicleId: 'veh-y' });
  });

  it('maps every pair in the input, in order', () => {
    const pairs = [pair({ id: 'h-1' }), pair({ id: 'h-2', followerVehicleId: 'veh-c' })];
    const countdowns = computeHeadwayCountdowns(pairs);
    expect(countdowns.map((c) => c.pairId)).toEqual(['h-1', 'h-2']);
  });
});
