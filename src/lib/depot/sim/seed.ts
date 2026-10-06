/**
 * Seeding helpers for the modelled world.
 *
 * Modelled figures must be repeatable: the same depot on the same operating
 * date always yields the same numbers. These helpers build the seed strings
 * that feed `SeededRandom`.
 */

const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

/** Pulls the leading YYYY-MM-DD out of a string, or null when it is not a real calendar date. */
function datePrefix(value: string): string | null {
  const prefix = ISO_DATE_PREFIX.exec(value)?.[1];
  if (prefix === undefined) return null;
  const time = Date.parse(`${prefix}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(prefix) ? prefix : null;
}

/**
 * The operating date: the date part of the feed's own clock when that clock
 * parses, otherwise of the fetch time. The date is read straight off the
 * string with no timezone conversion, because upstream stamps wall-clock
 * times with a misleading `Z` and converting would shift the day. Throws a
 * RangeError when neither string yields a valid date.
 */
export function operatingDateOf(feedNow: string | null, fetchedAt: string): string {
  if (feedNow !== null && !Number.isNaN(Date.parse(feedNow))) {
    const prefix = datePrefix(feedNow);
    if (prefix !== null) return prefix;
  }
  const fallback = datePrefix(fetchedAt);
  if (fallback === null) {
    throw new RangeError('Neither feedNow nor fetchedAt begins with a valid YYYY-MM-DD date');
  }
  return fallback;
}

/**
 * A stable seed string for one scope, date and purpose. The salt gives each
 * purpose (history shocks, weekly rhythm, fleet mix, ...) its own independent
 * stream. The separator keeps parts from bleeding into each other.
 */
export function seedFor(scopeKey: string, operatingDate: string, salt: string): string {
  return `${scopeKey.length}:${scopeKey}|${operatingDate.length}:${operatingDate}|${salt}`;
}
