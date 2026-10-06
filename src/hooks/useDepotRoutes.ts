'use client';

import type { DepotRoutesResponse } from '@/lib/depot/routes/api';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

const ROUTES_ENDPOINT = '/api/upsrtc/depot/routes';

export type DepotRoutesState = PolledState<DepotRoutesResponse>;

/** Builds the routes URL; a null depot asks for the whole network. */
export function depotRoutesUrl(depotId: string | null): string {
  return depotId === null
    ? ROUTES_ENDPOINT
    : `${ROUTES_ENDPOINT}?depotId=${encodeURIComponent(depotId)}`;
}

/**
 * Polls the route table API. Each poll picks up profiles cached since the
 * last one (opening a route caches its profile); see `usePolledJson` for the
 * failure and abort rules.
 */
export function useDepotRoutes(depotId: string | null = null): DepotRoutesState {
  return usePolledJson<DepotRoutesResponse>(depotRoutesUrl(depotId));
}
