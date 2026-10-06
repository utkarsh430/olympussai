'use client';

import type { FuelResponse } from '@/lib/depot/fuel/api';
import { isValidDepotId } from '@/lib/depot/ids';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';
import { INVALID_DEPOT_ID_MESSAGE } from '@/hooks/useDepotDetail';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';

const NOT_FOUND = 404;
const BAD_REQUEST = 400;

// Module constant so the shared hook sees a stable object between renders.
const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  [NOT_FOUND]: DEPOT_NOT_FOUND_MESSAGE,
  [BAD_REQUEST]: INVALID_DEPOT_ID_MESSAGE,
};

export type DepotFuelState = PolledState<FuelResponse>;

/**
 * Polls one depot's fuel view. A null or malformed id makes no request,
 * so a hostile value from a URL segment never reaches the network.
 */
export function useDepotFuel(depotId: string | null): DepotFuelState {
  const url = isValidDepotId(depotId)
    ? `/api/upsrtc/depot/${encodeURIComponent(depotId)}/fuel`
    : null;
  return usePolledJson<FuelResponse>(url, { statusMessages: STATUS_MESSAGES });
}
