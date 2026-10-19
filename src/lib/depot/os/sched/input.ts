import { modelBus } from '../../sim/fleetMaster';
import type { ServiceClass } from '../../sim/types';
import type { FleetBus } from '../fleetIndex';
import type { VehicleHealth } from '../intel/vehicleHealth';
import type { SchedBus } from './types';

/*
 * The scheduling engine's buses from the OS's shared reads: every bus of the depot in
 * the GPS roster with its live state, and the class, risk and service position the
 * Fleet Health views show for it.
 */

export function schedBusesOf(fleet: readonly FleetBus[], healthByReg: ReadonlyMap<string, VehicleHealth>, depotId: string): SchedBus[] {
  return fleet
    .filter((b) => b.depotId === depotId)
    .map((b) => {
      const health = healthByReg.get(b.registration);
      return {
        registration: b.registration,
        serviceClass: health?.service.serviceClass ?? modelBus(b.registration, b.routeName).serviceClass,
        state: b.state,
        risk: health?.risk ?? 0,
        serviceDueInDays: health?.serviceDueInDays ?? Number.POSITIVE_INFINITY,
        restriction: null,
      };
    })
    .sort((a, b) => a.registration.localeCompare(b.registration));
}

export function classCounts(buses: readonly SchedBus[]): Partial<Record<ServiceClass, number>> {
  const out: Partial<Record<ServiceClass, number>> = {};
  for (const b of buses) out[b.serviceClass] = (out[b.serviceClass] ?? 0) + 1;
  return out;
}
