import { describe, expect, it } from 'vitest';
import { allowTestSignal, takeSignalViolations } from '@/tests/setup/signalGuard';

/**
 * Above every real pid limit (macOS 99,998, Linux 4,194,304), and signal 0 only
 * asks whether a process exists: even with no guard these lines send nothing.
 */
const NO_SUCH_PID = 2 ** 30;

describe('the vitest setup guard on process.kill', () => {
  it('throws for a pid the test did not create and records it so the test fails', () => {
    expect(() => process.kill(NO_SUCH_PID, 0)).toThrow(/not created by this test/);
    expect(() => process.kill(-NO_SUCH_PID, 0)).toThrow(/not created by this test/);
    expect(takeSignalViolations()).toEqual([NO_SUCH_PID, -NO_SUCH_PID]);
  });

  it('refuses the server-wide targets 0 and -1 as well', () => {
    expect(() => process.kill(0, 0)).toThrow(/not created by this test/);
    expect(() => process.kill(-1, 0)).toThrow(/not created by this test/);
    expect(takeSignalViolations()).toEqual([0, -1]);
  });

  it('passes a pid the test registered as its own through to the real call', () => {
    allowTestSignal(NO_SUCH_PID);
    // Reaches the real process.kill, which finds no such process.
    expect(() => process.kill(NO_SUCH_PID, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    expect(takeSignalViolations()).toEqual([]);
  });
});
