'use client';

import { DEPOT_TRENDS_ENDPOINT, type DepotTrendsResponse } from '@/lib/depot/forecast/api';
import type { MetricKey } from '@/lib/depot/sim/types';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

export type DepotTrendsState = PolledState<DepotTrendsResponse>;

export interface DepotTrendsRequest {
  readonly metric: MetricKey;
  /** Sparkline length in days, 7 to 90; the server defaults it to 30 when omitted. */
  readonly days?: number;
}

/** Builds the trends URL; a null request asks for nothing. */
export function depotTrendsUrl(request: DepotTrendsRequest | null): string | null {
  if (request === null) return null;
  const params = new URLSearchParams({ metric: request.metric });
  if (request.days !== undefined) params.set('days', String(request.days));
  return `${DEPOT_TRENDS_ENDPOINT}?${params.toString()}`;
}

/** Polls every sparkline of one metric in one request; see `usePolledJson` for failure rules. */
export function useDepotTrends(request: DepotTrendsRequest | null): DepotTrendsState {
  return usePolledJson<DepotTrendsResponse>(depotTrendsUrl(request));
}
