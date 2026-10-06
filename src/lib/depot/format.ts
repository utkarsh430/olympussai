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
