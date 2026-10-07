import type { NextRequest } from 'next/server';
import {
  createWindowLimiter,
  requestAddress,
  requestIdentity,
  ROUTE_PROFILE_FETCH_LIMITS,
  takeAll,
  type IdentityClaims,
  type WindowLimiter,
} from '../rateLimit';
import type { UpstreamPermit } from './routeCatalogue';

/*
 * The limits on calls to the corporation's schedule server, shared by every route that a
 * person uses to look something up there (route details, a bus's whole day): one
 * allowance per person, per address and per process, whichever route spends it.
 */

interface FetchLimiters {
  readonly identity: WindowLimiter;
  readonly process: WindowLimiter;
  /** Keyed on the trusted address alone, so a new login from it gains nothing. */
  readonly address: WindowLimiter;
}

const LIMITERS_KEY = Symbol.for('olympuss.depot.routeProfileFetchLimiters');
type LimiterHolder = typeof globalThis & { [LIMITERS_KEY]?: FetchLimiters };

/** One set per process, on `globalThis` so a hot reload does not reset the limits. */
function fetchLimiters(): FetchLimiters {
  const holder = globalThis as LimiterHolder;
  const { perIdentityPerMinute, perAddressPerMinute, perProcessPerMinute, windowMs } =
    ROUTE_PROFILE_FETCH_LIMITS;
  const { maxIdentities } = ROUTE_PROFILE_FETCH_LIMITS;
  const made = (limit: number, maxKeys: number): WindowLimiter =>
    createWindowLimiter({ now: Date.now, limit, windowMs, maxKeys });
  holder[LIMITERS_KEY] ??= {
    identity: made(perIdentityPerMinute, maxIdentities),
    process: made(perProcessPerMinute, 1),
    address: made(perAddressPerMinute, maxIdentities),
  };
  return holder[LIMITERS_KEY];
}

/**
 * One slot from every limit, taken immediately before each call to the schedule
 * server and as the condition of making it. `takeAll` decides and takes in one
 * synchronous step, so lookups in flight together cannot pass a limit between them.
 */
export function upstreamPermit(
  request: NextRequest,
  claims: Readonly<IdentityClaims>,
): UpstreamPermit {
  const limiters = fetchLimiters();
  const address = requestAddress(request.headers, process.env);
  const identity = requestIdentity(claims, request.headers, process.env);
  const checks = [
    { limiter: limiters.identity, key: identity },
    ...(address === null ? [] : [{ limiter: limiters.address, key: address }]),
    { limiter: limiters.process, key: 'all' },
  ];
  return () => takeAll(checks);
}

/** The fixed 429: a call the lookup needed would have passed a limit. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    { error: 'Too many requests', retryAfterSeconds },
    {
      status: 429,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfterSeconds) },
    },
  );
}

export const PAST_DEADLINE = Symbol('past deadline');

/** The work's own outcome, or `PAST_DEADLINE` once `ms` have gone by; no timer is left behind. */
export async function withinDeadline<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof PAST_DEADLINE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof PAST_DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(PAST_DEADLINE), ms);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}
