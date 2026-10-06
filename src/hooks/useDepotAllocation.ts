'use client';

import type { DepotAllocationResponse } from '@/lib/depot/routes/api';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

const ALLOCATION_ENDPOINT = '/api/upsrtc/depot/allocation';

export type DepotAllocationState = PolledState<DepotAllocationResponse>;

/** Builds the allocation URL; a null depot lists every route (totals are network-wide either way). */
export function depotAllocationUrl(depotId: string | null): string {
  return depotId === null
    ? ALLOCATION_ENDPOINT
    : `${ALLOCATION_ENDPOINT}?depotId=${encodeURIComponent(depotId)}`;
}

/**
 * Polls the route allocation API. The plan covers only routes already
 * profiled, so it grows as routes are opened; `refresh` re-plans at once after
 * a route is profiled. See `usePolledJson` for the failure and abort rules.
 */
export function useDepotAllocation(depotId: string | null = null): DepotAllocationState {
  return usePolledJson<DepotAllocationResponse>(depotAllocationUrl(depotId));
}
