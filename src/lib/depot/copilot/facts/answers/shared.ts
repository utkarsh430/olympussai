import { buildRequest } from '@/lib/depot/copilot/facts/format';
import type { CopilotDraft, CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import type { AnswerData } from '@/lib/depot/copilot/facts/answers';

export const GUIDANCE =
  'Phrase the result of the query as a short, plain answer using only the supplied facts. ' +
  'Say plainly when something is not available or not established, describe rather than instruct.';
export const MODELLED_NOTE =
  'The requirement is modelled until a network timetable is supplied, so these are planning figures rather than measured needs.';
/** Lists in an answer are the leading entries only; this keeps a request far below the fact cap. */
export const MAX_LIST_ROWS = 5;
export const MAX_TRANSFER_ROWS = 4;

export const answer = (
  scopeLabel: string,
  facts: readonly CopilotFact[],
  draft: CopilotDraft,
): CopilotRequest =>
  buildRequest({ task: 'answer', scopeLabel, facts, guidance: GUIDANCE, scriptedDraft: draft });

export const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

export function unavailable(scope: string): CopilotRequest {
  return answer(scope, [], {
    headline: 'That answer is not available',
    paragraphs: [
      'The data needed to answer this is not available right now, so nothing can be said about it yet.',
    ],
  });
}

export const nameOf = (data: AnswerData, id: string): string | null =>
  data.network.depots.find((d) => d.id === id)?.name ??
  data.distribution?.balances.find((b) => b.depotId === id)?.depotName ??
  data.details?.[id]?.depot.name ??
  null;
