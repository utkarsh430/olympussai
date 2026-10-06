export const MAX_HEADLINE_CHARS = 120;
export const MAX_PARAGRAPHS = 6;
export const MAX_PARAGRAPH_CHARS = 600;
export const MAX_QUESTION_CHARS = 300;

/**
 * Words that smuggle a quantity past the digit check. "one" is allowed on
 * purpose: it is ordinary prose ("one depot stands out") and carries no figure
 * that could be wrong.
 */
export const QUANTITY_WORDS: readonly string[] = [
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
  'dozen',
  'hundred',
  'thousand',
  'lakh',
  'crore',
  'million',
  'percent',
  'per cent',
  'half',
  'third',
  'quarter',
  'double',
  'twice',
  'triple',
];
