import type { Duty } from '../duties/types';
import { MAX_DUTY_HOURS_PER_DAY, MAX_HOURS_PER_WEEK } from './types';
import type {
  CrewAssignment,
  CrewAvailability,
  CrewRole,
  CrewShift,
  CrewShifts,
  CrewSlot,
  CrewSummary,
  UncoveredReason,
} from './types';

const MINUTES_PER_HOUR = 60;
const DAILY_LIMIT_MIN = MAX_DUTY_HOURS_PER_DAY * MINUTES_PER_HOUR;
const ROLES: readonly CrewRole[] = ['driver', 'conductor'];
const AVAILABILITIES: readonly CrewAvailability[] = [
  'available',
  'weekly_off',
  'leave',
  'training',
  'absent',
];

/** Shifts already booked to a slot today. Rebuilt, never mutated, on each booking. */
type Booked = ReadonlyMap<string, readonly CrewShift[]>;

type SlotPick =
  | { readonly kind: 'slot'; readonly id: string }
  | { readonly kind: 'none'; readonly hoursRefused: boolean };

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const minutesOf = (shift: CrewShift): number => shift.endMin - shift.startMin;
const overlaps = (a: CrewShift, b: CrewShift): boolean =>
  a.startMin < b.endMin && b.startMin < a.endMin;

/** Slot ids order by length then text so `D-999` precedes `D-1000`. */
const byId = (a: { readonly id: string }, b: { readonly id: string }): number =>
  a.id.length - b.id.length || compareText(a.id, b.id);

const byShiftOrder = (a: CrewShift, b: CrewShift): number =>
  a.startMin - b.startMin || compareText(a.dutyId, b.dutyId) || a.shiftIndex - b.shiftIndex;

function shiftsOfDuty(duty: Duty): readonly CrewShift[] {
  const length = duty.endMin - duty.startMin;
  const shiftCount = Math.ceil(length / DAILY_LIMIT_MIN);
  // Whole-minute equal shifts; the last takes the remainder (never longer than the others).
  const each = Math.ceil(length / shiftCount);
  return Array.from({ length: shiftCount }, (_, shiftIndex) => {
    const startMin = duty.startMin + shiftIndex * each;
    const endMin = shiftIndex === shiftCount - 1 ? duty.endMin : startMin + each;
    return { dutyId: duty.id, shiftIndex, shiftCount, startMin, endMin };
  });
}

/**
 * Turns duties into crew shifts. A crew member may work only the daily limit,
 * so a longer bus duty is relieved: it is cut into the fewest consecutive,
 * equal whole-minute shifts that each fit the limit. A duty whose end is at or
 * before its start is not a duty and is reported, not rostered.
 */
export function crewShiftsFor(duties: readonly Duty[]): CrewShifts {
  const valid = duties.filter((duty) => duty.endMin > duty.startMin);
  const invalidDutyIds = duties
    .filter((duty) => duty.endMin <= duty.startMin)
    .map((duty) => duty.id)
    .sort(compareText);
  const shifts = valid.flatMap(shiftsOfDuty).sort(byShiftOrder);
  return {
    shifts,
    dutiesNeedingRelief: valid.filter((d) => d.endMin - d.startMin > DAILY_LIMIT_MIN).length,
    invalidDutyIds,
  };
}

/** The lowest-id free slot of a role that stays within both limits, noting any refused by hours. */
function pickSlot(slots: readonly CrewSlot[], booked: Booked, shift: CrewShift): SlotPick {
  let hoursRefused = false;
  for (const slot of slots) {
    const today = booked.get(slot.id) ?? [];
    if (today.some((other) => overlaps(other, shift))) continue;
    const dayMinutes = today.reduce((sum, other) => sum + minutesOf(other), 0) + minutesOf(shift);
    const dayHours = dayMinutes / MINUTES_PER_HOUR;
    const withinDay = dayHours <= MAX_DUTY_HOURS_PER_DAY;
    const withinWeek = slot.hoursThisWeek + dayHours <= MAX_HOURS_PER_WEEK;
    if (withinDay && withinWeek) return { kind: 'slot', id: slot.id };
    hoursRefused = true;
  }
  return { kind: 'none', hoursRefused };
}

function book(booked: Booked, ids: readonly string[], shift: CrewShift): Booked {
  const next = new Map(booked);
  for (const id of ids) next.set(id, [...(booked.get(id) ?? []), shift]);
  return next;
}

function countBy<K extends string>(keys: readonly K[], values: readonly K[]): Record<K, number> {
  return Object.fromEntries(
    keys.map((key) => [key, values.filter((value) => value === key).length]),
  ) as Record<K, number>;
}

function uncoveredReason(picks: readonly SlotPick[]): UncoveredReason {
  const short = picks.filter((pick) => pick.kind === 'none');
  return short.every((pick) => pick.hoursRefused) ? 'hours_limit' : 'no_available_crew';
}

/** Duties by how many of their shifts are covered. */
function dutyCoverage(
  assignments: readonly CrewAssignment[],
): Pick<CrewSummary, 'dutiesFullyCovered' | 'dutiesPartlyCovered' | 'dutiesUncovered'> {
  const covered = new Map<string, { total: number; done: number }>();
  for (const a of assignments) {
    const entry = covered.get(a.dutyId) ?? { total: a.shiftCount, done: 0 };
    covered.set(a.dutyId, { total: entry.total, done: entry.done + (a.driverSlot ? 1 : 0) });
  }
  const entries = [...covered.values()];
  return {
    dutiesFullyCovered: entries.filter((e) => e.done === e.total).length,
    dutiesPartlyCovered: entries.filter((e) => e.done > 0 && e.done < e.total).length,
    dutiesUncovered: entries.filter((e) => e.done === 0).length,
  };
}

/**
 * Covers each duty's shifts with one available driver and one available
 * conductor per shift. Greedy, earliest shift first, lowest slot id first: it
 * is not an optimal cover, so a smarter matching might cover more. A shift
 * takes the first slot of each role that is free then and stays within the
 * daily and weekly hour limits, so the result does not depend on input order.
 * A shift short of either role is uncovered and books nobody. Back-to-back
 * shifts on one slot have no rest gap in this model. Pure: inputs unchanged.
 */
export function rosterCrew(duties: readonly Duty[], crew: readonly CrewSlot[]): CrewSummary {
  const { shifts, dutiesNeedingRelief, invalidDutyIds } = crewShiftsFor(duties);
  const available = (role: CrewRole): readonly CrewSlot[] =>
    crew.filter((s) => s.role === role && s.availability === 'available').sort(byId);
  const pools: Record<CrewRole, readonly CrewSlot[]> = {
    driver: available('driver'),
    conductor: available('conductor'),
  };
  let booked: Booked = new Map();
  const assignments: CrewAssignment[] = [];

  for (const shift of shifts) {
    const picks = ROLES.map((role) => pickSlot(pools[role], booked, shift));
    const [driver, conductor] = picks;
    if (driver?.kind === 'slot' && conductor?.kind === 'slot') {
      booked = book(booked, [driver.id, conductor.id], shift);
      assignments.push({
        ...shift,
        driverSlot: driver.id,
        conductorSlot: conductor.id,
        uncoveredReason: null,
        shortRoles: [],
      });
    } else {
      assignments.push({
        ...shift,
        driverSlot: null,
        conductorSlot: null,
        uncoveredReason: uncoveredReason(picks),
        shortRoles: ROLES.filter((_, i) => picks[i]?.kind === 'none'),
      });
    }
  }

  const uncovered = assignments.filter((a) => a.uncoveredReason !== null);
  return {
    required: { driver: shifts.length, conductor: shifts.length },
    available: { driver: pools.driver.length, conductor: pools.conductor.length },
    byAvailability: countBy(
      AVAILABILITIES,
      crew.map((s) => s.availability),
    ),
    shiftsRequired: shifts.length,
    shiftsCovered: shifts.length - uncovered.length,
    shiftsUncovered: uncovered.length,
    uncoveredByRole: {
      driver: uncovered.filter((a) => a.shortRoles.includes('driver')).length,
      conductor: uncovered.filter((a) => a.shortRoles.includes('conductor')).length,
    },
    ...dutyCoverage(assignments),
    dutiesNeedingRelief,
    invalidDutyIds,
    assignments,
  };
}
