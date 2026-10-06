import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from '../units';

const HH_MM = /^(\d{2}):(\d{2})$/;
const LAST_HOUR = 23;

/** Minutes past midnight of an `HH:MM` feed time, or null when it is missing or malformed. */
export function minuteOfDay(hhmm: string | null): number | null {
  if (hhmm === null) return null;
  const match = HH_MM.exec(hhmm);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > LAST_HOUR || minutes >= MINUTES_PER_HOUR) return null;
  return hours * MINUTES_PER_HOUR + minutes;
}

/** The hour (0 to 23) an `HH:MM` feed time falls in, or null. */
export function hourOf(hhmm: string | null): number | null {
  const minute = minuteOfDay(hhmm);
  return minute === null ? null : Math.floor(minute / MINUTES_PER_HOUR);
}

/** Minutes from a start to an end time, across midnight when the end reads earlier. */
export function spanMinutes(start: string | null, end: string | null): number | null {
  const from = minuteOfDay(start);
  const to = minuteOfDay(end);
  if (from === null || to === null) return null;
  return to >= from ? to - from : to + MINUTES_PER_DAY - from;
}

/** `HH:00` for an hour of the day. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
