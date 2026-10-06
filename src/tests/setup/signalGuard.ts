import { afterEach } from 'vitest';

/**
 * Vitest setup (every test file): no test may send a real signal.
 *
 * The copilot kills its CLI child's process group with `process.kill(-pid)`.
 * Every test injects a fake kill, but a future test that gives a fake child a
 * pid and forgets the injection would signal a real process group (review L1).
 * So `process.kill` is replaced, for the whole run, by a guard that:
 *  - passes the call through only for a pid the test registered as a process it
 *    created itself (`allowTestSignal`, with the same pid or its group, -pid);
 *  - otherwise sends nothing, throws, and records the pid. Code under test may
 *    catch the throw (the group kill falls back on any error), so the record
 *    fails the test in `afterEach` as well.
 * A test that stubs `process.kill` itself (`vi.spyOn`) replaces the guard for
 * its own duration, and restoring the spy puts the guard back.
 */

const realKill = process.kill.bind(process);
let allowed = new Set<number>();
let violations: readonly number[] = [];

const GUARD_MESSAGE = 'process.kill refused: pid not created by this test';

/** Registers a pid the test created itself; signals to it and its group pass through. */
export function allowTestSignal(pid: number): void {
  allowed = new Set([...allowed, pid]);
}

/** Returns and clears the refused pids, for a test of the guard itself. */
export function takeSignalViolations(): readonly number[] {
  const taken = violations;
  violations = [];
  return taken;
}

function guardedKill(pid: number, signal?: string | number): true {
  if (allowed.has(Math.abs(pid)) && pid !== 0 && pid !== -1) return realKill(pid, signal);
  violations = [...violations, pid];
  throw new Error(`${GUARD_MESSAGE} (${pid})`);
}

process.kill = guardedKill;

afterEach(() => {
  allowed = new Set();
  const refused = takeSignalViolations();
  if (refused.length > 0) {
    throw new Error(`${GUARD_MESSAGE}: ${refused.join(', ')}`);
  }
});
