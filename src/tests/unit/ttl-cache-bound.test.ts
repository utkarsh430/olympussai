import { describe, expect, it } from 'vitest';
import { TtlCache } from '@/lib/upsrtc/cache';

/** A cache keyed on what callers ask for must not grow for the life of the process. */

const TTL_MS = 1_000;
const BOUND = 3;

describe('TtlCache size bound', () => {
  it('holds no more keys than its bound, oldest out first, fresh and last good alike', () => {
    const cache = new TtlCache<string>(TTL_MS, { maxKeys: BOUND });
    for (let i = 0; i < BOUND + 2; i += 1) cache.set(`k${i}`, `v${i}`, 0);
    expect(cache.sizes()).toEqual({ fresh: BOUND, lastGood: BOUND });
    expect(cache.get('k0', 0)).toBeNull();
    expect(cache.getLastGood('k0')).toBeNull();
    expect(cache.getLastGood('k1')).toBeNull();
    expect(cache.get('k2', 0)).toBe('v2');
    expect(cache.get('k4', 0)).toBe('v4');
  });

  it('counts a key set again as the newest', () => {
    const cache = new TtlCache<string>(TTL_MS, { maxKeys: BOUND });
    cache.set('a', '1', 0);
    cache.set('b', '1', 0);
    cache.set('c', '1', 0);
    cache.set('a', '2', 0);
    cache.set('d', '1', 0); // evicts b, the oldest now
    expect(cache.getLastGood('b')).toBeNull();
    expect(cache.get('a', 0)).toBe('2');
    expect(cache.sizes().lastGood).toBe(BOUND);
  });

  it('removes an expired fresh entry when it is read, keeping the last good one', () => {
    const cache = new TtlCache<string>(TTL_MS, { maxKeys: BOUND });
    cache.set('a', '1', 0);
    expect(cache.get('a', TTL_MS + 1)).toBeNull();
    expect(cache.sizes()).toEqual({ fresh: 0, lastGood: 1 });
    expect(cache.getLastGood('a')?.value).toBe('1');
  });

  it('keeps every key when no bound is given, as before', () => {
    const cache = new TtlCache<string>(TTL_MS);
    for (let i = 0; i < 50; i += 1) cache.set(`k${i}`, 'v', 0);
    expect(cache.sizes()).toEqual({ fresh: 50, lastGood: 50 });
    expect(cache.getLastGood('k0')?.value).toBe('v');
  });
});
