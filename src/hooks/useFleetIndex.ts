'use client';

import { useMemo } from 'react';
import { fleetBusOf, type FleetBus, type FleetIndexResponse } from '@/lib/depot/os/fleetIndex';
import { usePolledJson } from '@/hooks/usePolledJson';

const FLEET_ENDPOINT = '/api/upsrtc/depot/fleet';
/** The index moves with the snapshot, but its engines need no faster than a minute. */
const FLEET_POLL_MS = 60_000;

export interface FleetIndexState {
  readonly buses: readonly FleetBus[] | null;
  readonly feedNow: string | null;
  readonly error: string | null;
  readonly loading: boolean;
}

/** Every bus on the snapshot; null until the first answer. Pass false to skip the request. */
export function useFleetIndex(enabled = true): FleetIndexState {
  const { data, error, loading } = usePolledJson<FleetIndexResponse>(enabled ? FLEET_ENDPOINT : null, {
    intervalMs: FLEET_POLL_MS,
  });
  const buses = useMemo(() => (data ? data.buses.map(fleetBusOf) : null), [data]);
  return { buses, feedNow: data?.feedNow ?? null, error, loading };
}
