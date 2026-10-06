// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createWindowLimiter, requestIdentity, takeAll } from '@/lib/depot/rateLimit';

const limiter = (limit: number, maxKeys = 10, clock = { t: 0 }) =>
  createWindowLimiter({ now: () => clock.t, limit, windowMs: 60_000, maxKeys });

const CLAIMS = { project: 'upsrtc', role: 'project-access', iat: 100, exp: 200 };

describe('shared window limiter', () => {
  it('forgets the least recently used key, not the first inserted', () => {
    const l = limiter(2, 2);
    l.take('a');
    l.take('b');
    l.take('a'); // a is now full and the most recent
    l.take('c'); // evicts b
    expect(l.size()).toBe(2);
    expect(l.take('a').limited).toBe(true);
  });

  it('checks without taking a slot', () => {
    const l = limiter(1);
    expect(l.check('x').limited).toBe(false);
    expect(l.check('x').limited).toBe(false);
    expect(l.take('x').limited).toBe(false);
    expect(l.check('x')).toEqual({ limited: true, retryAfterSeconds: 60 });
  });

  it('takes from every limit only when all of them have room', () => {
    const own = limiter(5);
    const all = limiter(1);
    all.take('all');
    const refused = takeAll([
      { limiter: own, key: 'me' },
      { limiter: all, key: 'all' },
    ]);
    expect(refused.limited).toBe(true);
    // The per-identity slot was not spent by the refused request.
    for (let i = 0; i < 5; i += 1) expect(own.take('me').limited).toBe(false);
  });

  it('answers with the longest wait among the limits that refuse', () => {
    const clock = { t: 0 };
    const a = limiter(1, 10, clock);
    const b = limiter(1, 10, clock);
    a.take('k');
    clock.t = 30_000;
    b.take('k');
    expect(takeAll([{ limiter: a, key: 'k' }, { limiter: b, key: 'k' }])).toEqual({
      limited: true,
      retryAfterSeconds: 60,
    });
  });
});

describe('requestIdentity', () => {
  const headers = (h: Record<string, string> = {}): Headers => new Headers(h);

  it('keys on the session id when the token has one, as an opaque hash', () => {
    const one = requestIdentity({ ...CLAIMS, sid: 's-1' }, headers(), {});
    expect(one).toBe(requestIdentity({ ...CLAIMS, iat: 999, sid: 's-1' }, headers(), {}));
    expect(one).not.toBe(requestIdentity({ ...CLAIMS, sid: 's-2' }, headers(), {}));
    expect(one).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keys a token without one on its decoded claims', () => {
    expect(requestIdentity(CLAIMS, headers(), {})).toBe(requestIdentity(CLAIMS, headers(), {}));
    expect(requestIdentity(CLAIMS, headers(), {})).not.toBe(
      requestIdentity({ ...CLAIMS, iat: 101 }, headers(), {}),
    );
  });

  it('ignores client address headers unless the server names one', () => {
    const base = requestIdentity(CLAIMS, headers(), {});
    expect(requestIdentity(CLAIMS, headers({ 'x-forwarded-for': '1.2.3.4' }), {})).toBe(base);
  });

  it('combines the address from the trusted header, taking the entry the proxy added', () => {
    const env = { DEPOT_TRUSTED_IP_HEADER: 'X-Forwarded-For' };
    const a = requestIdentity(CLAIMS, headers({ 'x-forwarded-for': '9.9.9.9, 1.2.3.4' }), env);
    const b = requestIdentity(CLAIMS, headers({ 'x-forwarded-for': '1.2.3.5' }), env);
    expect(a).toBe(requestIdentity(CLAIMS, headers({ 'x-forwarded-for': '1.2.3.4' }), env));
    expect(a).not.toBe(b);
    // A value that is not an address is not used.
    expect(requestIdentity(CLAIMS, headers({ 'x-forwarded-for': 'evil<>' }), env)).toBe(
      requestIdentity(CLAIMS, headers(), env),
    );
  });
});
