// Zod request/response schemas for the REST surface. Field names mirror
// src/models/control.ts in the web app (the wire-contract schemas that
// repo already ships) so payloads round-trip without translation.
import { z } from 'zod';

export const commandActionTypeSchema = z.enum([
  'terminal_dispatch_hold',
  'two_way_hold',
  'self_equalizing_hold',
  'speed_guidance',
  'stop_skip',
  'short_turn',
  'deadhead',
  'boarding_limit',
  'standby_injection',
]);

/**
 * A human approval mirrored INLINE by the caller (the web app), so it can be
 * written into this service's `dispatcher_actions` table inside the very same
 * transaction as the command it authorizes.
 *
 * Why this exists: the web app records its dispatcher approvals in its own
 * Postgres (`ops_dispatcher_actions`), which this service never reads — the
 * two datastores are deliberately isolated
 * (docs/CONTROL_SERVICE_INTEGRATION.md sections 1 and 3). Until this schema
 * shipped, no code path in this service ever inserted a `dispatcher_actions`
 * row, so the NOT NULL + UNIQUE `commands.dispatcher_action_id` column and
 * the `consume_dispatcher_action` trigger could only ever REJECT: a real
 * human approval could not authorize a real command end to end.
 *
 * `id` is the WEB's own `ops_dispatcher_actions.id` (already a uuid), not one
 * generated here. That choice is what makes dispatch exactly-once: a retry
 * re-sends the same id, the UNIQUE constraint on `commands.dispatcher_action_id`
 * fires a 23505, and `mapCommandWriteError` already maps that to the
 * pre-existing 409 `dispatcher_action_already_used` — which the caller reads
 * as "the first attempt landed" rather than issuing a second command against
 * the same bus.
 *
 * `routeDirectionId` is REQUIRED and non-null on purpose. The rollout gate
 * (src/pilot/gate.ts) resolves the route-direction it gates on FROM this row;
 * a null there used to mean "nothing to gate against — allow", so a bridge
 * that sent null would have silently disabled the rollout gate for every
 * command. Fail closed here, at the wire boundary, and again in the gate.
 */
export const inlineDispatcherActionSchema = z.object({
  /** The web app's own ops_dispatcher_actions.id — mirrored, never regenerated. */
  id: z.string().uuid(),
  /** The authorizing human's identity in the caller's RBAC store (web: ops_users.id). */
  dispatcherId: z.string().min(1).max(200),
  actionType: commandActionTypeSchema,
  routeDirectionId: z.string().uuid('routeDirectionId is required and must be a valid UUID'),
  vehicleId: z.string().min(1).max(64).nullable().optional(),
  incidentId: z.string().uuid().nullable().optional(),
  reason: z.string().min(1).max(2000),
  authorizedAt: z.string().datetime({ offset: true }),
});
export type InlineDispatcherAction = z.infer<typeof inlineDispatcherActionSchema>;

/**
 * Inbound "create command" request body. `dispatcherActionId` is REQUIRED -
 * this is the wire-level counterpart of the non-negotiable rule in
 * docs/CONTROL_SERVICE_INTEGRATION.md section 1: no command may be created
 * without a valid, unconsumed, human-authorized dispatcher action. Presence
 * here is necessary but not sufficient - the database trigger
 * (control_service_consume_dispatcher_action) is the actual source of
 * truth and rejects an unknown/already-consumed id even if this check
 * passes.
 *
 * `dispatcherAction` is the optional inline mirror of that approval (see
 * inlineDispatcherActionSchema). Optional so an existing caller that has
 * already provisioned a `dispatcher_actions` row by some other means keeps
 * working unchanged; when present it is inserted `on conflict (id) do
 * nothing` in the same transaction as the command, BEFORE the trigger runs.
 */
export const createCommandRequestSchema = z
  .object({
    vehicleId: z.string().min(1),
    tripId: z.string().min(1).nullable().optional(),
    recommendationId: z.string().uuid().nullable().optional(),
    actionType: commandActionTypeSchema,
    targetStopId: z.string().min(1).nullable().optional(),
    parameters: z.record(z.string(), z.unknown()).optional().default({}),
    dispatcherActionId: z.string().uuid('dispatcherActionId is required and must be a valid UUID'),
    ttlSeconds: z.number().int().positive(),
    policyVersion: z.string().nullable().optional(),
    dispatcherAction: inlineDispatcherActionSchema.optional(),
  })
  // Cross-field checks, NOT redundant with the field checks above. Without
  // them a caller could mirror in an approval for one action and then issue a
  // different one against it: obtain approval for `speed_guidance`, send
  // `stop_skip`, and the `dispatcher_actions` row this command's audit trail
  // points at would describe an action nobody ever approved. The audit trail
  // has to be true, not merely present.
  .superRefine((value, ctx) => {
    if (!value.dispatcherAction) return;
    if (value.dispatcherAction.id !== value.dispatcherActionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dispatcherAction', 'id'],
        message: 'dispatcherAction.id must equal dispatcherActionId',
      });
    }
    if (value.dispatcherAction.actionType !== value.actionType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dispatcherAction', 'actionType'],
        message: 'dispatcherAction.actionType must equal actionType — an approval authorizes one action, not any action',
      });
    }
  });
export type CreateCommandRequest = z.infer<typeof createCommandRequestSchema>;

/**
 * Driver-side acknowledgement of a delivered command (blueprint 9.2).
 * `accept` moves the command into execution; `unable`/`unsafe` end its
 * lifecycle right there. All three are recorded identically (timestamp +
 * reason) - the command-lifecycle service never applies a penalty for
 * `unable`/`unsafe`, it only records the fact (see
 * src/db/commands.ts#acknowledgeCommand).
 */
export const commandAckOutcomeSchema = z.enum(['accept', 'unable', 'unsafe']);

export const acknowledgeCommandRequestSchema = z.object({
  outcome: commandAckOutcomeSchema,
  reason: z.string().min(1).max(2000).nullable().optional(),
  actorId: z.string().min(1, 'actorId (driver identity) is required'),
});
export type AcknowledgeCommandRequest = z.infer<typeof acknowledgeCommandRequestSchema>;

/**
 * Re-issues a command (e.g. updated hold parameters) before the original
 * was ever executed. Requires its own fresh `dispatcherActionId` -
 * superseding is a new command in every sense the non-negotiable
 * dispatcher-authorization rule cares about, it just also atomically
 * cancels the prior version and carries the version chain forward
 * (control-service/db/migrations/20260806120000__command_lifecycle.sql).
 */
export const supersedeCommandRequestSchema = z.object({
  actionType: commandActionTypeSchema.optional(),
  targetStopId: z.string().min(1).nullable().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  dispatcherActionId: z.string().uuid('dispatcherActionId is required and must be a valid UUID'),
  ttlSeconds: z.number().int().positive(),
  policyVersion: z.string().nullable().optional(),
  reason: z.string().min(1).max(2000).nullable().optional(),
  actorId: z.string().min(1).optional(),
});
export type SupersedeCommandRequest = z.infer<typeof supersedeCommandRequestSchema>;

export const mpcSolveRequestSchema = z.object({
  routeDirectionId: z.string().min(1),
});
export type MpcSolveRequest = z.infer<typeof mpcSolveRequestSchema>;

export const listVehicleStatesQuerySchema = z.object({
  routeDirectionId: z.string().min(1).optional(),
});
