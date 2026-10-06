import { CLAUSE_BREAK_MARKS, NAME_LIST_MARK, NEGATIVE_CONTRACTION } from '@/lib/depot/copilot/limits';
import { reducesToAny } from '@/lib/depot/copilot/vocabulary';
import {
  AFTER_FIGURE_WORDS,
  BEFORE_FIGURE_WORDS,
  CLAUSE_OPENERS,
  CLAUSE_SCOPE_STEMS,
  FIGURE_WINDOW_WORDS,
  LIMITER_WORDS,
  NEGATION_WORDS,
  STATE_NOUNS,
  STATE_PREPOSITION,
} from '@/lib/depot/copilot/vocabulary/nearFigure';

/** The token shape figureRules.ts parses; only what this check reads. */
type Token =
  | { readonly kind: 'word'; readonly core: string; readonly mark: string }
  | { readonly kind: 'placeholder'; readonly id: string; readonly mark: string };

export type WindowProblem = 'figure_window' | 'figure_clause';

const BEFORE: ReadonlySet<string> = new Set(BEFORE_FIGURE_WORDS);
const AFTER: ReadonlySet<string> = new Set(AFTER_FIGURE_WORDS);
const STATES: ReadonlySet<string> = new Set(STATE_NOUNS);
const OPENERS: ReadonlySet<string> = new Set(CLAUSE_OPENERS);
const EXACT: ReadonlySet<string> = new Set([...NEGATION_WORDS, ...LIMITER_WORDS]);
const STEMS: ReadonlySet<string> = new Set(CLAUSE_SCOPE_STEMS);

/** A clause ends after a `.`, `;` or `:`, or after a comma that a clause opener follows. */
function endsClause(tokens: readonly Token[], index: number): boolean {
  const token = tokens[index];
  if (token === undefined) return true;
  if (CLAUSE_BREAK_MARKS.includes(token.mark)) return true;
  const next = tokens[index + 1];
  return token.mark === NAME_LIST_MARK && next?.kind === 'word' && OPENERS.has(next.core);
}

/** The first and last token index of the clause that holds `index`. */
export function clauseOf(tokens: readonly Token[], index: number): readonly [number, number] {
  let start = index;
  while (start > 0 && !endsClause(tokens, start - 1)) start -= 1;
  let end = index;
  while (end < tokens.length - 1 && !endsClause(tokens, end)) end += 1;
  return [start, end];
}

const scopeWord = (core: string): boolean =>
  EXACT.has(core) || core.endsWith(NEGATIVE_CONTRACTION) || reducesToAny(core, STEMS);

/** Up to FIGURE_WINDOW_WORDS words from `from` while `inside`, skipping placeholders. */
function windowWords(
  tokens: readonly Token[],
  from: number,
  step: 1 | -1,
  inside: (i: number) => boolean,
): readonly string[] {
  const found: string[] = [];
  for (let i = from; inside(i); i += step) {
    const token = tokens[i];
    if (token?.kind !== 'word') continue;
    found.push(token.core);
    if (found.length === FIGURE_WINDOW_WORDS) break;
  }
  return found;
}

function afterAllowed(after: readonly string[]): boolean {
  return after.every(
    (core, i) =>
      AFTER.has(core) || (i === 1 && after[0] === STATE_PREPOSITION && STATES.has(core)),
  );
}

/**
 * Ruling S49 M1. Within FIGURE_WINDOW_WORDS words of a figure (inside its
 * clause, commas crossed) only the reviewed BEFORE and AFTER words may stand;
 * anywhere in the clause, no negation, rate maker, aggregate, limiter or day
 * shift may. Names and other figures are skipped: the between-figure rules
 * cover two figures, and a name carries no quantity.
 */
export function windowProblem(
  tokens: readonly Token[],
  isFigure: (id: string) => boolean,
): WindowProblem | null {
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'placeholder' || !isFigure(token.id)) continue;
    const [start, end] = clauseOf(tokens, index);
    const clause = tokens.slice(start, end + 1);
    if (clause.some((t) => t.kind === 'word' && scopeWord(t.core))) return 'figure_clause';
    const before = windowWords(tokens, index - 1, -1, (i) => i >= start);
    if (!before.every((core) => BEFORE.has(core))) {
      return 'figure_window';
    }
    const after = windowWords(tokens, index + 1, 1, (i) => i <= end);
    if (!afterAllowed(after)) return 'figure_window';
  }
  return null;
}
