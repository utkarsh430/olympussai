import type { CrewRole, CrewSlot, RoleShortfall, ShortfallCause } from '../crew/types';
import { MAX_HOURS_PER_WEEK } from '../crew/types';
import { compareText } from '../stats/order';
import { MINUTES_PER_HOUR } from '../units';
import { DAILY_LIMIT_MIN } from './config';
import type { ScheduleCrew, ScheduleCrewAssignment, ScheduleShift } from './types';

/*
 * Stage D2: the fewest crew. Shifts are chained into slot-days (a slot can
 * work consecutive shifts within the daily limit; the chain that ended
 * latest takes the next shift), then each chain is given the lowest free
 * slot of each role within the weekly limit. A shift is booked only when
 * both roles are covered. Slots are anonymous ids and hours; nothing else.
 */

const ROLES: readonly CrewRole[] = ['driver', 'conductor'];
const TENTHS = 10;

/** Slot ids order by length then text so `D-999` precedes `D-1000`. */
const byId = (a: CrewSlot, b: CrewSlot): number => a.id.length - b.id.length || compareText(a.id, b.id);
const byShift = (a: ScheduleShift, b: ScheduleShift): number => a.startMin - b.startMin || compareText(a.id, b.id);
const minutesOf = (s: ScheduleShift): number => s.endMin - s.startMin;

interface Chain {
  readonly id: string;
  readonly shifts: readonly ScheduleShift[];
  readonly minutes: number;
}

function chainsOf(shifts: readonly ScheduleShift[]): Chain[] {
  const open: { shifts: ScheduleShift[]; end: number; minutes: number }[] = [];
  for (const shift of [...shifts].sort(byShift)) {
    let best = -1;
    open.forEach((chain, i) => {
      const fits = chain.end <= shift.startMin && chain.minutes + minutesOf(shift) <= DAILY_LIMIT_MIN;
      if (fits && (best === -1 || chain.end > (open[best] as { end: number }).end)) best = i;
    });
    if (best === -1) open.push({ shifts: [shift], end: shift.endMin, minutes: minutesOf(shift) });
    else {
      const chain = open[best] as { shifts: ScheduleShift[]; end: number; minutes: number };
      chain.shifts.push(shift);
      chain.end = shift.endMin;
      chain.minutes += minutesOf(shift);
    }
  }
  return open.map((chain, i) => ({ id: `C${String(i).padStart(3, '0')}`, shifts: chain.shifts, minutes: chain.minutes }));
}

function lowerBoundOf(shifts: readonly ScheduleShift[]): number {
  const events = shifts.flatMap((s) => [{ at: s.startMin, d: 1 }, { at: s.endMin, d: -1 }]).sort((a, b) => a.at - b.at || a.d - b.d);
  let alive = 0;
  let most = 0;
  for (const e of events) {
    alive += e.d;
    most = Math.max(most, alive);
  }
  return Math.max(most, Math.ceil(shifts.reduce((sum, s) => sum + minutesOf(s), 0) / DAILY_LIMIT_MIN));
}

type Pick = { readonly slot: string } | { readonly cause: ShortfallCause };

function pickSlot(pool: readonly CrewSlot[], booked: ReadonlySet<string>, chainMinutes: number): Pick {
  if (pool.length === 0) return { cause: 'no_slot_available' };
  let refused = false;
  for (const slot of pool) {
    if (booked.has(slot.id)) continue;
    if (slot.hoursThisWeek + chainMinutes / MINUTES_PER_HOUR > MAX_HOURS_PER_WEEK) {
      refused = true;
      continue;
    }
    return { slot: slot.id };
  }
  return { cause: refused ? 'hours_limit' : 'all_rostered' };
}

/** Covers the shifts from the pool, `unavailable` slots per role set aside (the highest ids first). */
export function coverShifts(
  shifts: readonly ScheduleShift[],
  pool: readonly CrewSlot[],
  unavailable: Readonly<Record<CrewRole, number>>,
  blocksNeedingRelief: number,
): ScheduleCrew {
  const slotsOf = (role: CrewRole): CrewSlot[] => {
    const all = pool.filter((s) => s.role === role && s.availability === 'available').sort(byId);
    return all.slice(0, Math.max(0, all.length - unavailable[role]));
  };
  const pools: Record<CrewRole, readonly CrewSlot[]> = { driver: slotsOf('driver'), conductor: slotsOf('conductor') };
  const booked: Record<CrewRole, Set<string>> = { driver: new Set(), conductor: new Set() };
  const chains = chainsOf(shifts);
  const assignments: ScheduleCrewAssignment[] = [];
  for (const chain of chains) {
    const picks = ROLES.map((role) => [role, pickSlot(pools[role], booked[role], chain.minutes)] as const);
    const shortfalls: RoleShortfall[] = picks.flatMap(([role, pick]) => ('cause' in pick ? [{ role, cause: pick.cause }] : []));
    const covered = shortfalls.length === 0;
    if (covered) picks.forEach(([role, pick]) => 'slot' in pick && booked[role].add(pick.slot));
    const slotOf = (role: CrewRole): string | null => {
      const pick = picks.find(([r]) => r === role)?.[1];
      return covered && pick !== undefined && 'slot' in pick ? pick.slot : null;
    };
    for (const shift of chain.shifts) {
      assignments.push({ ...shift, chainId: chain.id, driverSlot: slotOf('driver'), conductorSlot: slotOf('conductor'), shortfalls });
    }
  }
  assignments.sort(byShift);
  const coveredMinutes = assignments.filter((a) => a.shortfalls.length === 0).reduce((sum, a) => sum + minutesOf(a), 0);
  const hours = Math.round((coveredMinutes / MINUTES_PER_HOUR) * TENTHS) / TENTHS;
  const uncovered = (role: CrewRole): number => assignments.filter((a) => a.shortfalls.some((s) => s.role === role)).length;
  return {
    shifts: assignments,
    chains: chains.length,
    chainLowerBound: lowerBoundOf(shifts),
    slotsUsed: { driver: booked.driver.size, conductor: booked.conductor.size },
    hoursByRole: { driver: hours, conductor: hours },
    available: { driver: pools.driver.length, conductor: pools.conductor.length },
    uncoveredByRole: { driver: uncovered('driver'), conductor: uncovered('conductor') },
    blocksNeedingRelief,
  };
}
