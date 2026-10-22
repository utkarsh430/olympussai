import { SeededRandom } from '../../../simulation/seededRandom';
import { DEFAULT_PRICE_PER_LITRE } from '../../fuel/types';
import { modelService } from '../../maintenance/serviceModel';
import { STATIC_SEED_DATE } from '../../sim/config';
import { FUEL_CLASS_KM_PER_LITRE, FUEL_DAILY_NOISE, FUEL_EFFICIENCY_SPREAD } from '../../sim/fuelConfig';
import { modelBus } from '../../sim/fleetMaster';
import { seedFor } from '../../sim/seed';
import type { ServiceClass } from '../../sim/types';
import type { FleetBus } from '../fleetIndex';
import type { Severity } from './types';

/**
 * Journey-level fuel audit. There is no tank sensor: the only records are a day's
 * distance and the fuel issued against it (scenario records until the depot fuel system
 * is connected). A journey is judged against the same vehicle's own median economy over
 * the window, so a bus that is always thirsty is not flagged for being itself, and the
 * class figure is shown beside it for comparison. Nothing here concludes why fuel was
 * over-issued: it ranks journeys for a person to verify.
 *
 * The per-vehicle economy uses the Fuel & Cost page's own seeds (`fuel-efficiency`,
 * `fuel-day`), so a bus's typical km/L agrees across both pages. The window ends the day
 * before the operating date: completed days only, never the day in progress.
 */

export const AUDIT_DAYS = 14;
/** A journey is flagged from this much fuel above its expected issue... */
export const FLAG_VARIANCE = 0.1;
/** ...and only when it is this many robust deviations below the vehicle's own median. */
export const FLAG_Z = 3;
const MAD_TO_SIGMA = 1.4826;
const MAD_FLOOR_SHARE = 0.02;
const MIN_HISTORY = 5;

const DAILY_KM: Readonly<Record<ServiceClass, readonly [number, number]>> = {
  ordinary: [210, 330],
  express: [290, 430],
  ac: [270, 410],
  premium: [320, 470],
};

const RUN_SHARE = 0.86;
const PRONE_SHARE = 0.02;
const PRONE_ANOMALY_SHARE = 0.32;
const BASE_ANOMALY_SHARE = 0.004;
const EXCESS_RANGE = [0.12, 0.42] as const;

export interface AuditJourney {
  readonly id: string;
  readonly registration: string;
  readonly depotId: string | null;
  readonly date: string;
  readonly routeName: string | null;
  readonly serviceClass: ServiceClass;
  readonly distanceKm: number;
  readonly fuelLitres: number;
  readonly kmPerLitre: number;
}

export interface JourneyAudit extends AuditJourney {
  readonly baselineKmPerLitre: number;
  readonly classKmPerLitre: number;
  readonly expectedLitres: number;
  readonly excessLitres: number;
  readonly variance: number;
  readonly z: number | null;
  readonly flagged: boolean;
  readonly severity: Severity | null;
  readonly exposureRupees: number;
  /** Flagged journeys of the same vehicle in the window, this one included. */
  readonly recurrence: number;
  readonly factors: readonly string[];
  readonly explanations: readonly string[];
}

export interface VehicleFuelHistory {
  readonly registration: string;
  readonly depotId: string | null;
  readonly serviceClass: ServiceClass;
  readonly ageYears: number;
  readonly medianKmPerLitre: number | null;
  readonly classKmPerLitre: number;
  readonly journeys: readonly JourneyAudit[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** YYYY-MM-DD `days` before `date`, in calendar days (UTC arithmetic on a date string). */
export function shiftDate(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  return new Date(time - days * 86_400_000).toISOString().slice(0, 10);
}

/** The audit window's dates, oldest first, ending the day before the operating date. */
export function auditDates(operatingDate: string): readonly string[] {
  return Array.from({ length: AUDIT_DAYS }, (_, i) => shiftDate(operatingDate, AUDIT_DAYS - i));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The journeys one bus ran in the window. Pure in (registration, route, state, date). */
export function journeysOf(bus: Pick<FleetBus, 'registration' | 'depotId' | 'routeName' | 'state'>, operatingDate: string): AuditJourney[] {
  const modelled = modelBus(bus.registration, bus.routeName);
  const cls = modelled.serviceClass;
  const lasting = new SeededRandom(seedFor(bus.registration, STATIC_SEED_DATE, 'fuel-efficiency')).float(
    -FUEL_EFFICIENCY_SPREAD,
    FUEL_EFFICIENCY_SPREAD,
  );
  const prone = new SeededRandom(seedFor(bus.registration, STATIC_SEED_DATE, 'fuel-audit-prone')).bool(PRONE_SHARE);
  // A bus off the road now has been off for its last few days.
  const offDays = bus.state === 'off_road' ? new SeededRandom(seedFor(bus.registration, operatingDate, 'off-road-days')).int(1, 6) : 0;
  const dates = auditDates(operatingDate);
  const out: AuditJourney[] = [];
  dates.forEach((date, index) => {
    if (index >= dates.length - offDays) return;
    const day = new SeededRandom(seedFor(bus.registration, date, 'fuel-audit-day'));
    const runs = day.bool(RUN_SHARE);
    const [lo, hi] = DAILY_KM[cls];
    const distanceKm = Math.round(day.float(lo, hi));
    const anomalous = day.bool(prone ? PRONE_ANOMALY_SHARE : BASE_ANOMALY_SHARE);
    const excess = day.float(EXCESS_RANGE[0], EXCESS_RANGE[1]);
    if (!runs) return;
    const noise = new SeededRandom(seedFor(bus.registration, date, 'fuel-day')).float(-FUEL_DAILY_NOISE, FUEL_DAILY_NOISE);
    const kmPerLitreTrue = FUEL_CLASS_KM_PER_LITRE[cls] * (1 + lasting) * (1 + noise);
    const fuelLitres = round1((distanceKm / kmPerLitreTrue) * (anomalous ? 1 + excess : 1));
    out.push({
      id: `${bus.registration}:${date}`,
      registration: bus.registration,
      depotId: bus.depotId,
      date,
      routeName: bus.routeName,
      serviceClass: cls,
      distanceKm,
      fuelLitres,
      kmPerLitre: round2(distanceKm / fuelLitres),
    });
  });
  return out;
}

function severityOf(variance: number, recurrence: number): Severity {
  if (variance >= 0.3 || recurrence >= 3) return 'high';
  return variance >= 0.18 ? 'medium' : 'low';
}

function explanationsOf(cls: ServiceClass, overdue: boolean, ageYears: number): string[] {
  const list = [
    'Fuel issue recorded against the wrong vehicle or day: check the issue register and pump reading.',
    'Distance under-recorded (diversion or an extra trip not logged): compare with the GPS track.',
  ];
  if (overdue || ageYears >= 10) list.unshift('Mechanical inefficiency (injectors, tyre pressure, brake drag): inspect at the next service.');
  if (cls === 'ac' || cls === 'premium') list.push('Air-conditioning load or long idling at terminals.');
  list.push('Issue-to-tank discrepancy: verify physically before any conclusion is drawn.');
  return list;
}

/** Every journey of one bus, audited against its own history. */
export function auditVehicle(bus: Pick<FleetBus, 'registration' | 'depotId' | 'routeName' | 'state'>, operatingDate: string): VehicleFuelHistory {
  const modelled = modelBus(bus.registration, bus.routeName);
  const service = modelService(modelled);
  const journeys = journeysOf(bus, operatingDate);
  const classKmPerLitre = FUEL_CLASS_KM_PER_LITRE[modelled.serviceClass];
  const economies = journeys.map((j) => j.kmPerLitre);
  const vehicleMedian = median(economies);

  const first = journeys.map((j, i) => {
    const others = economies.filter((_, k) => k !== i);
    const enough = others.length >= MIN_HISTORY;
    const baseline = (enough ? median(others) : null) ?? classKmPerLitre;
    const deviations = enough ? others.map((e) => Math.abs(e - baseline)) : [];
    const mad = Math.max(median(deviations) ?? 0, baseline * MAD_FLOOR_SHARE);
    const z = enough ? (baseline - j.kmPerLitre) / (MAD_TO_SIGMA * mad) : null;
    const expectedLitres = j.distanceKm / baseline;
    const variance = (j.fuelLitres - expectedLitres) / expectedLitres;
    const flagged = variance >= FLAG_VARIANCE && z !== null && z >= FLAG_Z;
    return { j, baseline, z, expectedLitres, variance, flagged };
  });
  const recurrence = first.filter((f) => f.flagged).length;

  const audited = first.map(({ j, baseline, z, expectedLitres, variance, flagged }): JourneyAudit => {
    const excessLitres = Math.max(0, j.fuelLitres - expectedLitres);
    const factors: string[] = [];
    if (flagged) {
      factors.push(`${Math.round(variance * 100)}% more fuel than this bus's own ${AUDIT_DAYS}-day median economy`);
      if (recurrence >= 2) factors.push(`Recurs: ${recurrence} flagged journeys on this bus in ${AUDIT_DAYS} days`);
      if (vehicleMedian !== null && vehicleMedian < classKmPerLitre * 0.92) {
        factors.push(`Runs below its class: ${vehicleMedian.toFixed(2)} vs ${classKmPerLitre.toFixed(1)} km/L`);
      }
      if (service.group === 'overdue') {
        factors.push(`Service overdue by ${Math.round(-service.kmToNextService).toLocaleString('en-IN')} km`);
      }
      if (modelled.ageYears >= 10) factors.push(`${modelled.ageYears} years in service`);
    }
    return {
      ...j,
      baselineKmPerLitre: round2(baseline),
      classKmPerLitre,
      expectedLitres: round1(expectedLitres),
      excessLitres: round1(excessLitres),
      variance: round2(variance),
      z: z === null ? null : round1(z),
      flagged,
      severity: flagged ? severityOf(variance, recurrence) : null,
      exposureRupees: flagged ? Math.round(excessLitres * DEFAULT_PRICE_PER_LITRE) : 0,
      recurrence: flagged ? recurrence : 0,
      factors,
      explanations: flagged ? explanationsOf(modelled.serviceClass, service.group === 'overdue', modelled.ageYears) : [],
    };
  });

  return {
    registration: bus.registration,
    depotId: bus.depotId,
    serviceClass: modelled.serviceClass,
    ageYears: modelled.ageYears,
    medianKmPerLitre: vehicleMedian === null ? null : round2(vehicleMedian),
    classKmPerLitre,
    journeys: audited,
  };
}

export interface FuelAuditSummary {
  readonly vehicles: number;
  readonly journeys: number;
  readonly distanceKm: number;
  readonly fuelLitres: number;
  readonly expectedLitres: number;
  readonly flagged: number;
  readonly flaggedVehicles: number;
  readonly excessLitres: number;
  readonly exposureRupees: number;
  readonly fleetKmPerLitre: number | null;
}

export interface FuelAudit {
  readonly dates: readonly string[];
  readonly summary: FuelAuditSummary;
  /** Flagged journeys, most excess first. */
  readonly flagged: readonly JourneyAudit[];
  /** Every audited vehicle by registration, for the drill-down. */
  readonly vehicles: ReadonlyMap<string, VehicleFuelHistory>;
  /** Litres and kilometres per audit date, for the trend. */
  readonly daily: readonly { readonly date: string; readonly distanceKm: number; readonly fuelLitres: number; readonly excessLitres: number }[];
}

/** The audit of a set of buses over the window. */
export function auditFleet(buses: readonly Pick<FleetBus, 'registration' | 'depotId' | 'routeName' | 'state'>[], operatingDate: string): FuelAudit {
  const dates = auditDates(operatingDate);
  const vehicles = new Map<string, VehicleFuelHistory>();
  const flagged: JourneyAudit[] = [];
  const byDate = new Map(dates.map((d) => [d, { distanceKm: 0, fuelLitres: 0, excessLitres: 0 }]));
  let journeys = 0;
  let distanceKm = 0;
  let fuelLitres = 0;
  let expectedLitres = 0;
  let excessLitres = 0;
  let exposureRupees = 0;
  let flaggedVehicles = 0;
  for (const bus of buses) {
    const history = auditVehicle(bus, operatingDate);
    vehicles.set(bus.registration, history);
    let any = false;
    for (const j of history.journeys) {
      journeys += 1;
      distanceKm += j.distanceKm;
      fuelLitres += j.fuelLitres;
      expectedLitres += j.expectedLitres;
      const day = byDate.get(j.date);
      if (day) {
        day.distanceKm += j.distanceKm;
        day.fuelLitres += j.fuelLitres;
      }
      if (j.flagged) {
        any = true;
        flagged.push(j);
        excessLitres += j.excessLitres;
        exposureRupees += j.exposureRupees;
        if (day) day.excessLitres += j.excessLitres;
      }
    }
    if (any) flaggedVehicles += 1;
  }
  flagged.sort((a, b) => b.excessLitres - a.excessLitres || a.id.localeCompare(b.id));
  return {
    dates,
    summary: {
      vehicles: buses.length,
      journeys,
      distanceKm,
      fuelLitres: round1(fuelLitres),
      expectedLitres: round1(expectedLitres),
      flagged: flagged.length,
      flaggedVehicles,
      excessLitres: round1(excessLitres),
      exposureRupees,
      fleetKmPerLitre: fuelLitres > 0 ? round2(distanceKm / fuelLitres) : null,
    },
    flagged,
    vehicles,
    daily: dates.map((date) => {
      const d = byDate.get(date)!;
      return { date, distanceKm: d.distanceKm, fuelLitres: round1(d.fuelLitres), excessLitres: round1(d.excessLitres) };
    }),
  };
}
