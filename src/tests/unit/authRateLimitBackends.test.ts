import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  _setRedisClientForTests,
  isRedisConfigured,
  retryAfterSecondsFromMs,
  tryRedis,
} from '@/lib/redis/client';
import {
  checkRateLimit,
  clearFailures,
  clientIpFrom,
  recordFailure,
  _resetInMemoryRateLimitForTests,
} from '@/lib/auth/rate-limit';
import { FakeRedis, UnreachableRedis } from '@/tests/helpers/fakeRedis';

/**
 * Failed-login limiter: 5 FAILURES per 15-minute window, checked before the
 * credential comparison and recorded only after one is rejected. Both
 * backends must be indistinguishable from the route handlers' point of view,
 * so the behavioural block runs against each in turn — the per-process Map
 * (REDIS_URL unset) and the shared store (REDIS_URL set, driven by the
 * in-memory fake, never a live server).
 */
const backends = [
  { name: 'in-memory backend (REDIS_URL unset)', makeClient: () => null },
  { name: 'redis backend', makeClient: () => new FakeRedis() },
] as const;

describe.each(backends)('failed-login limiter — $name', ({ makeClient }) => {
  beforeEach(() => {
    _setRedisClientForTests(makeClient());
    _resetInMemoryRateLimitForTests();
  });

  afterEach(() => {
    _setRedisClientForTests(undefined);
  });

  it('reports an untouched key as not limited and records nothing while checking', async () => {
    expect(await checkRateLimit('1.2.3.4:nobody@example.test')).toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
    // A pure check must not consume budget: four failures after any number of
    // checks still leaves the key under the limit.
    for (let i = 0; i < 10; i += 1) await checkRateLimit('1.2.3.4:nobody@example.test');
    for (let i = 0; i < 4; i += 1) await recordFailure('1.2.3.4:nobody@example.test');
    expect((await checkRateLimit('1.2.3.4:nobody@example.test')).limited).toBe(false);
  });

  it('limits on the fifth failure and reports a positive Retry-After', async () => {
    const key = '10.0.0.1:driver@example.test';
    for (let i = 0; i < 4; i += 1) {
      expect((await recordFailure(key)).limited).toBe(false);
    }
    const fifth = await recordFailure(key);
    expect(fifth.limited).toBe(true);
    expect(fifth.retryAfterSeconds).toBeGreaterThan(0);
    expect(fifth.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);

    // And the pre-check the routes run before touching credentials now agrees.
    const preCheck = await checkRateLimit(key);
    expect(preCheck.limited).toBe(true);
    expect(preCheck.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('isolates keys from one another', async () => {
    for (let i = 0; i < 5; i += 1) await recordFailure('10.0.0.2:a@example.test');
    expect((await checkRateLimit('10.0.0.2:a@example.test')).limited).toBe(true);
    expect((await checkRateLimit('10.0.0.2:b@example.test')).limited).toBe(false);
    expect((await checkRateLimit('10.0.0.3:a@example.test')).limited).toBe(false);
  });

  it('clears a key on successful login', async () => {
    const key = '10.0.0.4:ops@example.test';
    for (let i = 0; i < 5; i += 1) await recordFailure(key);
    expect((await checkRateLimit(key)).limited).toBe(true);

    await clearFailures(key);
    expect((await checkRateLimit(key)).limited).toBe(false);
    // And the budget is genuinely restored, not merely unreported.
    for (let i = 0; i < 4; i += 1) {
      expect((await recordFailure(key)).limited).toBe(false);
    }
  });
});

describe('failed-login limiter — window expiry (redis backend)', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    _setRedisClientForTests(redis);
    _resetInMemoryRateLimitForTests();
  });

  afterEach(() => {
    _setRedisClientForTests(undefined);
  });

  it('keeps the window pinned to the first failure and releases the key once it elapses', async () => {
    const key = '10.0.0.5:attacker@example.test';
    for (let i = 0; i < 5; i += 1) await recordFailure(key);
    expect((await checkRateLimit(key)).limited).toBe(true);

    // 14 minutes in, still locked — later failures did not extend the window,
    // but they did not shorten it either.
    redis.advance(14 * 60_000);
    expect((await checkRateLimit(key)).limited).toBe(true);

    redis.advance(61_000);
    expect((await checkRateLimit(key)).limited).toBe(false);
  });

  it('repairs a counter that somehow lost its TTL instead of locking the key out forever', async () => {
    const key = '10.0.0.6:orphan@example.test';
    // FakeRedis.incr reproduces real Redis's "create with no expiry" for a
    // missing key, which is the exact hazard src/lib/redis/window.ts repairs.
    await redis.incr('rl:auth:' + key);
    expect(await redis.pttl('rl:auth:' + key)).toBe(-1);

    await recordFailure(key);
    expect(await redis.pttl('rl:auth:' + key)).toBeGreaterThan(0);
  });
});

describe('failed-login limiter — redis configured but unreachable', () => {
  let redis: UnreachableRedis;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    redis = new UnreachableRedis();
    _setRedisClientForTests(redis);
    _resetInMemoryRateLimitForTests();
  });

  afterEach(() => {
    _setRedisClientForTests(undefined);
    vi.restoreAllMocks();
  });

  it('still limits brute force — it degrades to the in-process counter, it does not fail open', async () => {
    const key = '10.0.0.7:brute@example.test';
    for (let i = 0; i < 4; i += 1) {
      expect((await recordFailure(key)).limited).toBe(false);
    }
    expect((await recordFailure(key)).limited).toBe(true);
    expect((await checkRateLimit(key)).limited).toBe(true);
  });

  it('does not fail closed — a Redis outage never locks out an account that has no failures', async () => {
    expect((await checkRateLimit('10.0.0.8:innocent@example.test')).limited).toBe(false);
  });

  it('stops calling a dead Redis after a short streak instead of paying a failing round trip per login', async () => {
    for (let i = 0; i < 3; i += 1) await recordFailure('10.0.0.9:probe@example.test');
    const attemptsAfterStreak = redis.attempts;
    expect(attemptsAfterStreak).toBeGreaterThan(0);

    for (let i = 0; i < 5; i += 1) await checkRateLimit('10.0.0.9:probe@example.test');
    expect(redis.attempts).toBe(attemptsAfterStreak);
  });
});

describe('redis client wiring', () => {
  afterEach(() => {
    _setRedisClientForTests(undefined);
    delete process.env.REDIS_URL;
    delete process.env.REDIS_TOKEN;
    vi.restoreAllMocks();
  });

  it('is off when REDIS_URL is unset, which is what keeps local dev and CI Redis-free', () => {
    _setRedisClientForTests(undefined);
    delete process.env.REDIS_URL;
    expect(isRedisConfigured()).toBe(false);
  });

  it('treats REDIS_URL without REDIS_TOKEN as a loud misconfiguration, not as "Redis enabled"', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    _setRedisClientForTests(undefined);
    process.env.REDIS_URL = 'https://example.upstash.io';
    delete process.env.REDIS_TOKEN;

    expect(isRedisConfigured()).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('REDIS_TOKEN'));
  });

  it('tryRedis returns null (never throws) so a caller can only ever fall back, not 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    _setRedisClientForTests(new UnreachableRedis());
    await expect(tryRedis(async (redis) => redis.incr('anything'))).resolves.toBeNull();

    _setRedisClientForTests(null);
    await expect(tryRedis(async (redis) => redis.incr('anything'))).resolves.toBeNull();
  });

  it('rounds Retry-After up to whole seconds, never below one', () => {
    expect(retryAfterSecondsFromMs(0)).toBe(1);
    expect(retryAfterSecondsFromMs(1)).toBe(1);
    expect(retryAfterSecondsFromMs(1_000)).toBe(1);
    expect(retryAfterSecondsFromMs(1_001)).toBe(2);
    expect(retryAfterSecondsFromMs(15 * 60_000)).toBe(900);
  });
});

describe('clientIpFrom', () => {
  it('prefers the first x-forwarded-for hop, falls back to x-real-ip, then "unknown"', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18' }))).toBe('203.0.113.9');
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
    expect(clientIpFrom(new Headers())).toBe('unknown');
  });
});
