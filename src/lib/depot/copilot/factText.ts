import { MAX_COMBINING_MARKS, MAX_FACT_TEXT_CHARS } from '@/lib/depot/copilot/limits';
import type { FactEdges } from '@/lib/depot/copilot/grammar';
import { INVISIBLE_CHARACTERS } from '@/lib/depot/copilot/unsafeText';

/** No figure or depot name needs these; full-width forms normalise into them under NFKC. */
const MARKUP_CHARS = /[<>`{}[\]]/g;

/** A run of combining marks longer than the cap: stacked marks can bury or imitate text. */
const EXCESS_MARKS = new RegExp(`(\\p{M}{${MAX_COMBINING_MARKS}})\\p{M}+`, 'gu');

/**
 * Makes feed-derived text safe to show or prompt with: NFKC, whitespace
 * collapsed first (so a newline becomes a space), then every character in the
 * shared INVISIBLE_CHARACTERS list and the markup characters removed, combining
 * marks capped at MAX_COMBINING_MARKS per base character, then capped by code
 * point at a word boundary with an ellipsis inside the cap, never splitting a
 * surrogate pair or a base character from its marks.
 */
export function sanitizeFactText(text: string, maxChars: number = MAX_FACT_TEXT_CHARS): string {
  const cleaned = text
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(MARKUP_CHARS, '')
    .replace(EXCESS_MARKS, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(cleaned);
  if (chars.length <= maxChars) return cleaned;
  let end = maxChars - 1; // room for the ellipsis
  while (end > 0 && /\p{M}/u.test(chars[end] ?? '')) end -= 1; // keep a base with its marks
  const lastSpace = chars.slice(0, end).lastIndexOf(' ');
  if (lastSpace > 0) end = lastSpace;
  return `${chars.slice(0, end).join('').trimEnd()}…`;
}

/** The last space-separated part is only digits, grouping marks or a dash (or empty). */
const BARE_END = /(?:^|\s)[\p{N}.,\u2014-]*$/u;

/**
 * Figure or name, decided from the fact itself (the fact type has no field for
 * it): a fact whose text holds a numeric character in any script is a FIGURE,
 * and so is one with no letter at all (a lone dash stands for a missing
 * figure); otherwise it is a NAME. The grammar needs only the two edges: a
 * value that ends in a bare number ("3", "1,204", "4 of 12") may not be
 * followed by a comma and another figure, while one that ends in its own unit
 * or mark ("31 buses", "71%", "14:05") or is a name may.
 */
export function factEdges(text: string): FactEdges {
  const clean = sanitizeFactText(text);
  return { endsBare: BARE_END.test(clean), startsWithLetter: /^\p{L}/u.test(clean) };
}
