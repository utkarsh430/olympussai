/**
 * The browser's one way to the per-route endpoint, shared by the route drawer's lookup and
 * the "load route details" run, so both ask the same URL in the same way and read the
 * throttle's wait the same way.
 */

const ROUTE_PROFILE_ENDPOINT = '/api/upsrtc/depot/route/';

/** A `Retry-After` value this client trusts: a whole number of seconds, at most five digits. */
const WHOLE_SECONDS = /^\d{1,5}$/;

/** One uncached lookup of a route's profile; the caller reads the status and body. */
export function fetchRouteProfile(routeName: string, signal: AbortSignal): Promise<Response> {
  return fetch(`${ROUTE_PROFILE_ENDPOINT}${encodeURIComponent(routeName)}`, {
    signal,
    cache: 'no-store',
  });
}

/** The throttle's `Retry-After` as whole seconds; null when it is missing or not a plain number. */
export function retryAfterWholeSeconds(header: string | null): number | null {
  return header !== null && WHOLE_SECONDS.test(header.trim()) ? Number(header) : null;
}
