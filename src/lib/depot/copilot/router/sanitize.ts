import { MAX_QUESTION_CHARS } from '@/lib/depot/copilot/limits';

/**
 * Every character that can hide text from a reader or reorder it: control (Cc),
 * format (Cf: bidi, zero-width, soft hyphen, tag block), private-use (Co),
 * unassigned (Cn) and surrogate (Cs) characters, plus invisible fillers that
 * are letters or marks to Unicode (Hangul and Braille fillers, the combining
 * grapheme joiner, Khmer inherent vowels, Mongolian vowel separator) and the
 * variation selectors. Written with escapes so no invisible character is
 * stored in this file. Shareable with the core.
 */
export const INVISIBLE_CHARACTERS = new RegExp(
  '[\\p{Cc}\\p{Cf}\\p{Co}\\p{Cn}\\p{Cs}\\u3164\\u1160\\u2800\\u034f\\u17b4\\u17b5\\u180e\\ufe00-\\ufe0f]',
  'gu',
);

/**
 * Makes untrusted text safe to treat as a plain line of data: NFKC, single
 * spaces (so a newline becomes a space), no control or invisible characters,
 * bounded length. Anything that is not a string becomes the empty string.
 */
export function sanitizeQuestion(input: unknown): string {
  if (typeof input !== 'string') return '';
  const cleaned = input
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Array.from counts code points, so the cap never splits a surrogate pair.
  return Array.from(cleaned).slice(0, MAX_QUESTION_CHARS).join('').trim();
}
