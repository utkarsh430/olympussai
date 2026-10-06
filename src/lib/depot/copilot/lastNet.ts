import {
  QUANTITY_SUFFIXES,
  QUANTITY_WORDS,
  ROMAN_NUMERAL_LETTERS,
} from '@/lib/depot/copilot/limits';

/*
 * The last net behind the grammar and the closed vocabulary (ruling S26). A
 * list of forbidden words can never be complete, so nothing relies on this
 * file alone; it catches a quantity word that a future vocabulary edit lets in.
 */

const QUANTITY = new RegExp(
  `\\b(?:${QUANTITY_WORDS.map((w) => w.replace(/\s+/g, '\\s+')).join('|')})` +
    `(?:${QUANTITY_SUFFIXES.join('|')})?\\b`,
  'i',
);
const ROMAN_NUMERAL = new RegExp(`\\b[${ROMAN_NUMERAL_LETTERS}]{2,}\\b`);
const LINK = /www\.|:\/\/|mailto|javascript|[A-Za-z]\.[A-Za-z]/i;
const NUMBER_STEMS = [...new Set([...QUANTITY_WORDS.filter((w) => !w.includes(' ')), 'one'])];

/** True when a lowercase word is made only of number-word stems (at least one not "one"). */
function isStemChain(word: string): boolean {
  const reach = Array.from({ length: word.length + 1 }, (_unused, i) => i === 0);
  for (let i = 1; i <= word.length; i += 1) {
    reach[i] = NUMBER_STEMS.some(
      (s) => s.length <= i && reach[i - s.length] === true && word.endsWith(s, i),
    );
  }
  return reach[word.length] === true && word.replace(/one/g, '') !== '';
}

/** A run-together number in any case, with or without a quantity ending ("Twentyfourth"). */
function isConcatenatedNumber(word: string): boolean {
  const lower = word.toLowerCase();
  const stripped = QUANTITY_SUFFIXES.filter((s) => lower.endsWith(s)).map((s) =>
    lower.slice(0, lower.length - s.length),
  );
  return [lower, ...stripped].some(isStemChain);
}

/**
 * `bare` is the text with placeholders removed; `lettered` has each
 * placeholder replaced by a letter so a suffix such as "{{fact:x}}.com" shows.
 */
export function lastNetProblem(bare: string, lettered: string): string | null {
  if (QUANTITY.test(bare)) return 'Draft contains a quantity word';
  if (ROMAN_NUMERAL.test(bare)) return 'Draft contains a roman numeral';
  if ((bare.match(/[A-Za-z]+/g) ?? []).some(isConcatenatedNumber)) {
    return 'Draft contains a concatenated number word (quantity)';
  }
  if (LINK.test(lettered)) return 'Draft contains a link or bare domain';
  return null;
}
