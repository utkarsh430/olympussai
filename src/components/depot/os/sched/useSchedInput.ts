'use client';

import { useMemo } from 'react';
import { shiftDate } from '@/lib/depot/os/intel/fuelAudit';
import { classCounts, schedBusesOf } from '@/lib/depot/os/sched/input';
import { buildTimetable } from '@/lib/depot/os/sched/timetable';
import type { SchedBus, Timetable } from '@/lib/depot/os/sched/types';
import type { DepotSummary } from '@/lib/depot/types';
import { useIntel } from '../IntelProvider';

/** Crew shifts a depot's roster is sized for, per schedulable bus: a two-shift day for most buses. */
export const CREW_SHIFTS_PER_BUS = 1.5;

export interface SchedInput {
  readonly depot: DepotSummary | null;
  readonly buses: readonly SchedBus[];
  readonly timetable: Timetable | null;
  /** The operating date and the next two, for the date choice. */
  readonly dates: readonly string[];
  /** Shifts the depot's crew strength is sized for. */
  readonly crewShiftHint: number;
}

/**
 * The scheduling engine's input for one depot from the OS's shared reads: the depot's
 * buses from the GPS roster with their health, and its timetable for the chosen date.
 * Every scheduler page and the copilot build it the same way, so they plan the same day.
 */
export function useSchedInput(depotId: string, date: string | null): SchedInput {
  const intel = useIntel();
  const depot = intel.depotsById.get(depotId) ?? null;
  const buses = useMemo(() => (intel.fleet ? schedBusesOf(intel.fleet, intel.healthByReg, depotId) : []), [intel.fleet, intel.healthByReg, depotId]);
  const dates = useMemo(() => (intel.operatingDate ? [0, 1, 2].map((d) => shiftDate(intel.operatingDate!, -d)) : []), [intel.operatingDate]);
  const chosen = date && dates.includes(date) ? date : (dates[0] ?? null);
  // Plain keys stand for the depot, its neighbours and its bus classes, so a poll that
  // changes nothing they hold does not rebuild the day.
  const depotKey = depot ? JSON.stringify({ id: depot.id, name: depot.name, centroid: depot.centroid ?? null }) : null;
  const allDepots = intel.network?.depots;
  const neighbourKey = useMemo(
    () => (allDepots && depot ? JSON.stringify(allDepots.filter((d) => d.kind === 'depot' && d.id !== depot.id).map((d) => ({ name: d.name, centroid: d.centroid ?? null }))) : null),
    [allDepots, depot],
  );
  const counts = useMemo(() => JSON.stringify(classCounts(buses)), [buses]);
  const timetable = useMemo(() => {
    if (!depotKey || !neighbourKey || !chosen || counts === '{}') return null;
    return buildTimetable({
      depot: JSON.parse(depotKey) as Parameters<typeof buildTimetable>[0]['depot'],
      neighbours: JSON.parse(neighbourKey) as Parameters<typeof buildTimetable>[0]['neighbours'],
      busesByClass: JSON.parse(counts) as ReturnType<typeof classCounts>,
      operatingDate: chosen,
    });
  }, [depotKey, neighbourKey, chosen, counts]);
  const schedulable = buses.filter((b) => b.state !== 'off_road').length;
  return { depot, buses, timetable, dates, crewShiftHint: Math.round(schedulable * CREW_SHIFTS_PER_BUS) };
}
