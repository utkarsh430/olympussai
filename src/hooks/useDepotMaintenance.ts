'use client';

import type { MaintenanceResponse } from '@/lib/depot/maintenance/api';
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

export type DepotMaintenanceState = PolledState<MaintenanceResponse>;

/**
 * Polls one depot's maintenance view. A null or malformed id makes no request,
 * so a hostile value from a URL segment never reaches the network.
 */
export function useDepotMaintenance(depotId: string | null): DepotMaintenanceState {
  const url = isValidDepotId(depotId)
    ? `/api/upsrtc/depot/${encodeURIComponent(depotId)}/maintenance`
    : null;
  return usePolledJson<MaintenanceResponse>(url, { statusMessages: STATUS_MESSAGES });
}
