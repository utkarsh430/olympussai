import type { Provenance } from '@/lib/depot/types';
import { MAX_QUESTION_CHARS } from '../limits';
import type { CopilotFailureKind } from './copilotClient';
import type {
  CopilotDataSource,
  CopilotFactView,
  CopilotPublicNotice,
} from '../wire';

/** Wording and small pure decisions for the copilot UI; components only render these. */

/**
 * The footer's words for figures that are not from the live feed, the same words the
 * pages' provenance line uses for each source.
 */
export function dataSourceWords(source: CopilotDataSource): string {
  return source === 'sample' ? 'sample data' : 'last good data';
}

export function noticeSentence(notice: CopilotPublicNotice): string | null {
  switch (notice) {
    case 'claude_unavailable':
      return 'Claude was not available, so this is a scripted response.';
    case 'summary_unavailable':
      return 'A written summary could not be prepared. The figures on this page are not affected.';
    case 'none':
      return null;
  }
}

const FAILURE_SENTENCE: Readonly<Record<Exclude<CopilotFailureKind, 'rate_limited'>, string>> = {
  session_expired: 'Your session has ended. Sign in again to continue.',
  not_found: 'That depot or transfer is no longer in the latest data.',
  invalid: 'The request was not accepted. Check the question and try again.',
  forbidden: 'This request was refused because it did not come from this site.',
  unavailable: 'The copilot is not available right now. The figures on the page are unaffected.',
  network: 'The copilot could not be reached. Check your connection and try again.',
  aborted: 'The request was cancelled.',
};

export function failureSentence(kind: CopilotFailureKind, retryAfterSeconds = 0): string {
  if (kind !== 'rate_limited') return FAILURE_SENTENCE[kind];
  const unit = retryAfterSeconds === 1 ? 'second' : 'seconds';
  return `Too many requests. Try again in ${retryAfterSeconds} ${unit}.`;
}

export type QuestionCheck =
  | { readonly ok: true; readonly question: string; readonly remaining: number }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'too_long';
      readonly message: string;
      readonly remaining: number;
    };

export function normaliseQuestion(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** `remaining` is negative when over the cap, so the box can show how far over. */
export function validateQuestion(raw: string): QuestionCheck {
  const question = normaliseQuestion(raw);
  const remaining = MAX_QUESTION_CHARS - question.length;
  if (question.length === 0) {
    return { ok: false, reason: 'empty', message: 'Type a question first.', remaining };
  }
  if (remaining < 0) {
    const over = -remaining;
    const unit = over === 1 ? 'character' : 'characters';
    return {
      ok: false,
      reason: 'too_long',
      message: `The question is ${over} ${unit} over the ${MAX_QUESTION_CHARS} character limit.`,
      remaining,
    };
  }
  return { ok: true, question, remaining };
}

/** A group of suggested questions on the Ask page, under one eyebrow. */
export interface PresetGroup {
  readonly label: string;
  readonly questions: readonly string[];
}

/*
 * Every suggested question asks for something to act on — where buses are short or spare,
 * which routes need more or fewer in an hour, where to start — and every one is a shape the
 * scripted router answers (the router's own tests hold each shape).
 */

const SERVICE_SUGGESTIONS: PresetGroup = {
  label: 'Service by the hour',
  questions: [
    'What is the plan for today?',
    'Which routes need more buses at 10 am?',
    'Which routes are short at 8 am?',
    'Which routes are over-served in the morning peak?',
    'Which routes are over-served after 6 pm?',
  ],
};

const BALANCE_SUGGESTIONS: PresetGroup = {
  label: 'Fleet balance',
  questions: [
    'Which depots are short of buses?',
    'Which depots have spare buses?',
    'Which depot has the most buses off road?',
  ],
};

const START_SUGGESTIONS: PresetGroup = {
  label: 'Where to start',
  questions: [
    'Which five depots rank lowest on the efficiency index?',
    'Which depots have the most dark buses?',
  ],
};

/** The network's suggestions kept beside a depot's own, so a depot scope still offers ten. */
const BESIDE_DEPOT: readonly PresetGroup[] = [
  { label: BALANCE_SUGGESTIONS.label, questions: BALANCE_SUGGESTIONS.questions.slice(0, 2) },
  { label: SERVICE_SUGGESTIONS.label, questions: [SERVICE_SUGGESTIONS.questions[0] ?? '', 'Which routes need more buses at 10 am?', 'Which routes are over-served after 6 pm?'] },
];

const MAX_EXAMPLE_NAME_CHARS = 80;

/**
 * Suggested questions for the chosen scope, in groups: ten for the whole network, and ten
 * when a depot is chosen, five of them naming that depot, so a suggestion never refers to
 * "this depot" while the whole network is selected.
 */
export function suggestedQuestionGroups(depotName: string | null): readonly PresetGroup[] {
  if (depotName === null) return [SERVICE_SUGGESTIONS, BALANCE_SUGGESTIONS, START_SUGGESTIONS];
  const name = depotName.slice(0, MAX_EXAMPLE_NAME_CHARS);
  return [
    {
      label: 'This depot',
      questions: [
        `What should ${name} change this morning?`,
        `What should ${name} change this evening?`,
        `Should ${name} send buses elsewhere?`,
        `What exceptions does ${name} have?`,
        `How is outshedding at ${name}?`,
      ],
    },
    ...BESIDE_DEPOT,
  ];
}

/** The suggestions for the chosen scope as one flat list, in the order shown. */
export function exampleQuestions(depotName: string | null): readonly string[] {
  return suggestedQuestionGroups(depotName).flatMap((group) => group.questions);
}

export interface FactGroup {
  readonly provenance: Provenance;
  readonly facts: readonly CopilotFactView[];
}

const PROVENANCE_ORDER: readonly Provenance[] = ['live', 'derived', 'modelled', 'reference'];

export function groupFactsByProvenance(facts: readonly CopilotFactView[]): readonly FactGroup[] {
  return PROVENANCE_ORDER.map((provenance) => ({
    provenance,
    facts: facts.filter((fact) => fact.provenance === provenance),
  })).filter((group) => group.facts.length > 0);
}

/** The question box's limit, always visible: "212 of 300 characters left" or "12 over the 300 character limit". */
export function limitSentence(remaining: number, max: number = MAX_QUESTION_CHARS): string {
  return remaining < 0
    ? `${-remaining} over the ${max} character limit`
    : `${remaining} of ${max} characters left`;
}

/** Said once, after the first answer, in place of a section paragraph. */
export function sessionNote(maxKept: number): string {
  return `The last ${maxKept} answers stay on this page, newest first. Nothing is stored: they are gone when you leave or reload.`;
}
