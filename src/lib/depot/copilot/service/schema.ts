import { z } from 'zod';
import { isValidDepotId, isValidRouteName } from '@/lib/depot/ids';
import { isProposalId } from '@/lib/depot/service/bands';
import { MAX_QUESTION_CHARS } from '@/lib/depot/copilot/limits';
import { sanitizeQuestion } from '@/lib/depot/copilot/router/sanitize';
import type { CopilotApiRequest } from '@/lib/depot/copilot/wire';

/**
 * The request body, exactly `CopilotApiRequest` and nothing more: every object
 * is strict, so a key that tried to pick a provider, a model, a prompt or a
 * fact is refused rather than ignored.
 */

/** A transfer id is `<fromDepotId>><toDepotId>` (see `Transfer.id`). */
export function isValidTransferId(value: string): boolean {
  const parts = value.split('>');
  return parts.length === 2 && parts.every((part) => isValidDepotId(part));
}

/** Two ids of at most ten characters (`unassigned`) and the separator. */
const MAX_TRANSFER_ID_CHARS = 21;

const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('network') }).strict(),
  z.object({ kind: z.literal('depot'), depotId: z.string().refine(isValidDepotId) }).strict(),
]);

/** `p-` and eight hex digits, as `proposalId` makes them. */
const MAX_PROPOSAL_ID_CHARS = 10;

/** A union of strict objects: a rationale names a transfer or a route's proposal, never both. */
const requestSchema = z.union([
  z.object({ task: z.literal('briefing'), scope: scopeSchema }).strict(),
  z
    .object({
      task: z.literal('rationale'),
      transferId: z.string().max(MAX_TRANSFER_ID_CHARS).refine(isValidTransferId),
    })
    .strict(),
  z
    .object({
      task: z.literal('rationale'),
      proposalId: z.string().max(MAX_PROPOSAL_ID_CHARS).refine(isProposalId),
      routeName: z.string().refine(isValidRouteName),
    })
    .strict(),
  z
    .object({
      task: z.literal('ask'),
      question: z.string().min(1).max(MAX_QUESTION_CHARS),
      scope: scopeSchema,
    })
    .strict(),
]);

declare const validated: unique symbol;

/**
 * A validated request; for `ask`, `question` has been through
 * `sanitizeQuestion`. Branded, so only `parseCopilotBody` can produce one.
 */
export type ValidCopilotRequest = CopilotApiRequest & { readonly [validated]: true };

/** Null for anything that is not JSON of exactly the wire shape, or an ask with no question left. */
export function parseCopilotBody(text: string): ValidCopilotRequest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return null;
  const body: CopilotApiRequest = parsed.data;
  if (body.task !== 'ask') return body as ValidCopilotRequest;
  const question = sanitizeQuestion(body.question);
  return question === '' ? null : ({ ...body, question } as ValidCopilotRequest);
}
