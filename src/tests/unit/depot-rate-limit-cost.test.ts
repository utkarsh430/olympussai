// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createWindowLimiter, takeAll } from '@/lib/depot/rateLimit';

/** A request that does several units of work takes that many slots at once. */

const WINDOW_MS = 60_000;
const limiter = (limit: number, clock = { t: 0 }) =>
  createWindowLimiter({ now: () => clock.t, limit, windowMs: WINDOW_MS, maxKeys: 10 });

describe('window limiter with a cost per request', () => {
  it('admits requests only while their whole cost fits', () => {
    const l = limiter(20);
    for (let i = 0; i < 5; i += 1) expect(l.take('x', 4).limited).toBe(false);
    expect(l.check('x', 4).limited).toBe(true);
    expect(l.take('x', 4).limited).toBe(true);
    // A refused request took nothing: one slot-sized request still does not fit.
    expect(l.check('x', 1).limited).toBe(true);
  });

  it('refuses a request whose cost is larger than the free slots, though some are free', () => {
    const l = limiter(10);
    expect(l.take('x', 4).limited).toBe(false);
    expect(l.take('x', 4).limited).toBe(false);
    expect(l.take('x', 4).limited).toBe(true);
    expect(l.take('x', 2).limited).toBe(false);
  });

  it('waits until enough of the oldest slots have expired for the cost', () => {
    const clock = { t: 0 };
    const l = limiter(4, clock);
    l.take('x', 1); // t = 0
    clock.t = 10_000;
    l.take('x', 1);
    clock.t = 20_000;
    l.take('x', 2); // full
    // A cost of 2 needs the hits from t = 0 and t = 10 s gone: 50 s from now.
    expect(l.check('x', 2)).toEqual({ limited: true, retryAfterSeconds: 50 });
    expect(l.check('x', 1)).toEqual({ limited: true, retryAfterSeconds: 40 });
    clock.t = 70_000;
    expect(l.take('x', 2).limited).toBe(false);
  });

  it('never admits a cost above the limit', () => {
    expect(limiter(3).take('x', 4)).toEqual({ limited: true, retryAfterSeconds: 60 });
  });

  it('charges each limit the cost of its check in takeAll', () => {
    const own = limiter(8);
    const all = limiter(100);
    expect(takeAll([{ limiter: own, key: 'me', cost: 4 }, { limiter: all, key: 'all', cost: 4 }]))
      .toEqual({ limited: false, retryAfterSeconds: 0 });
    expect(takeAll([{ limiter: own, key: 'me', cost: 4 }, { limiter: all, key: 'all', cost: 4 }]))
      .toEqual({ limited: false, retryAfterSeconds: 0 });
    expect(takeAll([{ limiter: own, key: 'me', cost: 4 }, { limiter: all, key: 'all', cost: 4 }]))
      .toEqual({ limited: true, retryAfterSeconds: 60 });
    // Eight taken from the shared limit, nothing for the refused request.
    for (let i = 0; i < 92; i += 1) expect(all.take('all').limited).toBe(false);
    expect(all.take('all').limited).toBe(true);
  });

  it('keeps a cost of one when none is given', () => {
    const l = limiter(2);
    expect(l.take('x').limited).toBe(false);
    expect(l.take('x').limited).toBe(false);
    expect(l.take('x').limited).toBe(true);
  });
});
