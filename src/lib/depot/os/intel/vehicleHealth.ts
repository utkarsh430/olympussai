import { SeededRandom } from '../../../simulation/seededRandom';
import { ANNUAL_KM_BY_CLASS } from '../../maintenance/config';
import { modelService, type ModelledService } from '../../maintenance/serviceModel';
import { STATIC_SEED_DATE } from '../../sim/config';
import { modelBus } from '../../sim/fleetMaster';
import { seedFor } from '../../sim/seed';
import type { BusOpState } from '../../types';
import type { FleetBus } from '../fleetIndex';

/**
 * Predictive maintenance for one bus. Its class, age, odometer and service position are
 * the Maintenance page's own (`modelBus` and `modelService` on the same registration and
 * route), so a bus overdue here is overdue there. Its repair history is a scenario record
 * set seeded by registration. The risk index is a points score whose every point is
 * listed, not a probability: no failure data exists yet to calibrate one.
 */

export type FaultSystem = 'brakes' | 'electrical' | 'cooling' | 'transmission' | 'suspension' | 'tyres' | 'fuel_system' | 'air_conditioning';

export const FAULT_LABEL: Readonly<Record<FaultSystem, string>> = {
  brakes: 'Brakes',
  electrical: 'Electrical',
  cooling: 'Engine cooling',
  transmission: 'Transmission',
  suspension: 'Suspension',
  tyres: 'Tyres',
  fuel_system: 'Fuel system',
  air_conditioning: 'Air conditioning',
};

const SYSTEMS: readonly FaultSystem[] = [
  'brakes',
  'electrical',
  'cooling',
  'transmission',
  'suspension',
  'tyres',
  'fuel_system',
];

export interface RepairEvent {
  /** Days before the operating date. */
  readonly daysAgo: number;
  readonly system: FaultSystem;
  readonly offRoadDays: number;
}

export interface RiskFactor {
  readonly label: string;
  readonly points: number;
}

export type RiskBand = 'high' | 'elevated' | 'normal';

export interface VehicleHealth {
  readonly registration: string;
  readonly depotId: string | null;
  readonly state: BusOpState;
  readonly routeName: string | null;
  readonly service: ModelledService;
  readonly repairs: readonly RepairEvent[];
  /** A system repaired twice or more in the last 180 days, or null. */
  readonly recurring: FaultSystem | null;
  readonly risk: number;
  readonly band: RiskBand;
  readonly factors: readonly RiskFactor[];
  /** Days until the next service at the class's daily distance; negative when past due. */
  readonly serviceDueInDays: number;
}

const HISTORY_DAYS = 365;
const RECURRENCE_WINDOW_DAYS = 180;
const DAYS_PER_YEAR = 365;
export const RISK_BANDS = { high: 50, elevated: 32 } as const;

/** Points per factor; a bus's index is their sum, capped at 100. */
const POINTS = {
  overduePer1000Km: 6,
  overdueMax: 36,
  dueSoon: 8,
  agePerYearOver6: 3,
  ageMax: 18,
  recurring: 22,
  repairsPerEvent: 3,
  repairsMax: 12,
  dark: 6,
} as const;

function repairsOf(registration: string, ageYears: number): RepairEvent[] {
  const rng = new SeededRandom(seedFor(registration, STATIC_SEED_DATE, 'repair-history'));
  // Older buses come in more often: up to one unplanned visit a year when new, more with age.
  const visits = rng.int(0, 1) + Math.floor(ageYears / 4);
  // A small share of the fleet has one system that keeps coming back.
  const weakSystem = rng.bool(0.06) ? rng.pick(SYSTEMS) : null;
  const events: RepairEvent[] = [];
  for (let i = 0; i < visits; i += 1) {
    const system = weakSystem !== null && rng.bool(0.6) ? weakSystem : rng.pick(SYSTEMS);
    events.push({ daysAgo: rng.int(3, HISTORY_DAYS), system, offRoadDays: rng.int(1, 5) });
  }
  return events.sort((a, b) => a.daysAgo - b.daysAgo);
}

function recurringOf(repairs: readonly RepairEvent[]): FaultSystem | null {
  const counts = new Map<FaultSystem, number>();
  for (const r of repairs) {
    if (r.daysAgo > RECURRENCE_WINDOW_DAYS) continue;
    counts.set(r.system, (counts.get(r.system) ?? 0) + 1);
  }
  let best: { system: FaultSystem; n: number } | null = null;
  for (const [system, n] of counts) {
    if (n >= 2 && (!best || n > best.n)) best = { system, n };
  }
  return best?.system ?? null;
}

export function bandOf(risk: number): RiskBand {
  if (risk >= RISK_BANDS.high) return 'high';
  return risk >= RISK_BANDS.elevated ? 'elevated' : 'normal';
}

/** The class's daily distance, from its annual figure. */
function dailyKm(service: ModelledService): number {
  return ANNUAL_KM_BY_CLASS[service.serviceClass] / DAYS_PER_YEAR;
}

export function vehicleHealth(bus: Pick<FleetBus, 'registration' | 'depotId' | 'state' | 'routeName'>): VehicleHealth {
  const modelled = modelBus(bus.registration, bus.routeName);
  const service = modelService(modelled);
  const repairs = repairsOf(bus.registration, modelled.ageYears);
  const recurring = recurringOf(repairs);
  const factors: RiskFactor[] = [];

  if (service.kmToNextService < 0) {
    const points = Math.min(POINTS.overdueMax, Math.ceil(-service.kmToNextService / 1000) * POINTS.overduePer1000Km);
    factors.push({ label: `Service overdue by ${Math.round(-service.kmToNextService).toLocaleString('en-IN')} km`, points });
  } else if (service.group === 'due_soon') {
    factors.push({ label: `Service due within ${Math.round(service.kmToNextService).toLocaleString('en-IN')} km`, points: POINTS.dueSoon });
  }
  if (modelled.ageYears > 6) {
    factors.push({
      label: `${modelled.ageYears} years in service`,
      points: Math.min(POINTS.ageMax, (modelled.ageYears - 6) * POINTS.agePerYearOver6),
    });
  }
  if (recurring !== null) {
    factors.push({ label: `${FAULT_LABEL[recurring]} repaired twice or more in 180 days`, points: POINTS.recurring });
  }
  const recent = repairs.filter((r) => r.daysAgo <= RECURRENCE_WINDOW_DAYS).length;
  if (recent > 0) {
    factors.push({
      label: `${recent} workshop visit${recent === 1 ? '' : 's'} in 180 days`,
      points: Math.min(POINTS.repairsMax, recent * POINTS.repairsPerEvent),
    });
  }
  if (bus.state === 'dark') {
    factors.push({ label: 'No GPS signal: condition unverified', points: POINTS.dark });
  }
  const risk = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  return {
    registration: bus.registration,
    depotId: bus.depotId,
    state: bus.state,
    routeName: bus.routeName,
    service,
    repairs,
    recurring,
    risk,
    band: bandOf(risk),
    factors: factors.sort((a, b) => b.points - a.points),
    serviceDueInDays: Math.round(service.kmToNextService / dailyKm(service)),
  };
}

export interface HealthSummary {
  readonly buses: number;
  readonly operational: number;
  readonly offRoad: number;
  readonly overdue: number;
  readonly dueSoon: number;
  readonly highRisk: number;
  readonly elevatedRisk: number;
  /** High-risk buses on the road now. */
  readonly highRiskOnRoad: number;
  readonly recurring: number;
  /** Buses standing in the yard that could replace one taken off. */
  readonly standbyCandidates: number;
}

const ON_ROAD: ReadonlySet<BusOpState> = new Set(['in_service', 'on_road']);

export function summariseHealth(health: readonly VehicleHealth[]): HealthSummary {
  let operational = 0;
  let offRoad = 0;
  let overdue = 0;
  let dueSoon = 0;
  let highRisk = 0;
  let elevatedRisk = 0;
  let highRiskOnRoad = 0;
  let recurring = 0;
  let standbyCandidates = 0;
  for (const h of health) {
    if (h.state === 'off_road') offRoad += 1;
    else operational += 1;
    if (h.service.group === 'overdue') overdue += 1;
    if (h.service.group === 'due_soon') dueSoon += 1;
    if (h.band === 'high') highRisk += 1;
    if (h.band === 'elevated') elevatedRisk += 1;
    if (h.band === 'high' && ON_ROAD.has(h.state)) highRiskOnRoad += 1;
    if (h.recurring !== null) recurring += 1;
    if (h.state === 'standing' && h.band === 'normal' && h.service.group !== 'overdue') standbyCandidates += 1;
  }
  return {
    buses: health.length,
    operational,
    offRoad,
    overdue,
    dueSoon,
    highRisk,
    elevatedRisk,
    highRiskOnRoad,
    recurring,
    standbyCandidates,
  };
}

export function isOnRoad(state: BusOpState): boolean {
  return ON_ROAD.has(state);
}
