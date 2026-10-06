'use client';

import { isValidRouteName } from '@/lib/depot/ids';
import type { RouteHourlyResponse } from '@/lib/depot/service/types';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

const NOT_FOUND = 404;
const BAD_REQUEST = 400;

/** The route day's API, one route per path. */
export const ROUTE_HOURLY_ENDPOINT = '/api/upsrtc/depot/service/route';

export const ROUTE_NOT_FOUND_MESSAGE = 'No bus in the feed carries this route name now.';
export const INVALID_ROUTE_MESSAGE = 'This is not a route name the feed uses.';

// Module constant so the shared hook sees a stable object between renders.
const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  [NOT_FOUND]: ROUTE_NOT_FOUND_MESSAGE,
  [BAD_REQUEST]: INVALID_ROUTE_MESSAGE,
};

export type RouteHourlyState = PolledState<RouteHourlyResponse>;

/** The route day's URL; null for a null or malformed name, so nothing is asked. */
export function routeHourlyUrl(routeName: string | null): string | null {
  return isValidRouteName(routeName)
    ? `${ROUTE_HOURLY_ENDPOINT}/${encodeURIComponent(routeName)}`
    : null;
}

/**
 * Polls one route's day hour by hour every minute; see `usePolledJson` for the failure
 * rules. A hostile value from a URL segment never reaches the network.
 */
export function useRouteHourly(routeName: string | null): RouteHourlyState {
  return usePolledJson<RouteHourlyResponse>(routeHourlyUrl(routeName), {
    statusMessages: STATUS_MESSAGES,
  });
}
