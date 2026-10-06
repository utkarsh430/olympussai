export const MAX_HEADLINE_CHARS = 120;
export const MAX_PARAGRAPHS = 6;
/**
 * What any provider may write: one paragraph fewer than the browser accepts, so
 * the server can always append its stale notice without the client refusing it.
 */
export const MAX_PROVIDER_PARAGRAPHS = MAX_PARAGRAPHS - 1;
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

/**
 * Ruling S38. Words that can act as a unit, a period or a rate: refused, in any
 * form the endings build, directly before or after a figure placeholder.
 */
export const FIGURE_UNIT_WORDS: readonly string[] =
  'day days week weeks month months year years daily weekly monthly yearly overnight night tonight time times season period unit units yard yards trip trips each every per apiece'.split(
    ' ',
  );
/** "3 buses a day": an article after a figure does not hide the unit word behind it. */
export const RATE_ARTICLES: readonly string[] = ['a', 'an'];
/** Negation and comparison: refused directly before a figure placeholder. */
export const FIGURE_QUALIFIER_WORDS: readonly string[] =
  'not no never nor cannot without than exactly almost nearly about around roughly over under above below beyond down up least most fewer less more'.split(
    ' ',
  );
/** A word ending like this ("isn't") is a negation too. */
export const NEGATIVE_CONTRACTION = "n't";
/**
 * Linking words. When nothing but these stands between two figures the pair
 * reads as a range or a ratio ("3 to 5", "3 out of 5"), so only
 * FIGURE_JOINING_WORD alone is accepted there.
 */
export const FIGURE_LINK_WORDS: readonly string[] =
  'a an the and or nor but of to in on at by for from with within without into onto upon over under above below between among amid across along around about against through toward towards until till per than as like via out up down off each every any all some is are was were be'.split(
    ' ',
  );
export const FIGURE_JOINING_WORD = 'and';
/** One of these between a word and a figure ends the clause, so the two no longer touch. */
export const CLAUSE_BREAK_MARKS: readonly string[] = ['.', ';', ':'];
export const SENTENCE_END_MARK = '.';

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
