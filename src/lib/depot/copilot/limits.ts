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

/** The documented fact id pattern; ids are checked before they reach a prompt or a draft. */
export const FACT_ID_SOURCE = '[a-z0-9][a-z0-9_.-]{0,63}';
export const FACT_ID_PATTERN = new RegExp(`^${FACT_ID_SOURCE}$`);

/** Token grammar (grammar.ts enforces it, cli/prompt.ts states it). */
export const WORD_OPENERS: readonly string[] = ['(', '"'];
export const WORD_CLOSERS: readonly string[] = [')', '"'];
/** At most one of these may end a token. */
export const TRAILING_MARKS: readonly string[] = ['.', ',', ';', ':'];
/** Two placeholders may sit side by side with this mark unless their digits would fuse. */
export const NAME_LIST_MARK = ',';
/** Two placeholders may always sit side by side with this mark: it reads only as a list. */
export const VALUE_LIST_MARK = ';';
/** Any other two placeholders need a word of at least this many letters between them. */
export const MIN_JOINING_WORD_LETTERS = 2;

/** Combining marks kept per base character in fact text; more are dropped. */
export const MAX_COMBINING_MARKS = 4;
/** The system prompt travels as one argument; it must stay under this many bytes. */
export const MAX_SYSTEM_PROMPT_BYTES = 24_576;

/** An all-capitals word of two or more of these letters reads as a Roman numeral. */
export const ROMAN_NUMERAL_LETTERS = 'IVXLCDM';

/** Endings matched after every quantity word ("fours", "tenths", "twofold"); no "d" ("tend"). */
export const QUANTITY_SUFFIXES: readonly string[] = ['s', 'es', 'ed', 'th', 'ths', 'fold'];

/**
 * The last net behind the closed vocabulary (lastNet.ts): base words that
 * would smuggle a quantity, each also matched with every QUANTITY_SUFFIXES
 * ending. Vague quantifiers that state no figure (most, several) are not here.
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
  'lac',
  'trio',
  'dual',
  'quintuple',
  'quintupled',
  'decade',
  'fortnight',
  'umpteen',
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
