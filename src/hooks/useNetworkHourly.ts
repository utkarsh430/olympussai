'use client';

import { isValidDepotId } from '@/lib/depot/ids';
import { isServiceBandKey } from '@/lib/depot/service/networkHours';
import type { NetworkHourlyResponse, ServiceBandKey } from '@/lib/depot/service/types';
import { usePolledJson, type PolledState } from '@/hooks/usePolledJson';

const NOT_FOUND = 404;
const BAD_REQUEST = 400;

/** The network's hours API. */
export const NETWORK_HOURLY_ENDPOINT = '/api/upsrtc/depot/service';

export const NETWORK_DEPOT_NOT_FOUND_MESSAGE = 'The feed carries no depot with this id now.';
export const NETWORK_INVALID_MESSAGE = 'This is not a band, depot or page the page can ask for.';

// Module constant so the shared hook sees a stable object between renders.
const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  [NOT_FOUND]: NETWORK_DEPOT_NOT_FOUND_MESSAGE,
  [BAD_REQUEST]: NETWORK_INVALID_MESSAGE,
};

export interface NetworkHourlyAsk {
  /** Null asks for the peak now or next. */
  readonly band: ServiceBandKey | null;
  readonly depotId: string | null;
  readonly page: number;
}

/** The URL for a band, depot and page; a hostile value from the address bar is left out, never sent. */
export function networkHourlyUrl(ask: NetworkHourlyAsk): string {
  const params = new URLSearchParams();
  if (ask.band !== null && isServiceBandKey(ask.band)) params.set('band', ask.band);
  if (ask.depotId !== null && isValidDepotId(ask.depotId)) params.set('depot', ask.depotId);
  if (Number.isInteger(ask.page) && ask.page > 0) params.set('page', String(ask.page));
  const query = params.toString();
  return query ? `${NETWORK_HOURLY_ENDPOINT}?${query}` : NETWORK_HOURLY_ENDPOINT;
}

export type NetworkHourlyState = PolledState<NetworkHourlyResponse>;

/** Polls the network's hours every minute, keeping the last answer while a new filter loads. */
export function useNetworkHourly(ask: NetworkHourlyAsk): NetworkHourlyState {
  return usePolledJson<NetworkHourlyResponse>(networkHourlyUrl(ask), {
    statusMessages: STATUS_MESSAGES,
    keepPreviousOnQueryChange: true,
  });
}
