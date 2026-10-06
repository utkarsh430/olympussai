import {
  FACT_ID_SOURCE,
  MIN_JOINING_WORD_LETTERS,
  NAME_LIST_MARK,
  TRAILING_MARKS,
  VALUE_LIST_MARK,
  WORD_CLOSERS,
  WORD_OPENERS,
} from '@/lib/depot/copilot/limits';
import { isVocabularyWord } from '@/lib/depot/copilot/vocabulary';

export type GrammarProblem = 'spacing' | 'token' | 'vocabulary' | 'joined_placeholders';

type Token =
  | { readonly kind: 'word'; readonly core: string }
  | { readonly kind: 'placeholder'; readonly id: string; readonly mark: string };

const inClass = (chars: readonly string[]): string =>
  chars.map((c) => c.replace(/[\\\]^-]/g, '\\$&')).join('');
const MARK = `[${inClass(TRAILING_MARKS)}]?`;

/** `(`? placeholder `)`? mark? and nothing else: no sign, point, percent, letter or quote. */
const PLACEHOLDER_TOKEN = new RegExp(`^\\(?\\{\\{fact:(${FACT_ID_SOURCE})\\}\\}\\)?(${MARK})$`);
/** opener? letters (with inner hyphens or apostrophes) closer? mark? */
const WORD_TOKEN = new RegExp(
  `^[${inClass(WORD_OPENERS)}]?([A-Za-z]+(?:['-][A-Za-z]+)*)[${inClass(WORD_CLOSERS)}]?${MARK}$`,
);
const POSSESSIVE = "'s";

/**
 * Server-authored wordings the scripted drafts in facts/ use although "one",
 * "ones" and "none" are not vocabulary words. They are accepted only as these
 * exact word sequences, so none of the three can be attached to anything else.
 */
export const AUTHORED_PHRASES: readonly (readonly string[])[] = [
  ['none', 'overdue', 'to', 'leave', 'the', 'yard'],
  ['none', 'on', 'vehicles'],
  ['at', 'least', 'one', 'of', 'these'],
  ['on', 'one', 'of', 'the', 'topics'],
  ['the', 'depot-level', 'ones'],
];

function parseToken(raw: string): Token | null {
  const placeholder = PLACEHOLDER_TOKEN.exec(raw);
  if (placeholder)
    return { kind: 'placeholder', id: placeholder[1] ?? '', mark: placeholder[2] ?? '' };
  const word = WORD_TOKEN.exec(raw);
  // Matching is case-insensitive on the whole token.
  return word ? { kind: 'word', core: (word[1] ?? '').toLowerCase() } : null;
}

const coreOf = (token: Token | undefined): string | null =>
  token?.kind === 'word' ? token.core : null;

function inAuthoredPhrase(tokens: readonly Token[], index: number): boolean {
  const core = coreOf(tokens[index]);
  return AUTHORED_PHRASES.some((phrase) =>
    phrase.some(
      (word, offset) =>
        word === core && phrase.every((w, k) => coreOf(tokens[index - offset + k]) === w),
    ),
  );
}

function knownWord(tokens: readonly Token[], index: number): boolean {
  const core = coreOf(tokens[index]) ?? '';
  if (isVocabularyWord(core)) return true;
  if (core.endsWith(POSSESSIVE) && isVocabularyWord(core.slice(0, -POSSESSIVE.length))) return true;
  return inAuthoredPhrase(tokens, index);
}

/** The two edges of a fact's rendered text that decide what may sit beside it. */
export interface FactEdges {
  /** Ends in a bare number or a dash: a comma after it could read as part of the figure. */
  readonly endsBare: boolean;
  readonly startsWithLetter: boolean;
}

/**
 * Two placeholders with no word of MIN_JOINING_WORD_LETTERS letters between
 * them would read as one figure ("3 5", "3, 5", "3 x 5", "3: 5"). Without such
 * a word they must sit side by side as a list: `; ` between any two values, or
 * `, ` unless the left value ends in a bare number and the right one does not
 * start with a letter ("Agra, Kanpur" and "7 depots, 31 buses" pass; "3, 5" fails).
 */
function joinedPlaceholders(tokens: readonly Token[], edgesOf: (id: string) => FactEdges): boolean {
  let previous: { readonly index: number; readonly id: string; readonly mark: string } | null =
    null;
  for (const [index, token] of tokens.entries()) {
    if (token.kind === 'word') {
      if (token.core.length >= MIN_JOINING_WORD_LETTERS) previous = null;
      continue;
    }
    if (previous !== null) {
      const fuses = edgesOf(previous.id).endsBare && !edgesOf(token.id).startsWithLetter;
      const listed =
        previous.index === index - 1 &&
        (previous.mark === VALUE_LIST_MARK || (previous.mark === NAME_LIST_MARK && !fuses));
      if (!listed) return true;
    }
    previous = { index, id: token.id, mark: token.mark };
  }
  return false;
}

/**
 * Checks one headline or paragraph against the token grammar and the closed
 * vocabulary. Tokens are separated by exactly one space; each is a word token
 * or a placeholder token. Returns the first problem as a fixed code, never
 * any text from the draft.
 */
export function checkGrammar(
  text: string,
  edgesOf: (id: string) => FactEdges,
): GrammarProblem | null {
  const raw = text.split(' ');
  if (raw.some((part) => part === '')) return 'spacing';
  const parsed = raw.map(parseToken);
  const tokens = parsed.filter((token): token is Token => token !== null);
  if (tokens.length !== parsed.length) return 'token';
  if (tokens.some((token, index) => token.kind === 'word' && !knownWord(tokens, index))) {
    return 'vocabulary';
  }
  return joinedPlaceholders(tokens, edgesOf) ? 'joined_placeholders' : null;
}
