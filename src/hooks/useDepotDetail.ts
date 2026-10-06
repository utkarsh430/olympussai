'use client';

import type { DepotDetailResponse } from '@/lib/depot/api';
import { isValidDepotId } from '@/lib/depot/ids';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

/** Defined with the scope state, which reads it; exported here too for the depot hooks. */
export { DEPOT_NOT_FOUND_MESSAGE };
export const INVALID_DEPOT_ID_MESSAGE = 'Invalid depot id';

const NOT_FOUND = 404;
const BAD_REQUEST = 400;

// Module constant so the shared hook sees a stable object between renders.
const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  [NOT_FOUND]: DEPOT_NOT_FOUND_MESSAGE,
  [BAD_REQUEST]: INVALID_DEPOT_ID_MESSAGE,
};

export type DepotDetailState = PolledState<DepotDetailResponse>;

/**
 * Polls one depot's detail. A null or malformed id makes no request, so a hostile
 * value from a URL segment never reaches the network.
 */
export function useDepotDetail(depotId: string | null): DepotDetailState {
  const url = isValidDepotId(depotId)
    ? `/api/upsrtc/depot/${encodeURIComponent(depotId)}`
    : null;
  return usePolledJson<DepotDetailResponse>(url, { statusMessages: STATUS_MESSAGES });
}
