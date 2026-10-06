import { createHash } from 'node:crypto';
import type { SessionClaims } from '@/lib/auth/session';

export interface RateDecision {
  readonly limited: boolean;
  /** Seconds until a slot frees; 0 when not limited. */
  readonly retryAfterSeconds: number;
}

export interface WindowLimiter {
  /**
   * Whether `key` has `cost` free slots (default one), without taking them. A request
   * that does several units of the limited work costs that many slots.
   */
  check(key: string, cost?: number): RateDecision;
  /** Takes `cost` slots (default one) for `key` when all are free; a refusal takes nothing. */
  take(key: string, cost?: number): RateDecision;
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

  /**
   * Allowed when the cost fits beside the hits still in the window. Refused: the wait
   * until enough of the oldest hits have left the window for the cost to fit. A cost
   * above the limit never fits; it is refused with the whole window as the wait.
   */
  function decide(recent: readonly number[], now: number, cost: number): RateDecision {
    if (recent.length + cost <= options.limit) return ALLOWED;
    const freedAt = recent.length + cost - options.limit - 1;
    const freedBy = cost > options.limit ? undefined : recent[freedAt];
    const waitMs = freedBy === undefined ? options.windowMs : freedBy + options.windowMs - now;
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
    check(key: string, cost: number = 1): RateDecision {
      const now = options.now();
      return decide(recentFor(key, now), now, cost);
    },
    take(key: string, cost: number = 1): RateDecision {
      const now = options.now();
      const recent = recentFor(key, now);
      const decision = decide(recent, now, cost);
      const taken = Array.from({ length: cost }, () => now);
      store(key, decision.limited ? recent : [...recent, ...taken]);
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
  /** Slots this request takes from the limit; one when absent. */
  readonly cost?: number;
}

/**
 * Checks every limit before taking from any, so a request one limit refuses
 * spends no slot in another. Refused: the longest wait among the refusals.
 */
export function takeAll(checks: readonly LimitCheck[]): RateDecision {
  const refusals = checks.map((c) => c.limiter.check(c.key, c.cost)).filter((d) => d.limited);
  if (refusals.length > 0) {
    const retryAfterSeconds = Math.max(...refusals.map((d) => d.retryAfterSeconds));
    return { limited: true, retryAfterSeconds };
  }
  checks.forEach((c) => c.limiter.take(c.key, c.cost));
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
  return ADDRESS.test(last) ? addressKey(last.toLowerCase()) : '';
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;
const IPV6_GROUPS = 8;
/** Groups a holder of one IPv6 /64 controls are dropped: the key is the first four. */
const IPV6_PREFIX_GROUPS = 4;

/** The eight 16-bit groups of an IPv6 address (an IPv4 tail allowed), or null. */
function ipv6Groups(text: string): readonly number[] | null {
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parts = (half: string | undefined): string[] => (half ? half.split(':') : []);
  const tail = parts(halves[halves.length - 1]);
  const last = tail[tail.length - 1] ?? '';
  const v4 = IPV4.test(last) ? last.split('.').map(Number) : null;
  const toHex = (p: string): number | null => (HEX_GROUP.test(p) ? parseInt(p, 16) : null);
  const head = (halves.length === 2 ? parts(halves[0]) : []).map(toHex);
  const rest = (v4 ? tail.slice(0, -1) : tail).map(toHex);
  const v4Groups = v4 ? [(v4[0] ?? 0) * 256 + (v4[1] ?? 0), (v4[2] ?? 0) * 256 + (v4[3] ?? 0)] : [];
  const known = [...head, ...rest, ...v4Groups];
  if (known.some((g) => g === null)) return null;
  const missing = IPV6_GROUPS - known.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const zeros: number[] = Array.from({ length: halves.length === 2 ? missing : 0 }, () => 0);
  return [...head, ...zeros, ...rest, ...v4Groups] as number[];
}

/**
 * Ruling S49 M2a. An IPv6 client is keyed on its /64, which one holder
 * controls whole; an IPv4-mapped address on its IPv4 form; IPv4 as it is. A
 * value that passes the character check but does not parse is kept as written,
 * exactly as before.
 */
function addressKey(address: string): string {
  if (!address.includes(':')) return address;
  const groups = ipv6Groups(address);
  if (groups === null) return address;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const [high = 0, low = 0] = groups.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return `${groups.slice(0, IPV6_PREFIX_GROUPS).map((g) => g.toString(16)).join(':')}::/64`;
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
 *
 * The limits count calls to that server, not lookups. One lookup can make up
 * to four calls (the requested date, then three fallback dates), and the route
 * charges every miss all four, so these are the real ceilings on calls: 20, 40
 * and 120 a minute, which is 5, 10 and 30 lookups a minute.
 */
export const ROUTE_PROFILE_FETCH_LIMITS = {
  perIdentityPerMinute: 20,
  /** Per address alone, when a trusted address header is configured. */
  perAddressPerMinute: 40,
  perProcessPerMinute: 120,
  windowMs: 60_000,
  maxIdentities: 5_000,
} as const;
