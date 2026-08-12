// Unit coverage for the commandDeliverySweep backstop job
// (src/scheduler/commandDeliverySweep.ts): delivers every candidate,
// treats a 409/410 as an expected lost race against the inline delivery
// path rather than a failure, and never lets one bad row abort the batch.
import { describe, it, expect, vi } from 'vitest';
import { runCommandDeliverySweep } from '../src/scheduler/commandDeliverySweep.js';
import { AppError } from '../src/lib/errors.js';

function fakeDeliverAndNotifyResult(id: string) {
  return {
    command: { id, status: 'delivered' } as never,
    delivery: { delivered: true, attempts: 1, idempotencyKey: `${id}:delivered:v1`, status: 200 },
  };
}

describe('runCommandDeliverySweep', () => {
  it('delivers every candidate returned by listCandidates', async () => {
    const listCandidates = vi.fn().mockResolvedValue(['cmd-1', 'cmd-2', 'cmd-3']);
    const deliver = vi.fn().mockImplementation((id: string) => Promise.resolve(fakeDeliverAndNotifyResult(id)));

    const result = await runCommandDeliverySweep({ listCandidates, deliver });

    expect(deliver).toHaveBeenCalledTimes(3);
    expect(deliver).toHaveBeenCalledWith('cmd-1');
    expect(deliver).toHaveBeenCalledWith('cmd-2');
    expect(deliver).toHaveBeenCalledWith('cmd-3');
    expect(result).toEqual({ candidates: 3, delivered: 3, lostRace: 0, failed: 0 });
  });

  it('requests candidates bounded by the sweep batch limit', async () => {
    const listCandidates = vi.fn().mockResolvedValue([]);
    await runCommandDeliverySweep({ listCandidates, deliver: vi.fn() });
    expect(listCandidates).toHaveBeenCalledWith(50);
  });

  it.each([
    ['409 vehicle_has_active_command', new AppError('vehicle_has_active_command', 'in flight', 409)],
    ['409 command_not_authorized', new AppError('command_not_authorized', 'not authorized', 409)],
    ['410 command_expired', new AppError('command_expired', 'expired', 410)],
  ])('swallows a %s as an expected lost race, not a failure', async (_label, error) => {
    const listCandidates = vi.fn().mockResolvedValue(['cmd-1']);
    const deliver = vi.fn().mockRejectedValueOnce(error);

    const result = await runCommandDeliverySweep({ listCandidates, deliver });

    expect(result).toEqual({ candidates: 1, delivered: 0, lostRace: 1, failed: 0 });
  });

  it('never lets one bad row abort the batch - a genuine failure is counted and swept past', async () => {
    const listCandidates = vi.fn().mockResolvedValue(['cmd-bad', 'cmd-good']);
    const deliver = vi.fn().mockImplementation((id: string) => {
      if (id === 'cmd-bad') return Promise.reject(new Error('connection reset'));
      return Promise.resolve(fakeDeliverAndNotifyResult(id));
    });

    const result = await runCommandDeliverySweep({ listCandidates, deliver });

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ candidates: 2, delivered: 1, lostRace: 0, failed: 1 });
  });

  it('does nothing when nothing is awaiting delivery', async () => {
    const listCandidates = vi.fn().mockResolvedValue([]);
    const deliver = vi.fn();

    const result = await runCommandDeliverySweep({ listCandidates, deliver });

    expect(deliver).not.toHaveBeenCalled();
    expect(result).toEqual({ candidates: 0, delivered: 0, lostRace: 0, failed: 0 });
  });
});
