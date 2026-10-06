import { formatNumber } from '@/lib/formatters';

const DASH = '—';
const FEED_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;

/** Whole-number count with the Indian digit grouping used across the app. */
export function formatCount(n: number): string {
  return formatNumber(n);
}

/** `n` as a whole-number percentage of `of`; a dash when there is no population. */
export function formatShare(n: number, of: number): string {
  if (of === 0) return DASH;
  return `${Math.round((n / of) * 100)}%`;
}

/**
 * The HH:MM written in the feed's own timestamp.
 *
 * Upstream stamps wall-clock (IST) times with a misleading `Z`; converting to a
 * zone would shift them by five and a half hours, so the digits are read as-is.
 */
export function formatFeedTime(iso: string | null): string {
  if (!iso) return DASH;
  const match = FEED_TIME_PATTERN.exec(iso);
  if (!match) return DASH;
  const [, hour, minute] = match;
  if (Number(hour) > MAX_HOUR || Number(minute) > MAX_MINUTE) return DASH;
  return `${hour}:${minute}`;
}

/** A local clock time as HH:MM on a 24-hour clock, for "when did this happen". */
export function formatClockTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const IST_CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
});

/**
 * A true instant (an ISO time this browser or the server stamped, not a feed stamp) as
 * HH:MM in Indian time on a 24-hour clock, whatever the browser's own zone and locale,
 * so it reads beside the feed's clock. A dash if it does not parse.
 */
export function formatInstantIst(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? DASH : IST_CLOCK.format(date);
}

const PLAIN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * A plain calendar date (YYYY-MM-DD) as "7 Oct 2026". Read from the digits alone,
 * never through a Date, so no time zone can move it a day. Anything that is not a
 * real date gives a dash.
 */
export function formatPlainDate(date: string): string {
  const match = PLAIN_DATE_PATTERN.exec(date);
  if (!match) return DASH;
  const [, year, month, day] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];
  const dayNumber = Number(day);
  if (monthName === undefined || dayNumber < 1 || dayNumber > 31) return DASH;
  return `${dayNumber} ${monthName} ${year}`;
}

const FEED_STAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface FeedStamp {
  /** The wall-clock digits placed on the UTC axis: only for arithmetic and the weekday. */
  readonly ms: number;
  readonly day: string;
  readonly month: string;
  readonly time: string;
  readonly weekday: string;
}

/**
 * The feed's timestamp read from its digits alone (the upstream quirk `formatFeedTime`
 * documents: a trailing `Z` on a wall-clock IST time is ignored). The digits sit on the
 * UTC axis only so two feed stamps can be subtracted and a weekday found; no zone
 * conversion ever happens. Null for anything that is not a real date and time.
 */
function readFeedStamp(iso: string | null): FeedStamp | null {
  const match = iso ? FEED_STAMP_PATTERN.exec(iso) : null;
  if (!match) return null;
  const [, y = '', mo = '', d = '', h = '', mi = '', s = '0'] = match;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (hour > MAX_HOUR || minute > MAX_MINUTE) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(ms);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const monthName = MONTH_NAMES[month - 1];
  const weekday = WEEKDAY_NAMES[check.getUTCDay()];
  if (monthName === undefined || weekday === undefined) return null;
  return { ms, day: d, month: monthName, time: `${h}:${mi}`, weekday };
}

/** A feed timestamp as "Mon 05 Oct, 08:51" (Indian wall-clock time); a dash if it does not parse. */
export function formatFeedDateTime(iso: string | null): string {
  const stamp = readFeedStamp(iso);
  return stamp ? `${stamp.weekday} ${stamp.day} ${stamp.month}, ${stamp.time}` : DASH;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A feed timestamp as a clock time beside the feed's own clock: "19:45" when it falls on
 * the feed's day, "5 Oct, 19:45" when it falls on another day (a bus last heard
 * yesterday evening must not read as a time later than now). When the feed's clock does
 * not parse, the day is always given. A dash if the stamp itself does not parse.
 */
export function formatFeedTimeOn(iso: string | null, feedNow: string | null): string {
  const stamp = readFeedStamp(iso);
  if (!stamp) return DASH;
  const now = readFeedStamp(feedNow);
  const sameDay = now !== null && Math.floor(now.ms / DAY_MS) === Math.floor(stamp.ms / DAY_MS);
  return sameDay ? stamp.time : `${Number(stamp.day)} ${stamp.month}, ${stamp.time}`;
}

/** True when feed stamp `a` is strictly later than feed stamp `b`; false if either does not parse. */
export function isLaterFeedTime(a: string | null, b: string | null): boolean {
  const left = readFeedStamp(a);
  const right = readFeedStamp(b);
  return left !== null && right !== null && left.ms > right.ms;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/**
 * A length of time given in minutes, in the largest two units that matter: "47 min",
 * "3 h 12 min", "13 d 21 h". Never raw minutes above an hour, and a zero second part is
 * dropped ("1 h", "1 d"). A dash for anything that is not a duration.
 */
export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) {
    return DASH;
  }
  const whole = Math.floor(minutes);
  if (whole < MINUTES_PER_HOUR) return `${whole} min`;
  if (whole < MINUTES_PER_DAY) {
    const hours = Math.floor(whole / MINUTES_PER_HOUR);
    const rest = whole % MINUTES_PER_HOUR;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  const days = Math.floor(whole / MINUTES_PER_DAY);
  const hours = Math.floor((whole % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  return hours === 0 ? `${days} d` : `${days} d ${hours} h`;
}
