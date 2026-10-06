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

function spanWords(ms: number): string {
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)} h`;
  const days = Math.floor(ms / DAY_MS);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * How far a feed timestamp lies from the feed's own clock: "12 min ago", "3 h ago",
 * "2 days ago", "in 25 min", and "just now" within a minute either way. Both stamps are
 * read as wall-clock digits, so the browser's clock and zone never enter it. Put the
 * full time (`formatFeedDateTime`) in `title` beside it.
 */
export function formatRelative(iso: string | null, feedNow: string | null): string {
  const stamp = readFeedStamp(iso);
  const now = readFeedStamp(feedNow);
  if (!stamp || !now) return DASH;
  const delta = now.ms - stamp.ms;
  if (Math.abs(delta) < MINUTE_MS) return 'just now';
  return delta > 0 ? `${spanWords(delta)} ago` : `in ${spanWords(-delta)}`;
}

/** True when feed stamp `a` is strictly later than feed stamp `b`; false if either does not parse. */
export function isLaterFeedTime(a: string | null, b: string | null): boolean {
  const left = readFeedStamp(a);
  const right = readFeedStamp(b);
  return left !== null && right !== null && left.ms > right.ms;
}
