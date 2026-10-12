import type { DepotBusRow } from '@/models/depotLive';
import { distanceM, hasUsablePosition } from '../infer/geo';
import type { LocatedBus } from '../infer/types';
import type { BusOpState } from '../types';
import { STOPPED_SINCE_MAX_BUSES, STOP_JITTER_M } from './config';

/*
 * Since when each standing bus away from a yard has stood still. The feed
 * has no stop-duration signal, so the holder remembers, one operating date
 * at a time, the first feed time a bus was seen still at a place; a move
 * beyond jitter starts it again and a bus that drives off is forgotten.
 */

export interface StoppedSince {
  readonly since: string;
  readonly lat: number;
  readonly lng: number;
}

export interface StoppedSinceStore {
  operatingDate: string | null;
  readonly byBus: Map<string, StoppedSince>;
}

const GLOBAL_KEY = '__depotStoppedSinceStore';
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: StoppedSinceStore };

export function createStoppedSinceStore(): StoppedSinceStore {
  return { operatingDate: null, byBus: new Map() };
}

/** The one process-wide holder; on `globalThis` so a dev reload does not fork it. */
export function defaultStoppedSinceStore(): StoppedSinceStore {
  const holder = globalThis as GlobalWithStore;
  holder[GLOBAL_KEY] ??= createStoppedSinceStore();
  return holder[GLOBAL_KEY];
}

export function resetStoppedSinceStore(store: StoppedSinceStore = defaultStoppedSinceStore()): void {
  store.operatingDate = null;
  store.byBus.clear();
}

export interface StoppedSnapshot {
  readonly feedNow: string | null;
  readonly operatingDate: string | null;
  readonly fixture: boolean;
  readonly rows: readonly DepotBusRow[];
  readonly stateOf: (row: DepotBusRow) => BusOpState;
  readonly locate: (row: DepotBusRow) => LocatedBus;
}

/** Offers one snapshot: keeps, starts or forgets each bus's still time. The saved sample never writes. */
export function offerStoppedSnapshot(store: StoppedSinceStore, snapshot: StoppedSnapshot): void {
  const { feedNow, operatingDate } = snapshot;
  if (snapshot.fixture || feedNow === null || operatingDate === null) return;
  if (store.operatingDate !== operatingDate) {
    store.operatingDate = operatingDate;
    store.byBus.clear();
  }
  const seen = new Set<string>();
  for (const row of snapshot.rows) {
    if (!hasUsablePosition(row)) continue;
    if (snapshot.stateOf(row) !== 'standing' || snapshot.locate(row).location !== 'away') continue;
    const key = row.registrationNumber;
    seen.add(key);
    const held = store.byBus.get(key);
    if (held && distanceM(held.lat, held.lng, row.latitude, row.longitude) <= STOP_JITTER_M) continue;
    if (!held && store.byBus.size >= STOPPED_SINCE_MAX_BUSES) continue;
    store.byBus.set(key, { since: feedNow, lat: row.latitude, lng: row.longitude });
  }
  for (const key of [...store.byBus.keys()]) if (!seen.has(key)) store.byBus.delete(key);
}

/** A frozen copy for the detector, so it stays pure. */
export function stoppedSinceOf(store: StoppedSinceStore): ReadonlyMap<string, StoppedSince> {
  return new Map(store.byBus);
}
