import type { VehicleHealth } from './vehicleHealth';

/**
 * Repair-bay scheduling: the depot's workshop bays (its master record) filled day by day
 * with the buses that most need them — first those past their service by the most, then
 * the highest breakdown risk. A routine service takes one bay-day; a bus with a recurring
 * fault takes two. The plan shows how many buses each day keeps off the road.
 */

export const PLAN_DAYS = 7;
const RECURRING_DAYS = 2;

export interface BaySlot {
  readonly registration: string;
  readonly reason: 'overdue' | 'risk' | 'due_soon';
  /** First day of the job, 0 = tomorrow. */
  readonly day: number;
  readonly days: number;
}

export interface BayPlan {
  readonly bays: number;
  /** grid[day][bay]: the bus in that bay that day, or null when free. */
  readonly grid: readonly (readonly (string | null)[])[];
  readonly jobs: readonly BaySlot[];
  /** Buses needing a bay that the week cannot fit. */
  readonly unscheduled: number;
  /** Buses kept off the road by the plan on each day. */
  readonly offRoadByDay: readonly number[];
}

function priority(h: VehicleHealth): number {
  if (h.service.group === 'overdue') return 1_000_000 - h.service.kmToNextService;
  if (h.band === 'high') return 500_000 + h.risk * 100;
  if (h.service.group === 'due_soon') return 100_000 - h.service.kmToNextService;
  return 0;
}

export function planBays(health: readonly VehicleHealth[], bays: number): BayPlan {
  const queue = health
    .filter((h) => h.state !== 'off_road' && (h.service.group !== 'not_due' || h.band === 'high'))
    .sort((a, b) => priority(b) - priority(a) || a.registration.localeCompare(b.registration));
  const grid: (string | null)[][] = Array.from({ length: PLAN_DAYS }, () => Array.from({ length: bays }, () => null));
  const jobs: BaySlot[] = [];
  let unscheduled = 0;
  for (const h of queue) {
    const days = h.recurring !== null ? RECURRING_DAYS : 1;
    let placed = false;
    for (let day = 0; day + days <= PLAN_DAYS && !placed; day += 1) {
      for (let bay = 0; bay < bays && !placed; bay += 1) {
        let free = true;
        for (let d = day; d < day + days; d += 1) if (grid[d]![bay] !== null) free = false;
        if (!free) continue;
        for (let d = day; d < day + days; d += 1) grid[d]![bay] = h.registration;
        jobs.push({
          registration: h.registration,
          reason: h.service.group === 'overdue' ? 'overdue' : h.band === 'high' ? 'risk' : 'due_soon',
          day,
          days,
        });
        placed = true;
      }
    }
    if (!placed) unscheduled += 1;
  }
  return {
    bays,
    grid,
    jobs,
    unscheduled,
    offRoadByDay: grid.map((row) => row.filter((cell) => cell !== null).length),
  };
}
