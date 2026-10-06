import { compareText } from '../stats/order';
import { feedDigitsOn } from '../service/journeyLedger';
import { depotHourFromSlots, hourFromSlots, observedHourCount } from '../service/observe';
import type {
  LedgerJourney,
  ObservedDepotHour,
  ObservedRouteHour,
  ObservedSummary,
  SlotSample,
} from '../service/types';
import type { ServiceHoldStore } from './serviceHold';

/*
 * Reads of the service hold for one operating date. A date other than the
 * one held reads as nothing observed: the hold keeps one date only. Every
 * read returns new arrays, so the store may move on while a caller keeps what
 * it was given.
 */

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** The date's slot samples in slot order; empty for a date not held. */
export function heldSlots(store: ServiceHoldStore, operatingDate: string): SlotSample[] {
  if (store.operatingDate !== operatingDate) return [];
  return [...store.slots.values()].sort((a, b) => a.slot - b.slot);
}

/** The route's observed hours of the date, in hour order; hours not observed are absent. */
export function heldRouteHours(
  store: ServiceHoldStore,
  routeName: string,
  operatingDate: string,
): ObservedRouteHour[] {
  const slots = heldSlots(store, operatingDate);
  if (slots.length === 0 || !store.routeNames.has(routeName)) return [];
  return HOURS.flatMap((hour) => hourFromSlots(routeName, operatingDate, hour, slots) ?? []);
}

/** The depot's observed hours of the date, in hour order; hours not observed are absent. */
export function heldDepotHours(
  store: ServiceHoldStore,
  depotId: string,
  operatingDate: string,
): ObservedDepotHour[] {
  const slots = heldSlots(store, operatingDate);
  if (slots.length === 0 || !store.depotIds.has(depotId)) return [];
  return HOURS.flatMap((hour) => depotHourFromSlots(depotId, operatingDate, hour, slots) ?? []);
}

/** Since when this server observed the date, its observed hours and samples; null when none. */
export function heldSummary(
  store: ServiceHoldStore,
  operatingDate: string,
): ObservedSummary | null {
  const slots = heldSlots(store, operatingDate);
  const since = feedDigitsOn(store.observedSince, operatingDate);
  if (slots.length === 0 || since === null) return null;
  return { since, hours: observedHourCount(operatingDate, slots), samples: slots.length };
}

/** The ledger's journeys on one route for the date, in journey id order. */
export function heldJourneysOnRoute(
  store: ServiceHoldStore,
  routeName: string,
  operatingDate: string,
): LedgerJourney[] {
  if (store.operatingDate !== operatingDate) return [];
  return [...store.journeys.values()]
    .filter((j) => j.routeName === routeName)
    .sort((a, b) => compareText(a.journeyId, b.journeyId));
}

/** Distinct buses seen carrying the route name in the date. */
export function heldBusesOnRoute(
  store: ServiceHoldStore,
  routeName: string,
  operatingDate: string,
): number {
  if (store.operatingDate !== operatingDate) return 0;
  return store.routeBuses.get(routeName)?.size ?? 0;
}
