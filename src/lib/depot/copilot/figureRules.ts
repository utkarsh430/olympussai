import {
  CLAUSE_BREAK_MARKS,
  FIGURE_JOINING_WORD,
  FIGURE_LINK_WORDS,
  FIGURE_QUALIFIER_WORDS,
  FIGURE_UNIT_WORDS,
  MIN_JOINING_WORD_LETTERS,
  NAME_LIST_MARK,
  NEGATIVE_CONTRACTION,
  RATE_ARTICLES,
  SENTENCE_END_MARK,
  VALUE_LIST_MARK,
} from '@/lib/depot/copilot/limits';
import { windowProblem, type WindowProblem } from '@/lib/depot/copilot/figureWindow';
import { reducesToAny } from '@/lib/depot/copilot/vocabulary';

export type Token =
  | { readonly kind: 'word'; readonly core: string; readonly mark: string }
  | { readonly kind: 'placeholder'; readonly id: string; readonly mark: string };

/** What the grammar needs to know about a fact's rendered text. */
export interface FactEdges {
  /** Ends in a bare number or a dash: a comma after it could read as part of the figure. */
  readonly endsBare: boolean;
  readonly startsWithLetter: boolean;
  /** A figure (it holds a digit, or no letter at all) and not a server-marked name. */
  readonly figure: boolean;
  /** The depot the fact describes, where the request holds more than one (depotRule.ts). */
  readonly depot?: string;
}

export type FigureProblem =
  | 'joined_placeholders'
  | 'figure_link'
  | 'figure_unit'
  | 'figure_qualifier'
  | WindowProblem;

type EdgesOf = (id: string) => FactEdges;
type Word = Extract<Token, { kind: 'word' }>;
type Placeholder = Extract<Token, { kind: 'placeholder' }>;

const UNITS: ReadonlySet<string> = new Set(FIGURE_UNIT_WORDS);
const QUALIFIERS: ReadonlySet<string> = new Set(FIGURE_QUALIFIER_WORDS);
const LINKS: ReadonlySet<string> = new Set(FIGURE_LINK_WORDS);

const breaksClause = (token: Token): boolean => CLAUSE_BREAK_MARKS.includes(token.mark);
const isUnit = (core: string): boolean => reducesToAny(core, UNITS);
const isQualifier = (core: string): boolean =>
  QUALIFIERS.has(core) || core.endsWith(NEGATIVE_CONTRACTION);

/**
 * A word that can act as a unit, a period or a rate
 * may not touch a figure on either side ("3 days", "3 each", "per 3"), and a
 * negation or comparison may not stand directly before one ("not 3", "more
 * than 3", "about 3"). A mark after the word lifts the rule; after a figure only a
 * clause mark does ("3, daily" is still a rate).
 */
function neighbourProblem(tokens: readonly Token[], edgesOf: EdgesOf): FigureProblem | null {
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'placeholder' || !edgesOf(token.id).figure) continue;
    const next = tokens[index + 1];
    const article = next?.kind === 'word' && next.mark === '' && RATE_ARTICLES.includes(next.core);
    const after = article ? tokens[index + 2] : next;
    if (after?.kind === 'word' && !breaksClause(token) && isUnit(after.core)) return 'figure_unit';
    const before = tokens[index - 1];
    // Any mark after the word ("already over, 3 buses") separates it from the figure.
    if (before?.kind !== 'word' || before.mark !== '') continue;
    if (isUnit(before.core)) return 'figure_unit';
    if (isQualifier(before.core)) return 'figure_qualifier';
  }
  return null;
}

/** Side by side: `; ` between any two values, `, ` unless the digits would fuse. */
function listed(previous: Placeholder, next: Placeholder, edgesOf: EdgesOf): boolean {
  const fuses = edgesOf(previous.id).endsBare && !edgesOf(next.id).startsWithLetter;
  return previous.mark === VALUE_LIST_MARK || (previous.mark === NAME_LIST_MARK && !fuses);
}

/**
 * Between two figures in one sentence the model may write a
 * list mark, the single word "and", or a real statement: at least one word
 * that is not a linking word. Linking words alone ("3 to 5", "3 out of 5",
 * "3 (of 5)", "3 or 5") would build a range or a ratio.
 */
function onlyLinks(gap: readonly Word[]): boolean {
  if (gap.some((word) => word.mark === SENTENCE_END_MARK)) return false;
  if (!gap.every((word) => LINKS.has(word.core))) return false;
  return !(gap.length === 1 && gap[0]?.core === FIGURE_JOINING_WORD);
}

function betweenProblem(tokens: readonly Token[], edgesOf: EdgesOf): FigureProblem | null {
  let previous: Placeholder | null = null;
  let gap: readonly Word[] = [];
  for (const token of tokens) {
    if (token.kind === 'word') {
      gap = [...gap, token];
      continue;
    }
    if (previous !== null && gap.length === 0 && !listed(previous, token, edgesOf)) {
      return 'joined_placeholders';
    }
    if (previous !== null && gap.length > 0) {
      if (!gap.some((word) => word.core.length >= MIN_JOINING_WORD_LETTERS)) {
        return 'joined_placeholders';
      }
      const figures = edgesOf(previous.id).figure && edgesOf(token.id).figure;
      if (figures && previous.mark !== SENTENCE_END_MARK && onlyLinks(gap)) return 'figure_link';
    }
    previous = token;
    gap = [];
  }
  return null;
}

/** The first problem with how figures sit among the words, or null. */
export function figureProblem(tokens: readonly Token[], edgesOf: EdgesOf): FigureProblem | null {
  return (
    betweenProblem(tokens, edgesOf) ??
    neighbourProblem(tokens, edgesOf) ??
    windowProblem(tokens, (id) => edgesOf(id).figure)
  );
}
