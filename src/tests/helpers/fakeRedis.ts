/**
 * In-memory stand-in for the `RedisLike` seam in src/lib/redis/client.ts.
 *
 * Exists so the Redis-backed branch of the two rate limiters and the
 * control-service circuit breaker is covered by the normal `pnpm test` run
 * with no server, container or network anywhere in CI. It implements only the
 * six commands `RedisLike` declares, with real key-expiry semantics, because
 * expiry IS the behaviour under test — a fake that ignored TTLs would let a
 * broken window implementation pass.
 *
 * Time is a settable offset rather than `vi.useFakeTimers()`: the code under
 * test also reads `Date.now()` for its own bookkeeping, and advancing only
 * the store's clock keeps each assertion about exactly one thing.
 */
import type { RedisLike } from '@/lib/redis/client';

interface Entry {
  value: string | number;
  /** Absolute fake-clock ms, or `null` for a key with no expiry. */
  expiresAt: number | null;
}

export class FakeRedis implements RedisLike {
  private readonly store = new Map<string, Entry>();
  private offset = 0;

  /** Every command this fake has served, in order — lets a test assert Redis was (or was not) consulted. */
  readonly calls: string[] = [];

  private now(): number {
    return Date.now() + this.offset;
  }

  /** Move the fake's clock forward, expiring anything whose TTL has elapsed. */
  advance(ms: number): void {
    this.offset += ms;
  }

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<unknown> {
    this.calls.push(`get ${key}`);
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string | number, opts: { nx: true; px: number }): Promise<unknown> {
    this.calls.push(`set ${key}`);
    if (this.live(key)) return null; // NX: key exists, no write
    this.store.set(key, { value, expiresAt: this.now() + opts.px });
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    this.calls.push(`incr ${key}`);
    const entry = this.live(key);
    if (!entry) {
      // Real Redis creates the key with no TTL here; reproducing that is what
      // exercises the ttl-repair branch in src/lib/redis/window.ts.
      this.store.set(key, { value: 1, expiresAt: null });
      return 1;
    }
    const next = Number(entry.value) + 1;
    entry.value = next;
    return next;
  }

  async pexpire(key: string, ms: number): Promise<unknown> {
    this.calls.push(`pexpire ${key}`);
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = this.now() + ms;
    return 1;
  }

  async pttl(key: string): Promise<number> {
    this.calls.push(`pttl ${key}`);
    const entry = this.live(key);
    if (!entry) return -2; // no such key
    if (entry.expiresAt === null) return -1; // key exists, no TTL
    return entry.expiresAt - this.now();
  }

  async del(...keys: string[]): Promise<unknown> {
    this.calls.push(`del ${keys.join(',')}`);
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
    }
    return removed;
  }
}

/**
 * A client whose every command rejects — the "Redis is configured but
 * unreachable" case the FAILURE POLICY in src/lib/redis/client.ts is about.
 * Counts its calls so a test can prove `tryRedis`'s local breaker stops
 * hammering a dead server.
 */
export class UnreachableRedis implements RedisLike {
  attempts = 0;

  private fail(): never {
    this.attempts += 1;
    throw new Error('ECONNREFUSED (fake)');
  }

  async get(): Promise<unknown> {
    return this.fail();
  }
  async set(): Promise<unknown> {
    return this.fail();
  }
  async incr(): Promise<number> {
    return this.fail();
  }
  async pexpire(): Promise<unknown> {
    return this.fail();
  }
  async pttl(): Promise<number> {
    return this.fail();
  }
  async del(): Promise<unknown> {
    return this.fail();
  }
}
