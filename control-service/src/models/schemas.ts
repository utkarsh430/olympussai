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
 * Inbound "create command" request body. `dispatcherActionId` is REQUIRED -
 * this is the wire-level counterpart of the non-negotiable rule in
 * docs/CONTROL_SERVICE_INTEGRATION.md section 1: no command may be created
 * without a valid, unconsumed, human-authorized dispatcher action. Presence
 * here is necessary but not sufficient - the database trigger
 * (control_service_consume_dispatcher_action) is the actual source of
 * truth and rejects an unknown/already-consumed id even if this check
 * passes.
 */
export const createCommandRequestSchema = z.object({
  vehicleId: z.string().min(1),
  tripId: z.string().min(1).nullable().optional(),
  recommendationId: z.string().uuid().nullable().optional(),
  actionType: commandActionTypeSchema,
  targetStopId: z.string().min(1).nullable().optional(),
  parameters: z.record(z.string(), z.unknown()).optional().default({}),
  dispatcherActionId: z.string().uuid('dispatcherActionId is required and must be a valid UUID'),
  ttlSeconds: z.number().int().positive(),
  policyVersion: z.string().nullable().optional(),
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
