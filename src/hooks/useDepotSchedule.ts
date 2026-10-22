'use client';

import { isValidDepotId } from '@/lib/depot/ids';
import type { ScheduleResponse } from '@/lib/depot/schedule/api';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';
import { INVALID_DEPOT_ID_MESSAGE } from '@/hooks/useDepotDetail';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';

const NOT_FOUND = 404;
const BAD_REQUEST = 400;

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  [NOT_FOUND]: DEPOT_NOT_FOUND_MESSAGE,
  [BAD_REQUEST]: INVALID_DEPOT_ID_MESSAGE,
};

export type DepotScheduleState = PolledState<ScheduleResponse>;

/** Polls one depot's baseline schedule. A malformed id makes no request. */
export function useDepotSchedule(depotId: string | null): DepotScheduleState {
  const url = isValidDepotId(depotId) ? `/api/upsrtc/depot/${encodeURIComponent(depotId)}/schedule` : null;
  return usePolledJson<ScheduleResponse>(url, { statusMessages: STATUS_MESSAGES });
}
