import { DESCRIPTIVE_WORDS } from '@/lib/depot/copilot/vocabulary/describe';
import { DOMAIN_WORDS } from '@/lib/depot/copilot/vocabulary/domain';
import {
  EXCLUDED_QUANTITY_WORDS,
  EXCLUDED_WORDS,
  isRomanNumeral,
} from '@/lib/depot/copilot/vocabulary/excluded';
import { FUNCTION_WORDS } from '@/lib/depot/copilot/vocabulary/function';
import { VERBS } from '@/lib/depot/copilot/vocabulary/verbs';

/**
 * Ruling S26: a list of forbidden words can never be complete, but a list of
 * allowed words cannot contain a quantity by construction. This is the closed
 * list of words model-written prose may use.
 */
export const VOCABULARY_WORDS: readonly string[] = [
  ...new Set([...FUNCTION_WORDS, ...VERBS, ...DESCRIPTIVE_WORDS, ...DOMAIN_WORDS]),
].sort();

/** Regular endings a listed word of MIN_STEM_LETTERS or more plain letters may take. */
export const REGULAR_ENDINGS: readonly string[] = ['s', 'es', 'd', 'ed', 'ing', 'ly'];
/** Short function words take no ending ("on" + "es" must never be a word). */
export const MIN_STEM_LETTERS = 3;

const LISTED: ReadonlySet<string> = new Set(VOCABULARY_WORDS);
const EXCLUDED: ReadonlySet<string> = new Set(EXCLUDED_WORDS);
const PLAIN = /^[a-z]+$/;

/** Excluded outright: a listed quantity, unit or link word, a Roman numeral, a lone letter. */
export function isExcludedWord(lower: string): boolean {
  return EXCLUDED.has(lower) || isRomanNumeral(lower) || (lower.length === 1 && lower !== 'a');
}

const isStem = (stem: string): boolean =>
  stem.length >= MIN_STEM_LETTERS && PLAIN.test(stem) && LISTED.has(stem);

/** The listed words an inflected form could come from: plain ending, dropped "e", "y" to "i". */
function stemsOf(lower: string): readonly string[] {
  const plain = REGULAR_ENDINGS.filter((e) => lower.endsWith(e)).map((e) =>
    lower.slice(0, lower.length - e.length),
  );
  const droppedE = lower.endsWith('ing') ? [`${lower.slice(0, -3)}e`] : [];
  const yToI = /ie[sd]$/.test(lower) ? [`${lower.slice(0, -3)}y`] : [];
  return [...plain, ...droppedE, ...yToI];
}

const QUANTITY: ReadonlySet<string> = new Set(EXCLUDED_QUANTITY_WORDS);

/** What a form reduces to: each regular ending removed, and a final "es" turned into "s". */
export function reductionsOf(lower: string): readonly string[] {
  const esToS = lower.endsWith('es') ? [`${lower.slice(0, -2)}s`] : [];
  return [...stemsOf(lower), ...esToS];
}

/** True when the word, or anything it reduces to, is in the set ("nightly" for "night"). */
export function reducesToAny(lower: string, set: ReadonlySet<string>): boolean {
  return set.has(lower) || reductionsOf(lower).some((reduced) => set.has(reduced));
}

/**
 * True when a lowercase token is in the vocabulary: a listed form (which may
 * hold a hyphen or apostrophe), or a listed word with one regular ending. The
 * excluded list is checked first, and a built form is refused when it reduces
 * to an excluded quantity word, so no ending can rebuild one ("day" + "es").
 */
export function isVocabularyWord(lower: string): boolean {
  if (isExcludedWord(lower)) return false;
  if (LISTED.has(lower)) return true;
  if (!PLAIN.test(lower) || !stemsOf(lower).some(isStem)) return false;
  return !reductionsOf(lower).some((reduced) => QUANTITY.has(reduced));
}
