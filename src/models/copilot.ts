import { z } from 'zod';

/**
 * Wire-contract Zod schemas for the LLM incident-explanation / shift-report
 * / NL-query copilot (docs/olympuss/COPILOT.md). Shared by the client
 * components (src/components/ops/control-room/*Copilot*.tsx) and the route
 * handlers under src/app/api/ops/control-room/copilot/*, per this repo's
 * existing pattern (src/models/control.ts is the same kind of contract for
 * the control-service wire shape).
 *
 * Every response here carries `citations`: the copilot never returns a
 * claim without pointing at the stored record(s) it came from (ticket AC
 * "Explanations grounded in stored incident evidence; NL query answers cite
 * source records"). An empty `citations` array is only valid alongside a
 * response that explicitly says the evidence does not support an answer —
 * src/lib/copilot/prompts.ts's system prompt instructs the model that way,
 * and src/lib/copilot/service.ts never fabricates a citation itself.
 */

export const copilotSourceRecordTypeSchema = z.enum([
  'incident',
  'incident_member',
  'audit_event',
  'breakdown_report',
]);
export type CopilotSourceRecordType = z.infer<typeof copilotSourceRecordTypeSchema>;

export const copilotSourceCitationSchema = z.object({
  recordType: copilotSourceRecordTypeSchema,
  recordId: z.string().min(1),
  summary: z.string().min(1),
});
export type CopilotSourceCitation = z.infer<typeof copilotSourceCitationSchema>;

// ---------------------------------------------------------------------------
// Incident explanation
// ---------------------------------------------------------------------------

export const explainIncidentRequestSchema = z.object({
  incidentId: z.string().min(1),
  routeDirectionId: z.string().min(1).optional(),
});
export type ExplainIncidentRequest = z.infer<typeof explainIncidentRequestSchema>;

export const explainIncidentResponseSchema = z.object({
  incidentId: z.string(),
  narrative: z.string(),
  citations: z.array(copilotSourceCitationSchema),
  model: z.string(),
  generatedAt: z.string(),
});
export type ExplainIncidentResponse = z.infer<typeof explainIncidentResponseSchema>;

// ---------------------------------------------------------------------------
// NL query
// ---------------------------------------------------------------------------

export const copilotQueryRequestSchema = z.object({
  question: z.string().trim().min(3).max(1000),
  routeDirectionId: z.string().min(1).optional(),
});
export type CopilotQueryRequest = z.infer<typeof copilotQueryRequestSchema>;

export const copilotQueryResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(copilotSourceCitationSchema),
  model: z.string(),
  generatedAt: z.string(),
});
export type CopilotQueryResponse = z.infer<typeof copilotQueryResponseSchema>;

// ---------------------------------------------------------------------------
// Shift-report draft
// ---------------------------------------------------------------------------

export const shiftReportDraftRequestSchema = z.object({
  shiftLabel: z.string().trim().min(1).max(120),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  routeDirectionId: z.string().min(1).optional(),
});
export type ShiftReportDraftRequest = z.infer<typeof shiftReportDraftRequestSchema>;

export const shiftReportStatusSchema = z.enum(['draft', 'saved', 'sent']);
export type ShiftReportStatus = z.infer<typeof shiftReportStatusSchema>;

export const shiftReportDraftSchema = z.object({
  id: z.string(),
  shiftLabel: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  routeDirectionId: z.string().nullable(),
  content: z.string(),
  aiDrafted: z.literal(true),
  citations: z.array(copilotSourceCitationSchema),
  status: shiftReportStatusSchema,
  createdAt: z.string(),
  savedAt: z.string().nullable(),
  sentAt: z.string().nullable(),
});
export type ShiftReportDraft = z.infer<typeof shiftReportDraftSchema>;

/** `save` = filed to the shift log without notifying the incoming shift; `send` = delivered to the incoming shift. Both are exclusively human-triggered — see POST .../shift-reports/[id]/finalize. */
export const finalizeShiftReportRequestSchema = z.object({
  action: z.enum(['save', 'send']),
});
export type FinalizeShiftReportRequest = z.infer<typeof finalizeShiftReportRequestSchema>;
