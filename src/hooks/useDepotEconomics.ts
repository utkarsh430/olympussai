'use client';

import type { EconomicsResponse } from '@/lib/depot/revenue/api';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

const ECONOMICS_ENDPOINT = '/api/upsrtc/depot/economics';

export type DepotEconomicsState = PolledState<EconomicsResponse>;

/** Polls the network's modelled economics ranking; see `usePolledJson` for failure rules. */
export function useDepotEconomics(): DepotEconomicsState {
  return usePolledJson<EconomicsResponse>(ECONOMICS_ENDPOINT);
}
