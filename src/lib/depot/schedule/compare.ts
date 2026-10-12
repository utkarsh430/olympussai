import { TENTH } from '../units';
import type { ResourceFigures, ScheduleComparison } from './types';

const tenth = (n: number): number => Math.round(n * TENTH) / TENTH;

/** Baseline minus schedule: positive means the schedule frees that much. */
export function compareFigures(baseline: ResourceFigures, schedule: ResourceFigures): ScheduleComparison {
  return {
    busesFreed: baseline.buses - schedule.buses,
    crewSlotsFreed: {
      driver: baseline.crewSlots.driver - schedule.crewSlots.driver,
      conductor: baseline.crewSlots.conductor - schedule.crewSlots.conductor,
    },
    crewHoursFreed: {
      driver: tenth(baseline.crewHours.driver - schedule.crewHours.driver),
      conductor: tenth(baseline.crewHours.conductor - schedule.crewHours.conductor),
    },
    uncoveredBusHoursChange: schedule.uncoveredBusHours - baseline.uncoveredBusHours,
    deadKmChange:
      baseline.deadKm.value === null || schedule.deadKm.value === null
        ? null
        : tenth(schedule.deadKm.value - baseline.deadKm.value),
  };
}
