import type { Duty } from '../duties/types';
import { MAX_DUTY_HOURS_PER_DAY, MAX_HOURS_PER_WEEK } from './types';
import type {
  CrewAssignment,
  CrewAvailability,
  CrewRole,
  CrewSlot,
  CrewSummary,
  UncoveredReason,
} from './types';

const MINUTES_PER_HOUR = 60;
const AVAILABILITIES: readonly CrewAvailability[] = [
  'available',
  'weekly_off',
  'leave',
  'training',
  'absent',
];

/** Duties already booked to a slot today. Rebuilt, never mutated, on each booking. */
type Booked = ReadonlyMap<string, readonly Duty[]>;

type Pick =
  | { readonly kind: 'slot'; readonly id: string }
  | { readonly kind: 'none'; readonly hoursRefused: boolean };

const hoursOf = (duty: Duty): number => Math.max(0, duty.endMin - duty.startMin) / MINUTES_PER_HOUR;
const overlaps = (a: Duty, b: Duty): boolean => a.startMin < b.endMin && b.startMin < a.endMin;

/** Slot ids order by length then text so `D-999` precedes `D-1000`. */
const byId = (a: { readonly id: string }, b: { readonly id: string }): number =>
  a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const byStartThenId = (a: Duty, b: Duty): number =>
  a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The lowest-id free slot of a role that stays within both limits, noting any refused by hours. */
function pickSlot(slots: readonly CrewSlot[], booked: Booked, duty: Duty): Pick {
  let hoursRefused = false;
  for (const slot of slots) {
    const today = booked.get(slot.id) ?? [];
    if (today.some((other) => overlaps(other, duty))) continue;
    const dayHours = today.reduce((sum, other) => sum + hoursOf(other), 0) + hoursOf(duty);
    const withinDay = dayHours <= MAX_DUTY_HOURS_PER_DAY;
    const withinWeek = slot.hoursThisWeek + dayHours <= MAX_HOURS_PER_WEEK;
    if (withinDay && withinWeek) return { kind: 'slot', id: slot.id };
    hoursRefused = true;
  }
  return { kind: 'none', hoursRefused };
}

function book(booked: Booked, ids: readonly string[], duty: Duty): Booked {
  const next = new Map(booked);
  for (const id of ids) next.set(id, [...(booked.get(id) ?? []), duty]);
  return next;
}

function countBy<K extends string>(keys: readonly K[], values: readonly K[]): Record<K, number> {
  return Object.fromEntries(
    keys.map((key) => [key, values.filter((value) => value === key).length]),
  ) as Record<K, number>;
}

function uncovered(dutyId: string, reason: UncoveredReason): CrewAssignment {
  return { dutyId, driverSlot: null, conductorSlot: null, uncoveredReason: reason };
}

/**
 * Covers each duty with one available driver and one available conductor.
 * Duties go in start order (then id); each takes the lowest-id slot of each
 * role that is free then and stays within the daily and weekly hour limits, so
 * the result does not depend on input order. A duty short of either role is
 * uncovered and books nobody. Its reason is `hours_limit` when a free slot
 * was refused only by an hours limit (always so for a duty longer than the
 * daily limit), otherwise `no_available_crew`. Pure: inputs are not changed.
 */
export function rosterCrew(duties: readonly Duty[], crew: readonly CrewSlot[]): CrewSummary {
  const pools: Record<CrewRole, readonly CrewSlot[]> = {
    driver: crew.filter((s) => s.role === 'driver' && s.availability === 'available').sort(byId),
    conductor: crew
      .filter((s) => s.role === 'conductor' && s.availability === 'available')
      .sort(byId),
  };
  let booked: Booked = new Map();
  const assignments: CrewAssignment[] = [];
  let overLimit = 0;

  for (const duty of [...duties].sort(byStartThenId)) {
    if (hoursOf(duty) > MAX_DUTY_HOURS_PER_DAY) {
      overLimit += 1;
      assignments.push(uncovered(duty.id, 'hours_limit'));
      continue;
    }
    const driver = pickSlot(pools.driver, booked, duty);
    const conductor = pickSlot(pools.conductor, booked, duty);
    if (driver.kind === 'slot' && conductor.kind === 'slot') {
      booked = book(booked, [driver.id, conductor.id], duty);
      assignments.push({
        dutyId: duty.id,
        driverSlot: driver.id,
        conductorSlot: conductor.id,
        uncoveredReason: null,
      });
      continue;
    }
    const refused = [driver, conductor].some((p) => p.kind === 'none' && p.hoursRefused);
    assignments.push(uncovered(duty.id, refused ? 'hours_limit' : 'no_available_crew'));
  }

  const uncoveredDuties = assignments.filter((a) => a.uncoveredReason !== null).length;
  return {
    required: { driver: duties.length, conductor: duties.length },
    available: { driver: pools.driver.length, conductor: pools.conductor.length },
    byAvailability: countBy(
      AVAILABILITIES,
      crew.map((s) => s.availability),
    ),
    uncoveredDuties,
    assignedDuties: assignments.length - uncoveredDuties,
    dutiesOverDailyLimit: overLimit,
    assignments,
  };
}
