'use client';

import { DEPOT_FORECAST_ENDPOINT, type DepotForecastResponse } from '@/lib/depot/forecast/api';
import type { HistoryScope, MetricKey } from '@/lib/depot/sim/types';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

export type DepotForecastState = PolledState<DepotForecastResponse>;

export interface DepotForecastRequest {
  readonly metric: MetricKey;
  readonly scope: HistoryScope;
  /** History window in days; the server defaults it when omitted. */
  readonly days?: number;
  /** Forecast horizon in whole days, 7 to 28; the server defaults it when omitted. */
  readonly horizon?: number;
}

const DEPOT_NOT_FOUND = { 404: 'Depot not found' } as const;

/** Builds the forecast URL; a null request asks for nothing. */
export function depotForecastUrl(request: DepotForecastRequest | null): string | null {
  if (request === null) return null;
  const params = new URLSearchParams({ metric: request.metric, scope: request.scope.kind });
  if (request.scope.kind === 'depot') params.set('depotId', request.scope.depotId);
  if (request.days !== undefined) params.set('days', String(request.days));
  if (request.horizon !== undefined) params.set('horizon', String(request.horizon));
  return `${DEPOT_FORECAST_ENDPOINT}?${params.toString()}`;
}

/**
 * Polls one metric's history, trend and forecast. Polled rather than fetched
 * once because the series ends on the live value, which must keep agreeing
 * with the live figures beside it; see `usePolledJson` for failure rules.
 */
export function useDepotForecast(request: DepotForecastRequest | null): DepotForecastState {
  return usePolledJson<DepotForecastResponse>(depotForecastUrl(request), {
    statusMessages: DEPOT_NOT_FOUND,
  });
}
