import { COST_PER_BUS_KM, IMPACT_RANGE_SHARE } from '../sim/hourlyDemandConfig';
import { AVG_TRIP_LENGTH_SHARE, FARE_PER_KM } from '../sim/revenueConfig';
import { boardingsPerTrip, tripsPerBusHour } from './need';
import type { HourBand, ImpactRange, NeedInputs, ProposalImpact, RouteHourFigures } from './types';

export interface ImpactInput {
  /** Buses added (positive) or held (negative) through the band. */
  readonly change: number;
  readonly band: HourBand;
  /** The route's hours (any order); only the band's are read. */
  readonly hours: readonly RouteHourFigures[];
  readonly need: NeedInputs;
  /** One-way route length in km (the operating day's: real where profiled, else the class figure). */
  readonly lengthKm: number;
  /** Depot to route and back for one bus (`routes/deadKm.ts` total); charged once per bus moved. */
  readonly deadKmPerTrip?: number | null;
}

/** A central figure as a range a quarter either side, low always the smaller. */
function range(central: number): ImpactRange {
  const a = Math.round(central * (1 - IMPACT_RANGE_SHARE));
  const b = Math.round(central * (1 + IMPACT_RANGE_SHARE));
  // Normalise -0 so a zero change reads as plain zero.
  return { low: Math.min(a, b) + 0, high: Math.max(a, b) + 0 };
}

/** Boardings an hour's demand leaves behind with this many buses running. */
function leftBehind(demand: number, buses: number, need: Readonly<NeedInputs>): number {
  const carried = Math.max(0, buses) * tripsPerBusHour(need) * boardingsPerTrip(need);
  return Math.max(0, demand - carried);
}

/**
 * The MODELLED consequence of a proposal, each figure a range. Passengers: the
 * boardings the band's hours leave behind before the change less those left
 * behind after it (what a bus carries is the need formula run backwards, so
 * the two never disagree); negative for a hold that leaves some behind.
 * Revenue: those passengers at the class fare over the average ride. Bus-km:
 * the change times the band's trips times the route length, plus dead km once
 * per bus moved when known. Cost: bus-km at the REFERENCE cost per km.
 */
export function proposalImpact(input: Readonly<ImpactInput>): ProposalImpact {
  const { band, change, need } = input;
  const inBand = input.hours.filter((h) => h.hour >= band.fromHour && h.hour <= band.toHour);
  const passengers = inBand.reduce(
    (sum, h) =>
      sum +
      leftBehind(h.demand, h.deployed, need) -
      leftBehind(h.demand, h.deployed + change, need),
    0,
  );
  const revenuePerBoarding =
    AVG_TRIP_LENGTH_SHARE * input.lengthKm * FARE_PER_KM[need.serviceClass];
  const bandHours = band.toHour - band.fromHour + 1;
  const serviceKm = change * bandHours * tripsPerBusHour(need) * input.lengthKm;
  const deadKm = change * (input.deadKmPerTrip ?? 0);
  const busKm = serviceKm + deadKm;
  return {
    passengersPerDay: range(passengers),
    revenuePerDay: range(passengers * revenuePerBoarding),
    busKmPerDay: range(busKm),
    costPerDay: range(busKm * COST_PER_BUS_KM),
    provenance: 'modelled',
  };
}
