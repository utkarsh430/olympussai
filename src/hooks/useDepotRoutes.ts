'use client';

import type { DepotRoutesResponse } from '@/lib/depot/routes/api';
import { DEFAULT_ROUTES_QUERY, routesSearch, type RoutesQuery } from '@/lib/depot/routes/routeQuery';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

const ROUTES_ENDPOINT = '/api/upsrtc/depot/routes';

// A search, sort, page or filter keeps the rows on screen (marked busy) until the new page arrives.
const KEEP_PREVIOUS = { keepPreviousOnQueryChange: true } as const;

export type DepotRoutesState = PolledState<DepotRoutesResponse>;

/** Builds the routes URL: filters, sort and the page go to the server as query parameters. */
export function depotRoutesUrl(query: RoutesQuery = DEFAULT_ROUTES_QUERY): string {
  return `${ROUTES_ENDPOINT}${routesSearch(query)}`;
}

/**
 * Polls one page of the route table. Each poll picks up profiles cached since
 * the last one; see `usePolledJson` for the failure and abort rules.
 */
export function useDepotRoutes(query: RoutesQuery = DEFAULT_ROUTES_QUERY): DepotRoutesState {
  return usePolledJson<DepotRoutesResponse>(depotRoutesUrl(query), KEEP_PREVIOUS);
}
