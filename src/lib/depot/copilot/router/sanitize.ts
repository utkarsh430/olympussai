import { MAX_QUESTION_CHARS } from '@/lib/depot/copilot/limits';

// C0/C1 controls, zero-width characters, bidirectional embeddings, isolates and
// marks, and the BOM. Written as escaped strings so no invisible character is
// ever stored in this file. Whitespace (including tab and newline) is turned
// into a space first, so it is not removed here.
const INVISIBLE = new RegExp(
  '[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]',
  'g',
);

/**
 * Makes untrusted text safe to treat as a plain line of data: no control or
 * invisible characters, single spaces, bounded length. Anything that is not a
 * string becomes the empty string.
 */
export function sanitizeQuestion(input: unknown): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.replace(/\s+/g, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ');
  // Array.from counts code points, so the cap never splits a surrogate pair.
  return Array.from(cleaned.trim()).slice(0, MAX_QUESTION_CHARS).join('').trim();
}
