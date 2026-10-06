'use client';

import type { DepotNetworkResponse } from '@/lib/depot/api';
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEPOT_UNAVAILABLE_MESSAGE,
  NETWORK_UNREACHABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  usePolledJson,
  type PolledState,
} from '@/hooks/usePolledJson';

// Timing and failure wording live in the shared hook; re-exported so existing imports hold.
export const DEPOT_POLL_INTERVAL_MS = DEFAULT_POLL_INTERVAL_MS;
export { DEPOT_UNAVAILABLE_MESSAGE, NETWORK_UNREACHABLE_MESSAGE, SESSION_EXPIRED_MESSAGE };

const NETWORK_ENDPOINT = '/api/upsrtc/depot/network';

export type DepotNetworkState = PolledState<DepotNetworkResponse>;

/** Polls the depot network API; see `usePolledJson` for the failure and abort rules. */
export function useDepotNetwork(): DepotNetworkState {
  return usePolledJson<DepotNetworkResponse>(NETWORK_ENDPOINT);
}
