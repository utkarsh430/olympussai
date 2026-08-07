// Zod request/response schemas for the pilot-staging surface: per-route
// rollout stage, guardrail breaches, daily KPI snapshots, and war-room
// incident review. Field names mirror the web app's src/models/control.ts
// (once that ticket adds the matching pilot schemas there) so payloads
// round-trip without translation, same convention as models/schemas.ts.
import { z } from 'zod';

export const rolloutStageSchema = z.enum(['observation', 'shadow', 'advisory', 'limited_auto', 'expanded']);
export type RolloutStage = z.infer<typeof rolloutStageSchema>;

/** Stages that forbid command creation outright (src/pilot/gate.ts). Advisory and beyond already require a human-approved dispatcher_action_id for every command (docs/CONTROL_SERVICE_INTEGRATION.md section 1), so the gate only needs to block the two pre-command stages. */
export const ROLLOUT_STAGES_FORBIDDING_COMMANDS: readonly RolloutStage[] = ['observation', 'shadow'];

export const setRolloutStageRequestSchema = z.object({
  stage: rolloutStageSchema,
  changedBy: z.string().min(1, 'changedBy is required').max(200),
  reason: z.string().max(2000).nullable().optional(),
});
export type SetRolloutStageRequest = z.infer<typeof setRolloutStageRequestSchema>;

export const warRoomClassificationSchema = z.enum(['eligible', 'exogenous', 'structural']);
export type WarRoomClassification = z.infer<typeof warRoomClassificationSchema>;

export const submitIncidentReviewRequestSchema = z.object({
  classification: warRoomClassificationSchema,
  actionTaken: z.string().max(4000).nullable().optional(),
  outcome: z.string().max(4000).nullable().optional(),
  reviewedBy: z.string().min(1, 'reviewedBy is required').max(200),
});
export type SubmitIncidentReviewRequest = z.infer<typeof submitIncidentReviewRequestSchema>;

export const dailyKpiQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
  routeDirectionId: z.string().uuid().optional(),
});

export const warRoomQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
  routeDirectionId: z.string().uuid().optional(),
});

export const guardrailBreachQuerySchema = z.object({
  routeDirectionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
