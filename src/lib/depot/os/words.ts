import { formatPlainDate } from '../format';

/**
 * Short forms the OS views print instead of raw identifiers: the module never shows a
 * YYYY-MM-DD date, so a day reads "7 Oct" and a duty reads by its number, not its dated id.
 */

/** "7 Oct" for a YYYY-MM-DD date; a dash when it is not one. */
export function shortDate(date: string): string {
  return formatPlainDate(date).replace(/ \d{4}$/, '');
}

/** "Duty 003" for a duty id such as `73-2026-10-18-003`; the id itself when it has no number. */
export function dutyLabel(dutyId: string): string {
  const match = /-(\d+)$/.exec(dutyId);
  return match ? `Duty ${match[1]}` : dutyId;
}
