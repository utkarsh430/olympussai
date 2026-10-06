import { SeededRandom } from '../../simulation/seededRandom';
import { MAX_HOURS_PER_WEEK } from '../crew/types';
import type { CrewAvailability, CrewRole, CrewSlot } from '../crew/types';
import type { DepotSummary } from '../types';
import { seedFor } from './seed';

/*
 * Strength is a multiple of the duty count because one person works one duty a
 * day and roughly a quarter of the roster is off, on leave, training or absent
 * on any day (the shares below). A ratio near 1 / (1 - unavailable share)
 * leaves a depot just about covered on an average day, with real shortfalls on
 * bad ones. Conductors run slightly leaner than drivers.
 */
export const CREW_PER_DUTY: Readonly<Record<CrewRole, number>> = {
  driver: 1.45,
  conductor: 1.4,
};

/** Seeded share of slots in each non-available state; the rest are available. */
export const ABSENCE_SHARES: Readonly<Record<Exclude<CrewAvailability, 'available'>, number>> = {
  weekly_off: 0.14, // one rest day in seven
  leave: 0.06,
  training: 0.03,
  absent: 0.04,
};

/** Hours already worked this week, drawn within the weekly limit and leaving room for a shift. */
export const HOURS_THIS_WEEK_RANGE = { min: 8, max: MAX_HOURS_PER_WEEK } as const;
const HOURS_STEP = 0.5;

const ROLE_LETTER: Readonly<Record<CrewRole, string>> = { driver: 'D', conductor: 'C' };
const ID_DIGITS = 3;
const ROLES: readonly CrewRole[] = ['driver', 'conductor'];
const ABSENCE_ORDER = ['weekly_off', 'leave', 'training', 'absent'] as const;

function slotId(role: CrewRole, number: number): string {
  return `${ROLE_LETTER[role]}-${String(number).padStart(ID_DIGITS, '0')}`;
}

function drawAvailability(rng: SeededRandom): CrewAvailability {
  const draw = rng.float(0, 1);
  let upTo = 0;
  for (const state of ABSENCE_ORDER) {
    upTo += ABSENCE_SHARES[state];
    if (draw < upTo) return state;
  }
  return 'available';
}

function drawHours(rng: SeededRandom): number {
  const steps = (HOURS_THIS_WEEK_RANGE.max - HOURS_THIS_WEEK_RANGE.min) / HOURS_STEP;
  return HOURS_THIS_WEEK_RANGE.min + rng.int(0, steps) * HOURS_STEP;
}

/**
 * The depot's modelled crew for one operating date. Strength and slot ids
 * depend on the depot and duty count only; the absence mix and hours depend on
 * the date too. Slots are anonymous: availability and hours, nothing else.
 */
export function modelCrew(
  depot: DepotSummary,
  dutyCount: number,
  operatingDate: string,
): CrewSlot[] {
  if (!Number.isInteger(dutyCount) || dutyCount < 0) {
    throw new RangeError(`dutyCount must be a non-negative integer, got ${dutyCount}`);
  }
  const rng = new SeededRandom(seedFor(depot.id, operatingDate, 'crew'));
  const crew: CrewSlot[] = [];
  for (const role of ROLES) {
    const strength = Math.max(dutyCount, Math.ceil(dutyCount * CREW_PER_DUTY[role]));
    for (let number = 1; number <= strength; number += 1) {
      // Both draws are always taken so the stream stays aligned.
      const availability = drawAvailability(rng);
      const hoursThisWeek = drawHours(rng);
      crew.push({ id: slotId(role, number), role, availability, hoursThisWeek });
    }
  }
  return crew;
}
