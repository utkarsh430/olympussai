import { SENTENCE_END_MARK } from '@/lib/depot/copilot/limits';
import { BASE_VERBS } from '@/lib/depot/copilot/vocabulary/verbs';
import {
  IMPERATIVE_OPENERS,
  NOUN_USE_EXCLUDED_SECOND_WORDS,
  NOUN_USE_FINITE_VERBS,
  RECOMMENDATION_SENTENCES,
  SECOND_PERSON_WORDS,
} from '@/lib/depot/copilot/vocabulary/sentences';

/** The token shape the grammar parses; only what this check reads. */
type Token =
  | { readonly kind: 'word'; readonly core: string; readonly mark: string }
  | { readonly kind: 'placeholder'; readonly id: string; readonly mark: string };

export type SentenceProblem = 'sentence_address' | 'sentence_imperative';

const SECOND_PERSON: ReadonlySet<string> = new Set(SECOND_PERSON_WORDS);
const BARE_VERBS: ReadonlySet<string> = new Set([...BASE_VERBS, ...IMPERATIVE_OPENERS]);
const RECOMMENDATIONS: ReadonlySet<string> = new Set(RECOMMENDATION_SENTENCES);

/** Placeholders stand as `{figure}` or `{name}`, so a pattern never depends on a fact id. */
export function sentencePattern(
  sentence: readonly Token[],
  isFigure: (id: string) => boolean,
): string {
  return sentence
    .map((t) =>
      t.kind === 'word' ? `${t.core}${t.mark}` : `${isFigure(t.id) ? '{figure}' : '{name}'}${t.mark}`,
    )
    .join(' ');
}

/** Sentences end at a word or placeholder carrying a full stop; a tail without one is a sentence too. */
export function splitSentences(tokens: readonly Token[]): readonly (readonly Token[])[] {
  const sentences: Token[][] = [[]];
  for (const token of tokens) {
    sentences[sentences.length - 1]?.push(token);
    if (token.mark === SENTENCE_END_MARK) sentences.push([]);
  }
  return sentences.filter((s) => s.length > 0);
}

const NOUN_USE_VERBS: ReadonlySet<string> = new Set(NOUN_USE_FINITE_VERBS);
const POINTERS: ReadonlySet<string> = new Set(NOUN_USE_EXCLUDED_SECOND_WORDS);

/**
 * "Schedule coverage is …": the opener is the first noun of a compound subject
 * when the second token is a word that is not a pronoun and the third is a form
 * of "be" or "have". "Check it is clear" stays an instruction.
 */
function nounUse(sentence: readonly Token[]): boolean {
  const [, second, third] = sentence;
  if (second?.kind !== 'word' || second.mark !== '' || POINTERS.has(second.core)) return false;
  return third?.kind === 'word' && NOUN_USE_VERBS.has(third.core);
}

/** Opens with a bare verb or an imperative opener, not used as a noun. */
export const sentenceOpensBare = (sentence: readonly Token[]): boolean =>
  sentence[0]?.kind === 'word' && BARE_VERBS.has(sentence[0].core) && !nounUse(sentence);

/**
 * A draft never addresses its reader and never instructs.
 *  - No second-person word (SECOND_PERSON_WORDS) anywhere in a draft.
 *  - No sentence (headline included) opening with a bare verb: a base form in
 *    BASE_VERBS, or one of IMPERATIVE_OPENERS ("please", "do", "let"). Inflected
 *    openers ("Flagged", "Left", "Proposed") are descriptions and stay allowed,
 *    and so is a base form used as the first noun of a subject: second token a
 *    word that is not a pronoun or pointer, third a form of "be" or "have"
 *    ("Schedule coverage is …").
 *    The only exception is a sentence matching one of RECOMMENDATION_SENTENCES
 *    word for word (placeholders as {figure} or {name}): the scripted writer's
 *    transfer and allocation recommendations, each of which must say nothing is
 *    dispatched. The list is empty: the writer opens none with a bare verb.
 * Negation is checked by figureWindow.ts within a figure's clause only; a
 * negation in a later, figure-less sentence is not refused (see the operator's note).
 */
export function sentenceProblem(
  tokens: readonly Token[],
  isFigure: (id: string) => boolean,
): SentenceProblem | null {
  if (tokens.some((t) => t.kind === 'word' && SECOND_PERSON.has(t.core))) return 'sentence_address';
  for (const sentence of splitSentences(tokens)) {
    const pattern = sentencePattern(sentence, isFigure);
    if (sentenceOpensBare(sentence) && !RECOMMENDATIONS.has(pattern)) return 'sentence_imperative';
  }
  return null;
}
