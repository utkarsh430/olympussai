import { words } from '@/lib/depot/copilot/vocabulary/function';

/*
 * Ruling S49 M1. A true figure must not be placed in a false sentence by the
 * words around it. Two closed lists say which words may stand within
 * FIGURE_WINDOW_WORDS words of a figure; anything else there is refused, so a
 * word added to the vocabulary later cannot open a hole near a figure. Neither
 * list holds an article after a figure, a noun right after one, a unit or
 * period word, a rate maker, a negation or a quantifier.
 */

/** Words counted on each side of a figure; placeholders are skipped, not counted. */
export const FIGURE_WINDOW_WORDS = 2;

/** May stand within the window before a figure. */
export const BEFORE_FIGURE_WORDS: readonly string[] = words(`
account against already although and are as at away buses by count cover coverage covers
currently dark deficit depot depots distance efficiency feed figure fleet flagged flags for gone
had has have held here holds homed in index is it its known latest leave level lost maintenance maximum moving
network now of off on plan position proposes rate receiving reporting reports road running schedule sending
share short signal since snapshot stand stands surplus that the this those though time to
updated was were which while with yard
`);

/** May stand within the window after a figure: never a noun, an article or a rate maker. */
export const AFTER_FIGURE_WORDS: readonly string[] = words(`
against already among and are at away beyond cover dark due fall falls flagged from gone
between had has have here higher homed in inside is its keeps largest lost lower of off on
overdue places reporting running scheduled small that the them to too was were which whose
within would yet
`);

/** A state, not a count: may stand second after a figure when the first word is "in". */
export const STATE_NOUNS: readonly string[] = words('balance deficit service surplus');
export const STATE_PREPOSITION = 'in';

/**
 * Refused anywhere in a figure's clause: negation, rate makers, aggregates,
 * limiters and day shifts. Every figure is as of the feed time, for the scope
 * its fact names, so none of these can be true of one.
 */
export const NEGATION_WORDS: readonly string[] = words('not no never nor cannot without');
export const CLAUSE_SCOPE_STEMS: readonly string[] = words(`
each every per apiece daily weekly monthly yearly nightly
average typical total combined overall altogether bulk majority minority rest portion fraction
earlier later next previous prior former past future recently lately soon
`);
export const LIMITER_WORDS: readonly string[] = words(`
only just merely mere barely nearly almost roughly exactly least most fewer less
`);
export const CLAUSE_SCOPE_WORDS: readonly string[] = [
  ...NEGATION_WORDS,
  ...CLAUSE_SCOPE_STEMS,
  ...LIMITER_WORDS,
];

/** After a comma, one of these starts a new clause; `.`, `;` and `:` always do. */
export const CLAUSE_OPENERS: readonly string[] = words(`
and but or so yet though although while whereas because since unless if when where
`);
