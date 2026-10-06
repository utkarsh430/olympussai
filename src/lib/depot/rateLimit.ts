import { createHash } from 'node:crypto';
import type { SessionClaims } from '@/lib/auth/session';

export interface RateDecision {
  readonly limited: boolean;
  /** Seconds until a slot frees; 0 when not limited. */
  readonly retryAfterSeconds: number;
}

export interface WindowLimiter {
  /** Whether `key` has a free slot, without taking it. */
  check(key: string): RateDecision;
  /** Takes a slot for `key` when one is free; a refused request takes nothing. */
  take(key: string): RateDecision;
  /** Gives back the most recent hit for a key: the work it paid for never happened. */
  refund(key: string): void;
  /** Keys currently tracked (for the memory bound's test). */
  size(): number;
}

const MS_PER_SECOND = 1_000;
const ALLOWED: RateDecision = { limited: false, retryAfterSeconds: 0 };

/**
 * Sliding-window request limiter, in memory, per process. Like the login
 * limiter it is best effort on multi-instance hosting; it exists so that one
 * process cannot be made to do unbounded work. Memory is bounded: past
 * `maxKeys` the least recently used key is forgotten (a key is moved to the
 * end of the map on every use by deleting and setting it again).
 */
export function createWindowLimiter(options: {
  readonly now: () => number;
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys: number;
}): WindowLimiter {
  const hits = new Map<string, readonly number[]>();

  const recentFor = (key: string, now: number): readonly number[] =>
    (hits.get(key) ?? []).filter((t) => now - t < options.windowMs);

  function decide(recent: readonly number[], now: number): RateDecision {
    const first = recent[0];
    if (recent.length < options.limit || first === undefined) return ALLOWED;
    const waitMs = first + options.windowMs - now;
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / MS_PER_SECOND)) };
  }

  function store(key: string, recent: readonly number[]): void {
    hits.delete(key);
    if (hits.size >= options.maxKeys) {
      const oldest = hits.keys().next();
      if (!oldest.done) hits.delete(oldest.value);
    }
    hits.set(key, recent);
  }

  return {
    check(key: string): RateDecision {
      const now = options.now();
      return decide(recentFor(key, now), now);
    },
    take(key: string): RateDecision {
      const now = options.now();
      const recent = recentFor(key, now);
      const decision = decide(recent, now);
      store(key, decision.limited ? recent : [...recent, now]);
      return decision;
    },
    refund(key: string): void {
      const recent = hits.get(key);
      if (recent !== undefined && recent.length > 0) hits.set(key, recent.slice(0, -1));
    },
    size: () => hits.size,
  };
}

export interface LimitCheck {
  readonly limiter: WindowLimiter;
  readonly key: string;
}

/**
 * Checks every limit before taking from any, so a request one limit refuses
 * spends no slot in another. Refused: the longest wait among the refusals.
 */
export function takeAll(checks: readonly LimitCheck[]): RateDecision {
  const refusals = checks.map((c) => c.limiter.check(c.key)).filter((d) => d.limited);
  if (refusals.length > 0) {
    const retryAfterSeconds = Math.max(...refusals.map((d) => d.retryAfterSeconds));
    return { limited: true, retryAfterSeconds };
  }
  checks.forEach((c) => c.limiter.take(c.key));
  return ALLOWED;
}

export type IdentityClaims = Pick<SessionClaims, 'project' | 'role' | 'iat' | 'exp' | 'sid'>;

/** Header names are tokens; an address is IPv4 or IPv6 characters only. */
const HEADER_NAME = /^[a-z0-9-]{1,64}$/i;
const ADDRESS = /^[0-9a-f:.]{2,45}$/i;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * The client address, only from the header the server names in
 * `DEPOT_TRUSTED_IP_HEADER` (unset: none). Of a list, the last entry is the
 * one the trusted proxy added; earlier ones the client may have written.
 */
function trustedAddress(
  headers: Headers,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const name = env.DEPOT_TRUSTED_IP_HEADER?.trim() ?? '';
  if (!HEADER_NAME.test(name)) return '';
  const last = (headers.get(name) ?? '').split(',').pop()?.trim() ?? '';
  return ADDRESS.test(last) ? last.toLowerCase() : '';
}

/**
 * The canonical identity limits key on, as an opaque hash. It is the session
 * id when the token has one, otherwise the verified token's decoded claims:
 * never the cookie string, which has many encodings that all verify. The
 * trusted client address is combined with it when the server names one.
 */
/**
 * The caller's address, or null. It is read ONLY from the header named by
 * `DEPOT_TRUSTED_IP_HEADER`, which must be set only behind a proxy that
 * overwrites that header on every request: a directly reachable app would let
 * the client write its own address. Limiters key on this value alone, so a new
 * login from the same address gains nothing (ruling S37).
 */
export function requestAddress(
  headers: Headers,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  return trustedAddress(headers, env) || null;
}

export function requestIdentity(
  claims: Readonly<IdentityClaims>,
  headers: Headers,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const session =
    claims.sid !== undefined
      ? `sid:${claims.sid}`
      : `claims:${JSON.stringify([claims.project, claims.role, claims.iat, claims.exp])}`;
  return sha256(`${session}\n${trustedAddress(headers, env)}`);
}

/**
 * `GET /api/upsrtc/depot/route/[routeName]`: a cache miss calls the
 * government's schedule server, so misses (never hits) are limited per
 * identity and for the whole process, which protects that server.
 */
export const ROUTE_PROFILE_FETCH_LIMITS = {
  perIdentityPerMinute: 20,
  /** Per address alone, when a trusted address header is configured. */
  perAddressPerMinute: 40,
  perProcessPerMinute: 120,
  windowMs: 60_000,
  maxIdentities: 5_000,
} as const;
