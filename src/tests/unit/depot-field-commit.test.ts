import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMIT_PAUSE_MS,
  createCommitScheduler,
  evaluateField,
} from '@/lib/depot/rebalance/fieldCommit';
import { parseSparePercent } from '@/lib/depot/rebalance/scenarioParsers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createCommitScheduler', () => {
  it('waits for a 300 ms pause in typing and commits only the last value', () => {
    const commit = vi.fn();
    const scheduler = createCommitScheduler<number>(commit);
    scheduler.schedule(1);
    vi.advanceTimersByTime(100);
    scheduler.schedule(15);
    vi.advanceTimersByTime(100);
    scheduler.schedule(150);
    vi.advanceTimersByTime(COMMIT_PAUSE_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(COMMIT_PAUSE_MS).toBe(300);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(150);
  });

  it('commits at once on flush (blur or Enter) and not again when the pause ends', () => {
    const commit = vi.fn();
    const scheduler = createCommitScheduler<number>(commit);
    scheduler.schedule(12);
    scheduler.flush();
    expect(commit).toHaveBeenCalledWith(12);
    vi.advanceTimersByTime(COMMIT_PAUSE_MS * 2);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does nothing on flush when nothing is pending', () => {
    const commit = vi.fn();
    createCommitScheduler<number>(commit).flush();
    expect(commit).not.toHaveBeenCalled();
  });

  it('drops a pending value on cancel', () => {
    const commit = vi.fn();
    const scheduler = createCommitScheduler<number>(commit);
    scheduler.schedule(3);
    scheduler.cancel();
    vi.advanceTimersByTime(COMMIT_PAUSE_MS * 2);
    scheduler.flush();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('evaluateField', () => {
  it('reads blank as empty, a parsed number as valid and anything else as invalid', () => {
    expect(evaluateField('  ', parseSparePercent)).toEqual({ kind: 'empty' });
    expect(evaluateField('12%', parseSparePercent)).toEqual({ kind: 'valid', value: 12 });
    const bad = evaluateField('1x', parseSparePercent);
    expect(bad.kind).toBe('invalid');
    expect(bad.kind === 'invalid' && bad.error).toMatch(/must be a number/);
  });
});
