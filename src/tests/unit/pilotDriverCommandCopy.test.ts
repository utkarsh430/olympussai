import { describe, it, expect } from 'vitest';
import { commandActionLabel, commandReason } from '@/lib/pilotDriver/commandCopy';
import type { Command } from '@/models/control';

function baseCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: 'cmd-1',
    recommendationId: null,
    vehicleId: 'veh-1',
    tripId: null,
    actionType: 'speed_guidance',
    targetStopId: null,
    parameters: {},
    dispatcherActionId: 'd1',
    ttlSeconds: 120,
    validFrom: '2026-08-06T06:00:00Z',
    expiresAt: '2026-08-06T06:02:00Z',
    policyVersion: null,
    status: 'delivered',
    deliveredAt: '2026-08-06T06:00:00Z',
    acknowledgedAt: null,
    acknowledgementReason: null,
    ...overrides,
  };
}

describe('commandActionLabel', () => {
  it('maps every action type to a plain-language label, not the raw enum value', () => {
    const actionTypes: Command['actionType'][] = [
      'terminal_dispatch_hold',
      'two_way_hold',
      'self_equalizing_hold',
      'speed_guidance',
      'stop_skip',
      'short_turn',
      'deadhead',
      'boarding_limit',
      'standby_injection',
    ];
    for (const actionType of actionTypes) {
      const label = commandActionLabel(actionType);
      expect(label).not.toBe(actionType);
      expect(label.includes('_')).toBe(false);
    }
  });
});

describe('commandReason', () => {
  it('prefers parameters.reason when present', () => {
    const command = baseCommand({ parameters: { reason: 'Bunching with the vehicle ahead' } });
    expect(commandReason(command)).toBe('Bunching with the vehicle ahead');
  });

  it('falls back to a target-stop-based reason when no reason parameter is set', () => {
    const command = baseCommand({ targetStopId: 'S12' });
    expect(commandReason(command)).toContain('S12');
  });

  it('never returns a blank string when no reason or target stop is available', () => {
    const command = baseCommand();
    expect(commandReason(command).length).toBeGreaterThan(0);
  });
});
