import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _setRedisClientForTests } from '@/lib/redis/client';
import { recordCopilotCall, _resetInMemoryCopilotRateLimitForTests } from '@/lib/copilot/rateLimit';
import { FakeRedis, UnreachableRedis } from '@/tests/helpers/fakeRedis';

/**
 * The copilot limiter counts CALLS regardless of outcome (20 per 5 min),
 * unlike the auth limiter's failures-only accounting. Both backends must
 * agree on that, so every behavioural case below runs twice — once against
 * the in-process Map (REDIS_URL unset, the default everywhere) and once
 * against the shared store (REDIS_URL set), driven by the in-memory fake in
 * src/tests/helpers/fakeRedis.ts so CI never needs a live Redis.
 *
 * State is reset through the modules' own test-only resets rather than
 * `vi.resetModules()`: the limiter and this file must share ONE instance of
 * src/lib/redis/client.ts, or the client override installed here would not be
 * the one the limiter reads.
 */
const backends = [
  { name: 'in-memory backend (REDIS_URL unset)', makeClient: () => null },
  { name: 'redis backend', makeClient: () => new FakeRedis() },
] as const;

describe.each(backends)('recordCopilotCall — $name', ({ makeClient }) => {
  beforeEach(() => {
    _setRedisClientForTests(makeClient());
    _resetInMemoryCopilotRateLimitForTests();
  });

  afterEach(() => {
    _setRedisClientForTests(undefined);
  });

  it('allows calls under the per-window limit', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await recordCopilotCall('user-a')).limited).toBe(false);
    }
  });

  it('limits a user who exceeds the per-window call count, without affecting other users', async () => {
    for (let i = 0; i < 20; i += 1) await recordCopilotCall('user-b');
    const result = await recordCopilotCall('user-b');

    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect((await recordCopilotCall('user-c')).limited).toBe(false);
  });

  it('reports a Retry-After no larger than the window itself', async () => {
    for (let i = 0; i < 21; i += 1) await recordCopilotCall('user-d');
    const { retryAfterSeconds } = await recordCopilotCall('user-d');
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBeLessThanOrEqual(5 * 60);
  });
});

describe('recordCopilotCall — window expiry (redis backend)', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    _setRedisClientForTests(redis);
    _resetInMemoryCopilotRateLimitForTests();
  });

  afterEach(() => {
    _setRedisClientForTests(undefined);
  });

  it('starts a fresh window once the previous one elapses, and never extends a window mid-flight', async () => {
    for (let i = 0; i < 21; i += 1) await recordCopilotCall('user-e');
    expect((await recordCopilotCall('user-e')).limited).toBe(true);

    // Still inside the original 5-minute window: the extra calls above must
    // NOT have pushed the reset out (fixed window, pinned by the first call).
    redis.advance(4 * 60_000);
    expect((await recordCopilotCall('user-e')).limited).toBe(true);

    redis.advance(61_000); // past the original reset
    expect((await recordCopilotCall('user-e')).limited).toBe(false);
  });
});

describe('recordCopilotCall — redis configured but unreachable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    _setRedisClientForTests(new UnreachableRedis());
    _resetInMemoryCopilotRateLimitForTests();
  });

  afterEach(() => {
    _setRedisClientForTests(undefined);
    vi.restoreAllMocks();
  });

  it('degrades to the in-process counter rather than allowing unlimited LLM spend', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await recordCopilotCall('user-f')).limited).toBe(false);
    }
    expect((await recordCopilotCall('user-f')).limited).toBe(true);
  });
});
