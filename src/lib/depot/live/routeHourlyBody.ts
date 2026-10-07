import { DEFAULT_REBALANCE_PARAMS } from '../optimise/config';
import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import { deadKmFor } from '../routes/deadKm';
import { depotPositions } from '../routes/depotPositions';
import { cachedRouteProfiles } from '../routes/routeCatalogue';
import type { RouteRow } from '../routes/routeTableTypes';
import type { RouteProfile } from '../routes/types';
import { feedMinuteOn } from '../sim/dayPlan';
import { DEMAND_BASIS } from '../sim/hourlyDemandConfig';
import { modelHourlyDemand } from '../sim/hourlyDemand';
import { modelRouteLength } from '../sim/operatingDay';
import type { OperatingDay } from '../sim/operatingDayTypes';
import { modelRidershipDay } from '../sim/ridership';
import { operatingDateOf } from '../sim/seed';
import { activeHoursOf, routeHourFigures, type CurrentRouteHour } from '../service/gap';
import { ledgerJourneysOf, mergeJourneys } from '../service/journeyLedger';
import { modelledRouteHours } from '../service/modelledDeployment';
import { needInputsFor } from '../service/need';
import { capAddsAtStanding } from '../service/proposalCap';
import { buildProposals } from '../service/proposals';
import { reliabilityByHour } from '../service/reliability';
import { scheduledSupply } from '../service/scheduledSupply';
import type { LedgerJourney, RouteHourlyBody } from '../service/types';
import { MINUTES_PER_HOUR } from '../units';
import { analyseSnapshot, type SnapshotAnalysis } from './analysis';
import { operatingDayFor } from './operatingDayView';
import { routeTableOf } from './routeInputs';

/*
 * One route's day hour by hour, composed from what is held for it: the snapshot's route
 * row (the feed clock's hour), what this server observed of the date, the journeys the
 * feed reported and the looked-up bus days (scheduled), the shared modelled operating day
 * of each depot running the route (modelled deployment and the day's boardings), and the
 * engine in `service/` (demand, need, gap, proposals, punctuality). No upstream call.
 */

/** The depot the route's proposals draw on: the one running most of its buses now. */
function primaryDepotOf(row: RouteRow): string | null {
  return row.primaryDepotId ?? row.operators[0]?.depotId ?? null;
}

/** The date's journeys on the route: those held, with this snapshot's own sightings merged in. */
function routeLedger(
  view: FleetSnapshotView,
  held: readonly LedgerJourney[],
  routeName: string,
  operatingDate: string,
): LedgerJourney[] {
  const seen =
    view.feedNow === null
      ? []
      : ledgerJourneysOf(view.rows, operatingDate, view.feedNow).filter((j) => j.routeName === routeName);
  return [...mergeJourneys(new Map(held.map((j) => [j.journeyId, j] as const)), seen).values()];
}

/** In service, on the road or standing, as an observed hour counts deployed. */
function currentHourOf(row: RouteRow, feedMinute: number | null): CurrentRouteHour | null {
  if (feedMinute === null) return null;
  const { inService, onRoad, standing } = row.states;
  return {
    hour: Math.floor(feedMinute / MINUTES_PER_HOUR),
    deployed: inService + onRoad + standing,
    delayMedianMin: row.delay.medianMin,
    lateShare: row.delay.lateShare,
    delayCoverage: row.delay.coverage,
  };
}

/** Each operating depot's shared modelled day, the one the duty and revenue pages read. */
function operatorDays(view: FleetSnapshotView, row: RouteRow): OperatingDay[] {
  const ids = [...new Set(row.operators.map((o) => o.depotId))];
  return ids.map((id) => operatingDayFor(view, id)).filter((d): d is OperatingDay => d !== null);
}

/** The day's modelled boardings on the route, summed over its depots' days (the revenue page's figure). */
function dayBoardingsOf(days: readonly OperatingDay[], routeName: string): number {
  return days.reduce(
    (sum, day) => sum + (modelRidershipDay(day).find((r) => r.routeName === routeName)?.boardings ?? 0),
    0,
  );
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
function routedShare(view: FleetSnapshotView): RouteHourlyBody['routeCoverage'] {
  const routed = routeTableOf(view).reduce((sum, row) => sum + row.buses, 0);
  return { n: routed, of: view.rows.length };
}

/** The route's day as the API answers it, less the envelope; null when the snapshot has no such route. */
export async function routeHourlyBody(
  view: FleetSnapshotView,
  routeName: string,
  services: ServiceRepositories,
): Promise<RouteHourlyBody | null> {
  const row = routeTableOf(view).find((r) => r.routeName === routeName);
  if (row === undefined) return null;
  const analysis = analyseSnapshot(view);
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const feedMinute = feedMinuteOn(view.feedNow, operatingDate);
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
  const ledger = routeLedger(view, held, routeName, operatingDate);
  const days = operatorDays(view, row);
  const modelled = modelledRouteHours(days, routeName, operatingDate);
  const profile = cachedRouteProfiles(view, operatingDate).get(routeName);
  const need = needInputsFor({ routeName, ledger, profileDurationMin: profile?.scheduledDurationMin ?? null });
  const current = currentHourOf(row, feedMinute);
  const demand = modelHourlyDemand({
    routeName,
    operatingDate,
    serviceClass: need.serviceClass,
    journeyMinutes: need.journeyMinutes,
    dayBoardings: dayBoardingsOf(days, routeName),
    activeHours: activeHoursOf(observed, modelled, current),
  });
  const supply = scheduledSupply({
    routeName,
    operatingDate,
    ledger,
    trips,
    distinctBusesSeen: Math.max(distinct, row.buses),
  });
  const hours = routeHourFigures({ observed, modelled, current, scheduled: supply.hours, demand, need });
  const lengthKm =
    days.flatMap((d) => d.routes).find((r) => r.routeName === routeName)?.lengthKm ??
    modelRouteLength(routeName, need.serviceClass, profile?.lengthKm).lengthKm;
  const deadKmPerTrip = deadKmPerTripOf(analysis, primary, profile);
  const primaryDay = days.find((d) => d.depotId === primary);
  const depotName = row.operators.find((o) => o.depotId === primary)?.depotName;
  const proposals = buildProposals({
    routeName,
    operatingDate,
    feedMinute,
    hours,
    need,
    ledger,
    depot: primary === null ? null : { depotId: primary, depotName: depotName ?? primary },
    depotHours,
    modelledIdleBuses: primaryDay ? primaryDay.notRun.filter((b) => b.reason === 'no_duty').length : null,
    lengthKm,
    deadKmPerTrip,
  });
  return {
    routeName,
    routeDescription: row.description,
    serviceClass: need.serviceClass,
    operatingDate,
    currentHour: current?.hour ?? null,
    hours,
    need,
    observed: summary,
    scheduledCoverage: supply.coverage,
    routeCoverage: routedShare(view),
    proposals: capAddsAtStanding({ proposals, hours, need, lengthKm, deadKmPerTrip }),
    demandBasis: DEMAND_BASIS,
    reliability: reliabilityByHour(routeName, ledger),
  };
}
