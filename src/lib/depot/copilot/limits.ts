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

/**
 * Base words that smuggle a quantity past the digit check. Matching adds the
 * suffixes s, es, ed, d, th, ths and fold (see render.ts). "one" is allowed on
 * purpose: it is ordinary prose ("one of the larger depots") and states no
 * figure that could be wrong.
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
];
