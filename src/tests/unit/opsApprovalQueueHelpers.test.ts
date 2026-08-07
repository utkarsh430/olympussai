import { describe, it, expect } from 'vitest';
import { decisionStateOf, isDisruptiveActionType, DISRUPTIVE_ACTION_TYPES } from '@/lib/auth/rbac/repo';

describe('decisionStateOf', () => {
  it('is pending when neither consumed nor rejected', () => {
    expect(decisionStateOf({ consumedAt: null, rejectedAt: null })).toBe('pending');
  });

  it('is approved once consumed', () => {
    expect(decisionStateOf({ consumedAt: '2026-08-06T00:00:00.000Z', rejectedAt: null })).toBe('approved');
  });

  it('is rejected once rejected, even if a (legacy/inconsistent) consumedAt is also set', () => {
    expect(decisionStateOf({ consumedAt: '2026-08-06T00:00:00.000Z', rejectedAt: '2026-08-06T00:00:00.000Z' })).toBe('rejected');
  });
});

describe('isDisruptiveActionType', () => {
  it('accepts exactly the four action types this ticket names', () => {
    expect(DISRUPTIVE_ACTION_TYPES).toEqual(['stop_skip', 'short_turn', 'standby_injection', 'boarding_limit']);
    for (const type of DISRUPTIVE_ACTION_TYPES) {
      expect(isDisruptiveActionType(type)).toBe(true);
    }
  });

  it('rejects non-disruptive action types like override or speed_guidance', () => {
    expect(isDisruptiveActionType('override')).toBe(false);
    expect(isDisruptiveActionType('speed_guidance')).toBe(false);
    expect(isDisruptiveActionType('terminal_dispatch_hold')).toBe(false);
  });
});
