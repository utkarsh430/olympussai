/**
 * Wording of the error panel shown when a depot page has no data at all. The
 * body says what happened and when, in plain words, and never repeats the
 * title or passes on server detail.
 */

export const LOAD_ERROR_TITLE = 'Could not load depot data';

/**
 * @param at the local HH:MM when the failure was seen
 * @param lastGood the HH:MM of the last good data, or null when there is none
 */
export function loadErrorBody(at: string, lastGood: string | null): string {
  return [
    `The depot network service did not answer at ${at}.`,
    'Nothing is shown until it answers.',
    `Last good data: ${lastGood ?? 'none'}.`,
  ].join(' ');
}
