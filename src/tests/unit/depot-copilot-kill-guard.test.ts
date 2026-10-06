import { afterEach, describe, expect, it, vi } from 'vitest';
import { killProcessGroup } from '@/lib/depot/copilot/cli/kill';

describe('review L1: the group kill never targets the server, every process or a bad pid', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([0, 1, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])('sends nothing for %s', (pid) => {
    // The stub replaces process.kill outright: this test can never send a real signal.
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    killProcessGroup(pid);
    expect(kill).not.toHaveBeenCalled();
  });
});
