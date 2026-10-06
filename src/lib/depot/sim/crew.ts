import { SeededRandom } from '../../simulation/seededRandom';
import { MAX_HOURS_PER_WEEK } from '../crew/types';
import type { CrewAvailability, CrewRole, CrewSlot } from '../crew/types';
import type { DepotSummary } from '../types';
import { seedFor } from './seed';

/*
 * Strength is a multiple of the crew shift count (not the duty count: a long
 * bus duty is relieved, so it needs more than one crew). About 27% of slots
 * are off, on leave, training or absent on any day (the shares below), so
 * 1.45 drivers per shift leaves about 1.06 available per shift. Shifts are
 * staggered through the day, so a slot can take two that do not overlap, and
 * measured over 28 dates a 40 to 150 shift depot is fully covered on most
 * dates and a few percent short (at most about 15%) on the rest, when many
 * shifts start together. Conductors run slightly leaner than drivers.
 */
export const CREW_PER_SHIFT: Readonly<Record<CrewRole, number>> = {
  driver: 1.45,
  conductor: 1.4,
};

/**
 * Slots every role gets on top of the ratio. With very few slots the absence
 * draw is a handful of coin flips, so a small depot looks badly short on a bad
 * date: an artefact of small numbers, not a finding about the depot. A depot
 * with no shifts models no crew at all.
 */
export const CREW_RESERVE_SLOTS = 2;

/** Seeded share of slots in each non-available state; the rest are available. */
export const ABSENCE_SHARES: Readonly<Record<Exclude<CrewAvailability, 'available'>, number>> = {
  weekly_off: 0.14, // one rest day in seven
  leave: 0.06,
  training: 0.03,
  absent: 0.04,
};

/** A typical shift, used to keep most slots able to take one this week. */
const TYPICAL_SHIFT_HOURS = 8;
/** Hours already worked this week: below the weekly limit by a typical shift, so most slots fit one. */
export const HOURS_THIS_WEEK_RANGE = {
  min: 8,
  max: MAX_HOURS_PER_WEEK - TYPICAL_SHIFT_HOURS,
} as const;
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
 * depend on the depot and shift count only; the absence mix and hours depend on
 * the date too. Slots are anonymous: availability and hours, nothing else.
 */
export function modelCrew(
  depot: DepotSummary,
  shiftCount: number,
  operatingDate: string,
): readonly CrewSlot[] {
  if (!Number.isInteger(shiftCount) || shiftCount < 0) {
    throw new RangeError(`shiftCount must be a non-negative integer, got ${shiftCount}`);
  }
  const rng = new SeededRandom(seedFor(depot.id, operatingDate, 'crew'));
  const crew: CrewSlot[] = [];
  for (const role of ROLES) {
    const strength =
      shiftCount === 0
        ? 0
        : Math.max(shiftCount, Math.ceil(shiftCount * CREW_PER_SHIFT[role])) + CREW_RESERVE_SLOTS;
    for (let number = 1; number <= strength; number += 1) {
      // Both draws are always taken so the stream stays aligned.
      const availability = drawAvailability(rng);
      const hoursThisWeek = drawHours(rng);
      crew.push({ id: slotId(role, number), role, availability, hoursThisWeek });
    }
  }
  return crew;
}
