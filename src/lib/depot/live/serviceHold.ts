import type { FleetSnapshotView } from '../repositories/types';
import { ledgerJourneysOf, mergeJourneys } from '../service/journeyLedger';
import { slotOf, slotSampleOf } from '../service/observe';
import type { LedgerJourney, SlotSample } from '../service/types';
import type { SnapshotAnalysis } from './analysis';

export {
  heldBusesOnRoute,
  heldBusRegistrationsOnRoute,
  heldDepotHours,
  heldJourneysOnRoute,
  heldRouteHours,
  heldSlots,
  heldSummary,
} from './serviceHoldReads';

/*
 * The holder of what this server has observed of the operating date, slot by
 * slot: the record "deployed per hour" is read from, and the journey ledger.
 *
 * What each offer does (`offerServiceSnapshot`, once per snapshot analysis):
 *  - The same operating date as the one held: the snapshot's 5-minute slot of
 *    feed time takes its sample unless the slot already holds one from an
 *    equal or newer feed time (then nothing changes); the journeys it reports
 *    merge into the ledger, and the buses carrying each route name are noted.
 *  - A later operating date: the store starts afresh from this snapshot.
 *  - An earlier operating date (a feed clock that stepped back over midnight),
 *    no feed clock, or the recorded fixture: nothing is written.
 *
 * The state is per process: a process that has just started has observed
 * nothing, and pages say "observed by this server since". It never reads the
 * wall clock. Bounds: one date; at most one sample for each of the date's 288
 * slots; at most `maxRoutes` route names and `maxDepots` depots for the date,
 * admitted first come (a snapshot's routes arrive busiest first), the rest
 * left out of every sample; at most `maxJourneys` journeys and
 * `maxBusesPerRoute` registrations per route.
 */

export const SERVICE_HOLD_MAX_ROUTES = 1000;
export const SERVICE_HOLD_MAX_DEPOTS = 1000;
export const SERVICE_HOLD_MAX_JOURNEYS = 20_000;
export const SERVICE_HOLD_MAX_BUSES_PER_ROUTE = 500;

export interface ServiceHoldLimits {
  readonly maxRoutes: number;
  readonly maxDepots: number;
  readonly maxJourneys: number;
  readonly maxBusesPerRoute: number;
}

export interface ServiceHoldStore {
  readonly limits: ServiceHoldLimits;
  /** The operating date (YYYY-MM-DD) held; null before the first snapshot. */
  operatingDate: string | null;
  /** The earliest feed time recorded for the date. */
  observedSince: string | null;
  /** Keyed by slot, 0 to 287. */
  readonly slots: Map<number, SlotSample>;
  /** Route names and depot ids admitted for the date, under the caps. */
  readonly routeNames: Set<string>;
  readonly depotIds: Set<string>;
  /** Per admitted route, the registrations seen carrying its name in the date. */
  readonly routeBuses: Map<string, Set<string>>;
  /** The journey ledger for the date, by journey id. */
  journeys: ReadonlyMap<string, LedgerJourney>;
}

const DEFAULT_LIMITS: ServiceHoldLimits = {
  maxRoutes: SERVICE_HOLD_MAX_ROUTES,
  maxDepots: SERVICE_HOLD_MAX_DEPOTS,
  maxJourneys: SERVICE_HOLD_MAX_JOURNEYS,
  maxBusesPerRoute: SERVICE_HOLD_MAX_BUSES_PER_ROUTE,
};

export function createServiceHoldStore(limits: Partial<ServiceHoldLimits> = {}): ServiceHoldStore {
  return {
    limits: { ...DEFAULT_LIMITS, ...limits },
    operatingDate: null,
    observedSince: null,
    slots: new Map(),
    routeNames: new Set(),
    depotIds: new Set(),
    routeBuses: new Map(),
    journeys: new Map(),
  };
}

const GLOBAL_KEY = '__depotServiceHoldStore';
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: ServiceHoldStore };

/** The one process-wide store; on `globalThis` so a dev reload does not fork it. */
export function defaultServiceHoldStore(): ServiceHoldStore {
  const holder = globalThis as GlobalWithStore;
  holder[GLOBAL_KEY] ??= createServiceHoldStore();
  return holder[GLOBAL_KEY];
}

function startDate(store: ServiceHoldStore, operatingDate: string | null): void {
  store.operatingDate = operatingDate;
  store.observedSince = null;
  store.slots.clear();
  store.routeNames.clear();
  store.depotIds.clear();
  store.routeBuses.clear();
  store.journeys = new Map();
}

/** Test seam: empty a store (the process-wide one by default). */
export function resetServiceHoldStore(store: ServiceHoldStore = defaultServiceHoldStore()): void {
  startDate(store, null);
}

/** Whether a key is held, admitting it when the set is still under its cap. */
function admitted(held: Set<string>, key: string, cap: number): boolean {
  if (held.has(key)) return true;
  if (held.size >= cap) return false;
  held.add(key);
  return true;
}

function noteRouteBuses(store: ServiceHoldStore, view: FleetSnapshotView): void {
  for (const row of view.rows) {
    const name = row.routeName;
    if (name === null || !store.routeNames.has(name)) continue;
    const buses = store.routeBuses.get(name) ?? new Set<string>();
    if (buses.size < store.limits.maxBusesPerRoute) buses.add(row.registrationNumber);
    store.routeBuses.set(name, buses);
  }
}

const earlier = (a: string | null, b: string): string =>
  a !== null && Date.parse(a) <= Date.parse(b) ? a : b;

/**
 * Offers one snapshot to the store (see the top of this file). Call it once
 * per snapshot analysis.
 */
export function offerServiceSnapshot(
  store: ServiceHoldStore,
  view: FleetSnapshotView,
  analysis: SnapshotAnalysis,
): void {
  if (view.source === 'fixture' || view.feedNow === null) return;
  const at = slotOf(view.feedNow);
  if (at === null) return;
  if (store.operatingDate !== null && at.operatingDate < store.operatingDate) return;
  if (store.operatingDate !== at.operatingDate) startDate(store, at.operatingDate);
  const held = store.slots.get(at.slot);
  if (held !== undefined && Date.parse(held.feedNow) >= Date.parse(view.feedNow)) return;
  const sample = slotSampleOf(view, analysis);
  if (sample === null) return;
  const { maxRoutes, maxDepots, maxJourneys } = store.limits;
  store.slots.set(at.slot, {
    ...sample,
    routes: sample.routes.filter((r) => admitted(store.routeNames, r.routeName, maxRoutes)),
    depots: sample.depots.filter((d) => admitted(store.depotIds, d.depotId, maxDepots)),
  });
  store.observedSince = earlier(store.observedSince, view.feedNow);
  noteRouteBuses(store, view);
  const seen = ledgerJourneysOf(view.rows, at.operatingDate, view.feedNow);
  store.journeys = mergeJourneys(store.journeys, seen, maxJourneys);
}
