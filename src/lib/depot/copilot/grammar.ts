import {
  figureProblem,
  type FactEdges,
  type FigureProblem,
  type Token,
} from '@/lib/depot/copilot/figureRules';
import {
  FACT_ID_SOURCE,
  TRAILING_MARKS,
  WORD_CLOSERS,
  WORD_OPENERS,
} from '@/lib/depot/copilot/limits';
import { isVocabularyWord } from '@/lib/depot/copilot/vocabulary';
import { BOUND_PHRASES } from '@/lib/depot/copilot/vocabulary/judgement';
import { sentenceProblem, type SentenceProblem } from '@/lib/depot/copilot/sentenceRules';
import { depotProblem, type DepotProblem } from '@/lib/depot/copilot/depotRule';

export type { FactEdges };
export type GrammarProblem =
  | 'spacing'
  | 'token'
  | 'vocabulary'
  | FigureProblem
  | DepotProblem
  | SentenceProblem;

const inClass = (chars: readonly string[]): string =>
  chars.map((c) => c.replace(/[\\\]^-]/g, '\\$&')).join('');
const MARK = `[${inClass(TRAILING_MARKS)}]?`;

/** `(`? placeholder `)`? mark? and nothing else: no sign, point, percent, letter or quote. */
const PLACEHOLDER_TOKEN = new RegExp(`^\\(?\\{\\{fact:(${FACT_ID_SOURCE})\\}\\}\\)?(${MARK})$`);
/** opener? letters (with inner hyphens or apostrophes) closer? mark? */
const WORD_TOKEN = new RegExp(
  `^[${inClass(WORD_OPENERS)}]?([A-Za-z]+(?:['-][A-Za-z]+)*)[${inClass(WORD_CLOSERS)}]?(${MARK})$`,
);
const POSSESSIVE = "'s";

function parseToken(raw: string): Token | null {
  const placeholder = PLACEHOLDER_TOKEN.exec(raw);
  if (placeholder)
    return { kind: 'placeholder', id: placeholder[1] ?? '', mark: placeholder[2] ?? '' };
  const word = WORD_TOKEN.exec(raw);
  // Matching is case-insensitive on the whole token.
  return word
    ? { kind: 'word', core: (word[1] ?? '').toLowerCase(), mark: word[2] ?? '' }
    : null;
}

/**
 * The draft text as tokens, or null when any part is outside the token grammar.
 * Test helper: no product code calls it; tests use it to split drafts the same way the
 * grammar reads them.
 */
export function tokenize(text: string): Token[] | null {
  const parsed = text.split(' ').map(parseToken);
  return parsed.every((t): t is Token => t !== null) ? parsed : null;
}

/** The phrase's words stand at `start`, with no mark before its last word. */
function phraseAt(tokens: readonly Token[], phrase: readonly string[], start: number): boolean {
  return phrase.every((word, offset) => {
    const token = tokens[start + offset];
    if (token?.kind !== 'word' || token.core !== word) return false;
    return offset === phrase.length - 1 || token.mark === '';
  });
}

/** A judgement word the scripted writer needs, inside its one fixed phrase. */
function inBoundPhrase(tokens: readonly Token[], index: number, core: string): boolean {
  return BOUND_PHRASES.some((phrase) =>
    phrase.some((word, at) => word === core && phraseAt(tokens, phrase, index - at)),
  );
}

function knownWord(tokens: readonly Token[], index: number): boolean {
  const token = tokens[index];
  const core = token?.kind === 'word' ? token.core : '';
  if (isVocabularyWord(core) || inBoundPhrase(tokens, index, core)) return true;
  return core.endsWith(POSSESSIVE) && isVocabularyWord(core.slice(0, -POSSESSIVE.length));
}

/**
 * Checks one headline or paragraph against the token grammar and the closed
 * vocabulary. Tokens are separated by exactly one space; each is a word token
 * or a placeholder token; figureRules.ts then checks what stands beside and
 * between the figures, and sentenceRules.ts what a whole sentence may do: no
 * negation or contradiction word outside a reviewed figure-less sentence, no
 * second-person word, and no sentence opening with a bare verb outside the
 * reviewed recommendations (see `sentenceProblem` for the exact rule). Returns the first problem as a fixed code, never any
 * text from the draft.
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
  return (
    figureProblem(tokens, edgesOf) ??
    depotProblem(tokens, edgesOf) ??
    sentenceProblem(tokens, (id) => edgesOf(id).figure)
  );
}
