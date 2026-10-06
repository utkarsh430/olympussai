'use client';

import type { DepotDistributionResponse } from '@/lib/depot/api';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

const DISTRIBUTION_ENDPOINT = '/api/upsrtc/depot/distribution';

export type DepotDistributionState = PolledState<DepotDistributionResponse>;

/** Polls the fleet distribution API; see `usePolledJson` for the failure and abort rules. */
export function useDepotDistribution(): DepotDistributionState {
  return usePolledJson<DepotDistributionResponse>(DISTRIBUTION_ENDPOINT);
}
