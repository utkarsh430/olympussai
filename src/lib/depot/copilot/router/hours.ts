/**
 * The hour a question asks about, read off its words on the feed clock: "10am", "10 am",
 * "10:00", "6 pm", "18:00", "midnight", "noon", or a bare hour after a time preposition
 * ("short at 10"). A part of the day ("this evening") stands for the first hour of its
 * hour band, so the answer covers that band. Null when no hour is named: the router never
 * guesses one, and the wall clock is never read.
 */

import { serviceBand } from '@/lib/depot/service/networkHours';

const HOURS_PER_HALF_DAY = 12;
const LAST_HOUR = 23;
const MINUTES_PER_HOUR = 60;

/**
 * The first hour of each band a part of the day names: the morning peak, midday, the evening
 * peak and late, as the network view's bands (`SERVICE_BANDS`) draw them.
 */
export const PART_OF_DAY_HOUR: Readonly<Record<string, number>> = {
  morning: serviceBand('morning_peak').fromHour,
  afternoon: serviceBand('midday').fromHour,
  evening: serviceBand('evening_peak').fromHour,
  night: serviceBand('late').fromHour,
  tonight: serviceBand('late').fromHour,
};

const MIDNIGHT = /\bmidnight\b/;
const NOON = /\b(noon|midday)\b/;
const TWELVE_HOUR = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/;
const TWENTY_FOUR_HOUR = /\b(\d{1,2}):(\d{2})\b/;
/** A bare hour after a time preposition, not followed by a noun that makes it a count. */
const BARE_HOUR =
  /\b(?:at|by|around|after|before|from|until|till)\s(\d{1,2})\b(?![:.]\d|\s?(?:buses|bus|routes?|depots?|%))/;
const PART_OF_DAY = /\b(morning|afternoon|evening|night|tonight)\b/;

function twelveHour(hour: number, half: string): number | null {
  if (hour < 1 || hour > HOURS_PER_HALF_DAY) return null;
  const base = hour % HOURS_PER_HALF_DAY;
  return half === 'pm' ? base + HOURS_PER_HALF_DAY : base;
}

/** The hour named by a clock time or a bare hour; null when none, or one is out of range. */
function clockHour(text: string): number | null {
  const twelve = TWELVE_HOUR.exec(text);
  if (twelve) {
    const minutes = twelve[2] === undefined ? 0 : Number(twelve[2]);
    if (minutes >= MINUTES_PER_HOUR) return null;
    return twelveHour(Number(twelve[1]), twelve[3] ?? 'am');
  }
  const clock = TWENTY_FOUR_HOUR.exec(text);
  if (clock) {
    const hour = Number(clock[1]);
    return hour <= LAST_HOUR && Number(clock[2]) < MINUTES_PER_HOUR ? hour : null;
  }
  const bare = BARE_HOUR.exec(text);
  if (bare) {
    const hour = Number(bare[1]);
    return hour <= LAST_HOUR ? hour : null;
  }
  return null;
}

/** The hour of the day a lower-cased, sanitised question names, or null. */
export function hourOf(text: string): number | null {
  if (MIDNIGHT.test(text)) return 0;
  if (NOON.test(text)) return HOURS_PER_HALF_DAY;
  const clock = clockHour(text);
  if (clock !== null) return clock;
  const part = PART_OF_DAY.exec(text)?.[1];
  return part === undefined ? null : (PART_OF_DAY_HOUR[part] ?? null);
}
