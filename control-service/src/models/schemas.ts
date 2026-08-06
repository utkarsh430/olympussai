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

export const mpcSolveRequestSchema = z.object({
  routeDirectionId: z.string().min(1),
});
export type MpcSolveRequest = z.infer<typeof mpcSolveRequestSchema>;

export const listVehicleStatesQuerySchema = z.object({
  routeDirectionId: z.string().min(1).optional(),
});
