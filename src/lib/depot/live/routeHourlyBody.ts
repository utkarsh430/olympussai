import { DEFAULT_REBALANCE_PARAMS } from '../optimise/config';
import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import { deadKmFor } from '../routes/deadKm';
import { depotPositions } from '../routes/depotPositions';
import { cachedRouteProfiles } from '../routes/routeCatalogue';
import type { RouteRow } from '../routes/routeTableTypes';
import type { RouteProfile } from '../routes/types';
import { feedMinuteOn } from '../sim/dayPlan';
import type { OperatingDay } from '../sim/operatingDayTypes';
import { operatingDateOf } from '../sim/seed';
import { ledgerJourneysOf, mergeJourneys } from '../service/journeyLedger';
import { primaryDepotOf, routeDayOf, type RouteDayInputs } from '../service/routeDay';
import { routeTimetable, type RouteTimetable } from '../service/routeTimetable';
import type { LedgerJourney, RouteHourlyBody, ScheduledTrip } from '../service/types';
import type { Coverage } from '../types';
import { analyseSnapshot, type SnapshotAnalysis } from './analysis';
import { operatingDayFor } from './operatingDayView';
import { routeTableOf } from './routeInputs';

/*
 * One route's day hour by hour, gathered from what is held for it (the snapshot's route
 * row, what this server observed of the date, the journeys the feed reported, the looked-up
 * bus days, the operating depots' shared modelled day, the cached route profile) and
 * composed by `routeDayOf`, the engine's pure route day. No upstream call.
 */

/**
 * What every route of the snapshot reads from its rows, gathered in one pass: this
 * snapshot's own journey sightings by route, and the cached route profiles. The network
 * view gathers it once for all its routes rather than once per route.
 */
export interface SnapshotRouteShared {
  readonly seen: ReadonlyMap<string, readonly LedgerJourney[]>;
  readonly profiles: ReadonlyMap<string, RouteProfile>;
}

export function snapshotRouteShared(view: FleetSnapshotView): SnapshotRouteShared {
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const seen = new Map<string, LedgerJourney[]>();
  if (view.feedNow !== null) {
    for (const j of ledgerJourneysOf(view.rows, operatingDate, view.feedNow)) {
      seen.set(j.routeName, [...(seen.get(j.routeName) ?? []), j]);
    }
  }
  return { seen, profiles: cachedRouteProfiles(view, operatingDate) };
}

/** The date's journeys on the route: those held, with this snapshot's own sightings merged in. */
function routeLedger(held: readonly LedgerJourney[], seen: readonly LedgerJourney[]): LedgerJourney[] {
  return [...mergeJourneys(new Map(held.map((j) => [j.journeyId, j] as const)), seen).values()];
}

/** Each operating depot's shared modelled day, the one the duty and revenue pages read. */
function operatorDays(view: FleetSnapshotView, row: RouteRow): OperatingDay[] {
  const ids = [...new Set(row.operators.map((o) => o.depotId))];
  return ids.map((id) => operatingDayFor(view, id)).filter((d): d is OperatingDay => d !== null);
}

function deadKmPerTripOf(
  analysis: SnapshotAnalysis,
  depotId: string | null,
  profile: RouteProfile | undefined,
): number | null {
  if (depotId === null || profile === undefined) return null;
  const depot = depotPositions(analysis.depots, analysis.yards).get(depotId);
  if (depot === undefined) return null;
  return deadKmFor(depot.position, profile, DEFAULT_REBALANCE_PARAMS.detourFactor)?.perTripKm ?? null;
}

/** Buses carrying any route name, of every bus in the snapshot. */
export function routedShare(view: FleetSnapshotView): Coverage {
  const routed = routeTableOf(view).reduce((sum, row) => sum + row.buses, 0);
  return { n: routed, of: view.rows.length };
}

/** The route's timetable by bus: who was seen on it, whose whole day is recorded, what was borrowed. */
async function timetableOf(
  view: FleetSnapshotView,
  routeName: string,
  operatingDate: string,
  services: ServiceRepositories,
  trips: readonly ScheduledTrip[],
): Promise<RouteTimetable> {
  const [heldBuses, recordedBuses, knownOnRoute] = await Promise.all([
    services.hourly.busesOnRoute(routeName, operatingDate),
    services.scheduled.recordedBuses(operatingDate),
    services.scheduled.knownBusesOnRoute(routeName, operatingDate),
  ]);
  const snapshotBuses = view.rows.filter((r) => r.routeName === routeName).map((r) => r.registrationNumber);
  return routeTimetable({ heldBuses, snapshotBuses, recordedBuses, knownOnRoute, trips });
}

/** Everything `routeDayOf` needs for one route of the snapshot, read from the stores and the snapshot. */
export async function routeDayInputsFor(
  view: FleetSnapshotView,
  row: RouteRow,
  services: ServiceRepositories,
  routeCoverage: Coverage,
  shared: SnapshotRouteShared = snapshotRouteShared(view),
): Promise<RouteDayInputs> {
  const routeName = row.routeName;
  const analysis = analyseSnapshot(view);
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const primary = primaryDepotOf(row);
  const { hourly, scheduled } = services;
  const [observed, depotHours, summary, distinct, held, trips] = await Promise.all([
    hourly.routeHours(routeName, operatingDate),
    primary === null ? Promise.resolve([]) : hourly.depotHours(primary, operatingDate),
    hourly.observedSummary(operatingDate),
    hourly.distinctBusesOnRoute(routeName, operatingDate),
    hourly.journeysOnRoute(routeName, operatingDate),
    scheduled.tripsForRoute(routeName, operatingDate),
  ]);
  const timetable = await timetableOf(view, routeName, operatingDate, services, trips);
  const days = operatorDays(view, row);
  const profile = shared.profiles.get(routeName);
  const primaryDay = days.find((d) => d.depotId === primary);
  return {
    row,
    operatingDate,
    feedMinute: feedMinuteOn(view.feedNow, operatingDate),
    observed,
    depotHours,
    summary,
    distinctBuses: distinct,
    ledger: routeLedger(held, shared.seen.get(routeName) ?? []),
    trips,
    timetable,
    profileDurationMin: profile?.scheduledDurationMin ?? null,
    profileLengthKm: profile?.lengthKm ?? null,
    dayLengthKm: days.flatMap((d) => d.routes).find((r) => r.routeName === routeName)?.lengthKm ?? null,
    modelledIdleBuses: primaryDay ? primaryDay.notRun.filter((b) => b.reason === 'no_duty').length : null,
    deadKmPerTrip: deadKmPerTripOf(analysis, primary, profile),
    routeCoverage,
  };
}

/** The route's day as the API answers it, less the envelope; null when the snapshot has no such route. */
export async function routeHourlyBody(
  view: FleetSnapshotView,
  routeName: string,
  services: ServiceRepositories,
): Promise<RouteHourlyBody | null> {
  const row = routeTableOf(view).find((r) => r.routeName === routeName);
  if (row === undefined) return null;
  return routeDayOf(await routeDayInputsFor(view, row, services, routedShare(view)));
}
