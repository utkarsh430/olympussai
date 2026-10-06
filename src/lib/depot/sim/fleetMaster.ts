import { SeededRandom } from '../../simulation/seededRandom';
import {
  MAX_BUS_AGE_YEARS,
  ROUTE_TOKEN_CLASS,
  SEATS_BY_CLASS,
  SERVICE_CLASS_PROPORTIONS,
  STATIC_SEED_DATE,
} from './config';
import { seedFor } from './seed';
import type { ModelledBus, ServiceClass } from './types';

/** First whole underscore-separated token of the route name that names a class. */
function classFromRoute(routeName: string | null): ServiceClass | null {
  if (routeName === null) return null;
  for (const token of routeName.toUpperCase().split('_')) {
    const found = ROUTE_TOKEN_CLASS[token];
    if (found !== undefined) return found;
  }
  return null;
}

function sampleClass(rng: SeededRandom): ServiceClass {
  const draw = rng.float(0, 1);
  let cumulative = 0;
  for (const [serviceClass, share] of SERVICE_CLASS_PROPORTIONS) {
    cumulative += share;
    if (draw < cumulative) return serviceClass;
  }
  return 'ordinary';
}

/** Class, age and seats for one bus, stable per registration. */
export function modelBus(registrationNumber: string, routeName: string | null): ModelledBus {
  const rng = new SeededRandom(seedFor(registrationNumber, STATIC_SEED_DATE, 'fleet-master'));
  // Draw in a fixed order so a route token never shifts the age stream.
  const sampled = sampleClass(rng);
  const ageYears = rng.int(0, MAX_BUS_AGE_YEARS);
  const serviceClass = classFromRoute(routeName) ?? sampled;
  return { registrationNumber, serviceClass, ageYears, seats: SEATS_BY_CLASS[serviceClass] };
}
