import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('recordCopilotCall', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('allows calls under the per-window limit', async () => {
    const { recordCopilotCall } = await import('@/lib/copilot/rateLimit');
    for (let i = 0; i < 20; i += 1) {
      expect(recordCopilotCall('user-a').limited).toBe(false);
    }
  });

  it('limits a user who exceeds the per-window call count, without affecting other users', async () => {
    const { recordCopilotCall } = await import('@/lib/copilot/rateLimit');
    for (let i = 0; i < 20; i += 1) recordCopilotCall('user-b');
    const result = recordCopilotCall('user-b');

    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(recordCopilotCall('user-c').limited).toBe(false);
  });
});
