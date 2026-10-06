import { SeededRandom } from '../../simulation/seededRandom';
import { STATIC_SEED_DATE } from '../sim/config';
import { seedFor } from '../sim/seed';
import type { ModelledBus, ServiceClass } from '../sim/types';
import {
  ANNUAL_KM_BY_CLASS,
  ANNUAL_KM_VARIATION,
  DISTANCE_STEP_KM,
  DUE_SOON_WITHIN_KM,
  SERVICE_INTERVAL_KM,
  SERVICE_SEED_SALT,
  SERVICE_WINDOW_RATIO,
} from './config';

export type ServiceGroup = 'overdue' | 'due_soon' | 'not_due';

export interface ModelledService {
  readonly registrationNumber: string;
  readonly serviceClass: ServiceClass;
  readonly ageYears: number;
  /** Modelled odometer, km. Not the feed's `distance`. */
  readonly odometerKm: number;
  readonly lastServiceKm: number;
  readonly intervalKm: number;
  /** Distance left to the next service; negative when it is past due. */
  readonly kmToNextService: number;
  readonly group: ServiceGroup;
}

const roundToStep = (km: number): number => Math.round(km / DISTANCE_STEP_KM) * DISTANCE_STEP_KM;

/** Overdue below zero, due soon up to the window, otherwise not due. */
export function serviceGroupOf(
  kmToNextService: number,
  dueSoonWithinKm: number = DUE_SOON_WITHIN_KM,
): ServiceGroup {
  if (kmToNextService < 0) return 'overdue';
  return kmToNextService <= dueSoonWithinKm ? 'due_soon' : 'not_due';
}

/**
 * A bus's odometer and service history, stable per registration. The odometer
 * is anchored on the modelled age (age years plus a fraction of a year, at the
 * class's annual distance with a per-bus spread). The last service cannot be
 * before the bus existed, so a new bus is never overdue.
 */
export function modelService(bus: Readonly<ModelledBus>): ModelledService {
  const rng = new SeededRandom(
    seedFor(bus.registrationNumber, STATIC_SEED_DATE, SERVICE_SEED_SALT),
  );
  // Fixed draw order keeps each figure's stream independent of the others.
  const spread = rng.float(ANNUAL_KM_VARIATION.min, ANNUAL_KM_VARIATION.max);
  const yearFraction = rng.float(0, 1);
  const intervalKm = SERVICE_INTERVAL_KM[bus.serviceClass];
  const sinceDrawn = rng.float(0, intervalKm * SERVICE_WINDOW_RATIO);

  const odometerKm = roundToStep(
    (Math.max(0, bus.ageYears) + yearFraction) * ANNUAL_KM_BY_CLASS[bus.serviceClass] * spread,
  );
  const sinceServiceKm = Math.min(roundToStep(sinceDrawn), odometerKm);
  const kmToNextService = intervalKm - sinceServiceKm;
  return {
    registrationNumber: bus.registrationNumber,
    serviceClass: bus.serviceClass,
    ageYears: bus.ageYears,
    odometerKm,
    lastServiceKm: odometerKm - sinceServiceKm,
    intervalKm,
    kmToNextService,
    group: serviceGroupOf(kmToNextService),
  };
}

export function countByGroup(
  services: readonly ModelledService[],
): Readonly<Record<ServiceGroup, number>> {
  const counts: Record<ServiceGroup, number> = { overdue: 0, due_soon: 0, not_due: 0 };
  for (const service of services) counts[service.group] += 1;
  return counts;
}

/** Soonest first (most overdue at the top), then registration; returns a new array. */
export function sortByUrgency(services: readonly ModelledService[]): ModelledService[] {
  return [...services].sort(
    (a, b) =>
      a.kmToNextService - b.kmToNextService ||
      (a.registrationNumber < b.registrationNumber ? -1 : 1),
  );
}
