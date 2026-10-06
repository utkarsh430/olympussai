'use client';

import type { DepotExceptionsResponse } from '@/lib/depot/api';
import {
  DEPOT_POLL_INTERVAL_MS,
  DEPOT_UNAVAILABLE_MESSAGE,
  NETWORK_UNREACHABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from '@/hooks/useDepotNetwork';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

// One set of poll timing and failure wording for every depot hook.
export {
  DEPOT_POLL_INTERVAL_MS,
  DEPOT_UNAVAILABLE_MESSAGE,
  NETWORK_UNREACHABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
};

const EXCEPTIONS_ENDPOINT = '/api/upsrtc/depot/exceptions';

export type DepotExceptionsState = PolledState<DepotExceptionsResponse>;

/** Polls the depot exceptions API; see `usePolledJson` for the failure and abort rules. */
export function useDepotExceptions(): DepotExceptionsState {
  return usePolledJson<DepotExceptionsResponse>(EXCEPTIONS_ENDPOINT);
}
