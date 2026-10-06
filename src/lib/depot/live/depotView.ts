import type { DepotBusRow } from '@/models/depotLive';
import type { DepotBusView, DepotDetailResponse, VisitorBus } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import type { BusOpState, Figure } from '../types';
import type { BusLocation, LocatedBus, Yard } from '../infer/types';
import { gpsAgeMinutes } from '../infer/busState';
import { hasUsablePosition } from '../infer/geo';
import { locateBus } from '../infer/location';
import {
  MAX_PLAUSIBLE_DELAY_MIN,
  isScheduledForFeedDate,
  summariseOutshed,
} from '../infer/outshed';
import { compareText } from '../exceptions/depotExceptions';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';

const DATE_PREFIX_LENGTH = 10;

/** On the road first, then idle, then the buses that need chasing. */
const STATE_ORDER: Readonly<Record<BusOpState, number>> = {
  in_service: 0,
  on_road: 1,
  standing: 2,
  dark: 3,
  off_road: 4,
};

const YARD_NOTE = "Learned from where the depot's buses park; not a surveyed location.";
const NO_YARD_NOTE =
  "Not enough of the depot's buses are parked together to learn where its yard is.";

/** A feed delay is shown only when it describes today's run and is believable. */
function plausibleDelay(row: DepotBusRow, feedNow: string | null): number | null {
  if (row.delayMinutes === null || !isScheduledForFeedDate(row, feedNow)) return null;
  return Math.abs(row.delayMinutes) <= MAX_PLAUSIBLE_DELAY_MIN ? row.delayMinutes : null;
}

function toBusView(
  row: DepotBusRow,
  state: BusOpState,
  located: LocatedBus,
  feedNow: string | null,
): DepotBusView {
  const age = gpsAgeMinutes(row, feedNow);
  return {
    registrationNumber: row.registrationNumber,
    state,
    location: located.location,
    otherDepotId: located.otherDepotId,
    distanceFromYardKm: located.distanceFromYardKm,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKmph: row.speedKmph,
    gpsAgeMin: age === null ? null : Math.round(age),
    vehicleStatus: row.vehicleStatus,
    tripStatus: row.tripStatus,
    routeName: row.routeName,
    routeDescription: row.routeDescription,
    journeyId: row.journeyId,
    journeyCode: row.journeyCode,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    tripDate: row.scheduledStart?.slice(0, DATE_PREFIX_LENGTH) ?? null,
    delayMinutes: plausibleDelay(row, feedNow),
    mainPowerOn: row.mainPowerOn,
    tamperCode: row.tamperCode,
  };
}

function compareBuses(a: DepotBusView, b: DepotBusView): number {
  return (
    STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
    compareText(a.registrationNumber, b.registrationNumber)
  );
}

function yardFigure(yard: Yard | null): Figure<Yard | null> {
  if (yard === null) return { value: null, provenance: 'derived', note: NO_YARD_NOTE };
  return {
    value: yard,
    provenance: 'derived',
    coverage: { n: yard.inCluster, of: yard.parked },
    note: YARD_NOTE,
  };
}

function locationMixOf(buses: readonly DepotBusView[]): Record<BusLocation, number> {
  const mix: Record<BusLocation, number> = { in_yard: 0, at_other_yard: 0, away: 0, unknown: 0 };
  for (const bus of buses) mix[bus.location] += 1;
  return mix;
}

function visitorsOf(analysis: SnapshotAnalysis, depotId: string): VisitorBus[] {
  return (analysis.visitorsByDepot.get(depotId) ?? []).map((row) => ({
    registrationNumber: row.registrationNumber,
    homeDepotId: row.depotId,
    homeDepotName:
      row.depotId === null ? null : (analysis.depotsById.get(row.depotId)?.name ?? null),
    state: analysis.stateOf(row),
    position: hasUsablePosition(row) ? { lat: row.latitude, lng: row.longitude } : null,
  }));
}

/**
 * One depot's buses as views, in the page's order. Cheap: no yard, outshed or
 * exception work, so a network-wide caller can use it for every depot.
 */
export function depotBusViews(analysis: SnapshotAnalysis, depotId: string): DepotBusView[] {
  const { feedNow, yards, stateOf } = analysis;
  return (analysis.rowsByDepot.get(depotId) ?? [])
    .map((row) =>
      toBusView(
        row,
        stateOf(row),
        analysis.locations.get(row.registrationNumber) ?? locateBus(row, yards),
        feedNow,
      ),
    )
    .sort(compareBuses);
}

/**
 * One depot as its manager sees it, or null when the snapshot has no such
 * depot. Reads only the shared analysis: states, yards, locations, visitors
 * and exceptions are never recomputed per request. Bus exceptions come from
 * the analysis's per-depot index, which is filled before the network cap is
 * applied, so a depot's own list is always complete.
 */
export function buildDepotDetail(
  view: FleetSnapshotView,
  depotId: string,
): DepotDetailResponse | null {
  const analysis = analyseSnapshot(view);
  const depot = analysis.depotsById.get(depotId);
  if (!depot) return null;
  const { feedNow, yards, stateOf } = analysis;
  const rows = analysis.rowsByDepot.get(depotId) ?? [];
  const buses = depotBusViews(analysis, depotId);
  const exceptions = analysis.exceptionsByDepot.get(depotId);
  return {
    ...feedEnvelope(view),
    depot,
    score: analysis.scoresById.get(depotId) ?? null,
    yard: yardFigure(yards.get(depotId) ?? null),
    buses,
    locationMix: locationMixOf(buses),
    outshed: summariseOutshed(rows, yards, feedNow, stateOf),
    exceptions: { depot: exceptions?.depot ?? [], bus: exceptions?.bus ?? [] },
    visitors: visitorsOf(analysis, depotId),
  };
}
