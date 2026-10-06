export const MAX_HEADLINE_CHARS = 120;
export const MAX_PARAGRAPHS = 6;
export const MAX_PARAGRAPH_CHARS = 600;
export const MAX_QUESTION_CHARS = 300;

/** Fact values and labels are server-written but may carry third-party feed strings. */
export const MAX_FACT_TEXT_CHARS = 120;
export const MAX_FACT_LABEL_CHARS = 80;
export const MAX_RENDERED_PARAGRAPH_CHARS = 2000;
export const MAX_RENDERED_HEADLINE_CHARS = 240;

/** Bounds on what is sent to the CLI. */
export const MAX_FACTS = 60;
export const MAX_PROMPT_BYTES = 32_768;

/*
 * The draft rules below are shared by the renderer (render.ts), which enforces
 * them, and the system prompt (cli/prompt.ts), which states them, so the two
 * cannot drift.
 */

/** Besides ASCII letters and the space, the only characters model prose may use. */
export const PROSE_PUNCTUATION: readonly string[] = ['.', ',', ';', ':', "'", '"', '(', ')', '-'];

/** Marks that would change a figure's sign or decimal place if put right before it. */
export const SIGN_MARKS: readonly string[] = ['-', '.', ','];

/** An all-capitals word of two or more of these letters reads as a Roman numeral. */
export const ROMAN_NUMERAL_LETTERS = 'IVXLCDM';

/** Endings matched after every quantity word ("fours", "tenths", "twofold"); no "d" ("tend"). */
export const QUANTITY_SUFFIXES: readonly string[] = ['s', 'es', 'ed', 'th', 'ths', 'fold'];

/**
 * Base words that smuggle a quantity past the digit check; each is also matched
 * with every QUANTITY_SUFFIXES ending. "one" is allowed on purpose: it is
 * ordinary prose ("one of the larger depots") and states no figure that could
 * be wrong.
 */
export const QUANTITY_WORDS: readonly string[] = [
  'zero',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'dozen',
  'score',
  'hundred',
  'thousand',
  'lakh',
  'crore',
  'million',
  'billion',
  'trillion',
  'couple',
  'pair',
  'both',
  'several',
  'majority',
  'minority',
  'most',
  'once',
  'twice',
  'thrice',
  'single',
  'double',
  'triple',
  'quadruple',
  'half',
  'halves',
  'halve',
  'third',
  'quarter',
  'fifth',
  'tenth',
  'eighth',
  'ninth',
  'percent',
  'percentage',
  'per cent',
  // Ordinals and words the suffix rule misses (no "d" suffix: it would reject "tend").
  'first',
  'second',
  'twelfth',
  'twentieth',
  'thirtieth',
  'fortieth',
  'fiftieth',
  'sixtieth',
  'seventieth',
  'eightieth',
  'ninetieth',
  'nil',
  'nought',
  'naught',
  'handful',
  'doubled',
  'tripled',
  'quadrupled',
  'halved',
];

/** Authored guidance is sanitised like fact text and capped at this many characters. */
export const MAX_GUIDANCE_CHARS = 600;
