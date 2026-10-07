import type { RouteRow } from '../routes/routeTableTypes';
import { DEMAND_BASIS } from '../sim/hourlyDemandConfig';
import { modelHourlyDemand } from '../sim/hourlyDemand';
import { modelRouteLength } from '../sim/operatingDay';
import type { Coverage } from '../types';
import { MINUTES_PER_HOUR } from '../units';
import { activeHoursOf, routeHourFigures, type CurrentRouteHour } from './gap';
import { modelledRouteHours } from './modelledDeployment';
import { needInputsFor } from './need';
import { capAddsAtStanding } from './proposalCap';
import { buildProposals } from './proposals';
import { reliabilityByHour } from './reliability';
import { routeDayBoardings } from './routeDayBoardings';
import { scheduledSupply } from './scheduledSupply';
import type {
  LedgerJourney,
  NeedInputs,
  ObservedDepotHour,
  ObservedRouteHour,
  ObservedSummary,
  RouteHourlyBody,
  ScheduledTrip,
} from './types';

/*
 * One route's day hour by hour, from inputs already gathered: the snapshot's route row
 * (the feed clock's hour), what this server observed of the date, the journeys and the
 * looked-up trips (scheduled), a modelled day drawn from the buses the snapshot shows on
 * the route, and the operating depots' modelled day (route length, idle buses). Pure: the
 * route day view and the network view both call it, so one route reads the same on both.
 */

export interface RouteDayInputs {
  readonly row: RouteRow;
  readonly operatingDate: string;
  /** Minutes into the operating date by the feed clock; null without a feed clock. */
  readonly feedMinute: number | null;
  readonly observed: readonly ObservedRouteHour[];
  /** The primary depot's observed hours (its standing pool and unrouted buses). */
  readonly depotHours: readonly ObservedDepotHour[];
  readonly summary: ObservedSummary | null;
  readonly distinctBuses: number;
  /** The date's journeys on the route, held and this snapshot's own, merged. */
  readonly ledger: readonly LedgerJourney[];
  readonly trips: readonly ScheduledTrip[];
  readonly profileDurationMin: number | null;
  readonly profileLengthKm: number | null;
  /** The route's length in an operating depot's modelled day; null when no day carries it. */
  readonly dayLengthKm: number | null;
  /** Buses the primary depot's modelled day leaves without a duty; null without its day. */
  readonly modelledIdleBuses: number | null;
  readonly deadKmPerTrip: number | null;
  readonly routeCoverage: Coverage;
}

/** The depot the route's proposals draw on: the one running most of its buses now. */
export function primaryDepotOf(row: RouteRow): string | null {
  return row.primaryDepotId ?? row.operators[0]?.depotId ?? null;
}

/** In service or on the road, as an observed hour counts deployed; standing buses run nothing. */
function currentHourOf(row: RouteRow, feedMinute: number | null): CurrentRouteHour | null {
  if (feedMinute === null) return null;
  const { inService, onRoad } = row.states;
  return {
    hour: Math.floor(feedMinute / MINUTES_PER_HOUR),
    deployed: inService + onRoad,
    delayMedianMin: row.delay.medianMin,
    lateShare: row.delay.lateShare,
    delayCoverage: row.delay.coverage,
  };
}

/** The journey minutes the feed's schedule or the profile gives; null when only the trip model's assumption is left. */
function knownJourneyMinutes(need: NeedInputs): number | null {
  return need.journeyMinutesProvenance === 'derived' ? need.journeyMinutes : null;
}

/** The route's day as the API answers it, less the envelope. */
export function routeDayOf(inputs: Readonly<RouteDayInputs>): RouteHourlyBody {
  const { row, operatingDate, feedMinute, observed, ledger } = inputs;
  const routeName = row.routeName;
  const primary = primaryDepotOf(row);
  const need = needInputsFor({ routeName, ledger, profileDurationMin: inputs.profileDurationMin });
  const fleet = { routeName, operatingDate, buses: row.buses, journeyMinutes: knownJourneyMinutes(need) };
  const modelled = modelledRouteHours(fleet);
  const current = currentHourOf(row, feedMinute);
  const demand = modelHourlyDemand({
    routeName,
    operatingDate,
    serviceClass: need.serviceClass,
    journeyMinutes: need.journeyMinutes,
    dayBoardings: routeDayBoardings(fleet).boardings,
    activeHours: activeHoursOf(observed, modelled, current),
  });
  const supply = scheduledSupply({
    routeName,
    operatingDate,
    ledger,
    trips: inputs.trips,
    distinctBusesSeen: Math.max(inputs.distinctBuses, row.buses),
  });
  const hours = routeHourFigures({ observed, modelled, current, scheduled: supply.hours, demand, need });
  const lengthKm =
    inputs.dayLengthKm ?? modelRouteLength(routeName, need.serviceClass, inputs.profileLengthKm).lengthKm;
  const depotName = row.operators.find((o) => o.depotId === primary)?.depotName;
  const proposals = buildProposals({
    routeName,
    operatingDate,
    feedMinute,
    hours,
    need,
    ledger,
    depot: primary === null ? null : { depotId: primary, depotName: depotName ?? primary },
    depotHours: inputs.depotHours,
    modelledIdleBuses: inputs.modelledIdleBuses,
    lengthKm,
    deadKmPerTrip: inputs.deadKmPerTrip,
  });
  return {
    routeName,
    routeDescription: row.description,
    serviceClass: need.serviceClass,
    operatingDate,
    currentHour: current?.hour ?? null,
    hours,
    need,
    observed: inputs.summary,
    scheduledCoverage: supply.coverage,
    routeCoverage: inputs.routeCoverage,
    standingNow: row.states.standing,
    proposals: capAddsAtStanding({ proposals, hours, need, lengthKm, deadKmPerTrip: inputs.deadKmPerTrip }),
    demandBasis: DEMAND_BASIS,
    reliability: reliabilityByHour(routeName, ledger),
  };
}
