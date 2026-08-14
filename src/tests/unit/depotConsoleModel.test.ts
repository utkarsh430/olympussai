import { describe, expect, it } from 'vitest';
import type { HeadwayCountdown } from '@/lib/controlService/headwayCountdown';
import {
  countdownTone,
  depotVehiclesOnCorridors,
  formatCountdown,
  tightestCountdown,
} from '@/lib/ops/depotConsoleModel';

function countdown(overrides: Partial<HeadwayCountdown> & Pick<HeadwayCountdown, 'pairId'>): HeadwayCountdown {
  const countdownSeconds = overrides.countdownSeconds ?? 120;
  return {
    routeDirectionId: 'rd-1',
    leaderVehicleId: 'LEADER',
    followerVehicleId: 'FOLLOWER',
    targetHeadwaySeconds: 600,
    currentHeadwaySeconds: 480,
    countdownSeconds,
    overdue: countdownSeconds !== null && countdownSeconds < 0,
    ...overrides,
  };
}

describe('tightestCountdown', () => {
  it('picks the smallest cushion, including a negative one', () => {
    const tightest = tightestCountdown([
      countdown({ pairId: 'a', countdownSeconds: 300 }),
      countdown({ pairId: 'b', countdownSeconds: -45 }),
      countdown({ pairId: 'c', countdownSeconds: 30 }),
    ]);

    expect(tightest?.pairId).toBe('b');
  });

  it('SKIPS a pair with no sample rather than treating it as zero cushion', () => {
    // The inversion this guards: null means "no reading", and reading it as 0
    // would make an unmeasured pair the most urgent thing on the strip.
    const tightest = tightestCountdown([
      countdown({ pairId: 'unmeasured', countdownSeconds: null }),
      countdown({ pairId: 'real', countdownSeconds: 200 }),
    ]);

    expect(tightest?.pairId).toBe('real');
  });

  it('returns null when nothing has a sample, rather than inventing one', () => {
    expect(tightestCountdown([countdown({ pairId: 'a', countdownSeconds: null })])).toBeNull();
    expect(tightestCountdown([])).toBeNull();
  });

  it('breaks a tie deterministically so the strip does not flicker between renders', () => {
    const pairs = [
      countdown({ pairId: 'zeta', countdownSeconds: 60 }),
      countdown({ pairId: 'alpha', countdownSeconds: 60 }),
    ];

    expect(tightestCountdown(pairs)?.pairId).toBe('alpha');
    expect(tightestCountdown([...pairs].reverse())?.pairId).toBe('alpha');
  });
});

describe('formatCountdown', () => {
  it('renders a dash for no reading, and keeps the sign on an overdue one', () => {
    expect(formatCountdown(null)).toBe('—');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(45)).toBe('0:45');
    expect(formatCountdown(605)).toBe('10:05');
    expect(formatCountdown(-90)).toBe('-1:30');
  });
});

describe('countdownTone', () => {
  it('never colours a reading that does not exist', () => {
    expect(countdownTone(null, 600)).toBe('default');
  });

  it('grades against the corridor’s own target, not a fixed threshold', () => {
    expect(countdownTone(-1, 600)).toBe('critical');
    expect(countdownTone(100, 600)).toBe('warn');
    expect(countdownTone(200, 600)).toBe('good');
    // The same 100s cushion is comfortable on a corridor with a 120s target.
    expect(countdownTone(100, 120)).toBe('good');
  });
});

describe('depotVehiclesOnCorridors', () => {
  it('sums the per-corridor counts', () => {
    const corridors = [4, 1, 7].map((depotVehicleCount, index) => ({
      routeDirectionId: `rd-${index}`,
      routeId: String(index),
      directionCode: 'OUT',
      isLoop: false,
      hasActivePolicy: true,
      depotVehicleCount,
    }));

    expect(depotVehiclesOnCorridors(corridors)).toBe(12);
  });

  it('is zero for a depot on no mapped corridor', () => {
    expect(depotVehiclesOnCorridors([])).toBe(0);
  });
});
