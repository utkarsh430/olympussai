import { MAX_QUESTION_CHARS } from '@/lib/depot/copilot/limits';
import { INVISIBLE_CHARACTERS } from '@/lib/depot/copilot/unsafeText';

/** Re-exported: the one list shared with the core's fact sanitiser (see unsafeText.ts). */
export { INVISIBLE_CHARACTERS };

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
