import { words } from '@/lib/depot/copilot/vocabulary/function';

/*
 * Reviewed lists for the sentence rules (sentenceRules.ts). A pattern is a
 * sentence's tokens joined by single spaces: words lower-cased with their
 * trailing mark, placeholders as {figure} or {name}. A test fails when the
 * scripted writer opens a sentence with a bare verb that is not listed here.
 */

/** Address the reader: refused anywhere in a draft. */
export const SECOND_PERSON_WORDS: readonly string[] = words('you your yours yourself yourselves');

/** Third word that shows a verb-led opener is a noun: "Schedule coverage is …". */
export const NOUN_USE_FINITE_VERBS: readonly string[] = words('is are was were has have had');
/** Second words that keep an opener an instruction: "Check it is clear". */
export const NOUN_USE_EXCLUDED_SECOND_WORDS: readonly string[] = words(`
it this that these those them they all everything something anything each every the a an
`);

/** Open an instruction although they are not in the verb list. */
export const IMPERATIVE_OPENERS: readonly string[] = words('please do let lets');

/**
 * The scripted writer's recommendations that open with a bare verb; each must say
 * that nothing is dispatched. None does today: its transfer and allocation
 * sentences open with a noun ("The plan proposes…", "Proposed transfer: …").
 */
export const RECOMMENDATION_SENTENCES: readonly string[] = [];
