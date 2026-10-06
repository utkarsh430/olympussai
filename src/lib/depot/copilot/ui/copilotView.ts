import type { Provenance } from '@/lib/depot/types';
import { MAX_QUESTION_CHARS } from '../limits';
import type { CopilotFailureKind } from './copilotClient';
import type { CopilotFactView, CopilotPublicNotice, CopilotPublicProvider } from '../wire';

/** Wording and small pure decisions for the copilot UI; components only render these. */

export function providerTagText(provider: CopilotPublicProvider): string {
  return provider === 'claude' ? 'Written by Claude' : 'Scripted response';
}

export function noticeSentence(notice: CopilotPublicNotice): string | null {
  switch (notice) {
    case 'claude_unavailable':
      return 'Claude was not available, so this is a scripted response.';
    case 'summary_unavailable':
      return 'A written summary could not be prepared. The figures on this page are current.';
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

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
});

/** The depot module reads in Indian Standard Time; the zone is fixed so server and browser agree. */
export function generatedAtText(generatedAt: string, cached: boolean): string {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return 'Written just now';
  const base = `Written at ${TIME_FORMAT.format(date)} IST`;
  return cached ? `${base}, reused from earlier on this snapshot` : base;
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
