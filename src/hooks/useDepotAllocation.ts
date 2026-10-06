'use client';

import type { DepotAllocationResponse } from '@/lib/depot/routes/api';
import {
  DEFAULT_ALLOCATION_QUERY,
  allocationSearch,
  type AllocationQuery,
} from '@/lib/depot/routes/routeQuery';
import { useFetchedJson, type FetchedState } from '@/hooks/useFetchedJson';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

const ALLOCATION_ENDPOINT = '/api/upsrtc/depot/allocation';

export type DepotAllocationState = PolledState<DepotAllocationResponse>;

/** The summary query: totals, every move and the counts by reason, no list rows. */
export const ALLOCATION_SUMMARY_QUERY: AllocationQuery = { ...DEFAULT_ALLOCATION_QUERY, limit: 0 };

export function depotAllocationUrl(query: AllocationQuery = ALLOCATION_SUMMARY_QUERY): string {
  return `${ALLOCATION_ENDPOINT}${allocationSearch(query)}`;
}

/** Polls the allocation summary; see `usePolledJson` for the failure and abort rules. */
export function useDepotAllocation(
  query: AllocationQuery = ALLOCATION_SUMMARY_QUERY,
): DepotAllocationState {
  return usePolledJson<DepotAllocationResponse>(depotAllocationUrl(query));
}

// A page change keeps the rows on screen (marked busy) until the new page arrives.
const KEEP_PREVIOUS = { keepPreviousOnQueryChange: true } as const;

/** One page of one reason's routes; a null query fetches nothing (the group is closed). */
export function useAllocationList(
  query: AllocationQuery | null,
): FetchedState<DepotAllocationResponse> {
  return useFetchedJson<DepotAllocationResponse>(
    query === null ? null : depotAllocationUrl(query),
    KEEP_PREVIOUS,
  );
}
