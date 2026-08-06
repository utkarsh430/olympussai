/**
 * Copilot orchestration: incident explanation, shift-report drafting, NL
 * query answering. Every public function here follows the same shape —
 * gather grounding evidence (read-only) -> build a prompt that can only
 * reference that evidence -> call the LLM -> log the interaction (success
 * OR failure) -> return a response whose `citations` are exactly the
 * evidence handed to the model.
 *
 * MODULE BOUNDARY (ticket AC "No code path in the copilot module can call
 * the command-creation/approval service"): this file, and everything it
 * imports (./grounding, ./prompts, ./repo, ./anthropic), touches only:
 *   - read-only GET calls to the control service via
 *     @/lib/controlService/client's fetchControlService (never the
 *     control-service /v1/commands route, and this app has no client
 *     function that calls it — see src/app/api/ops/control-room/commands/
 *     route.ts's own doc comment)
 *   - this module's own ops_copilot_interactions / ops_shift_report_drafts
 *     tables (src/lib/copilot/repo.ts), via the shared ops Postgres pool
 *   - read-only SELECTs against ops_audit_log / ops_breakdown_reports
 *     (src/lib/copilot/grounding.ts)
 * It never imports src/lib/auth/rbac/repo.ts (createDispatcherAction /
 * consumeDispatcherAction / recordAuditEvent — the command-approval
 * surface), src/app/api/ops/control-room/commands/route.ts, or
 * src/app/api/ops/dispatcher/approvals/route.ts. This is enforced two ways:
 * the eslint `no-restricted-imports` override (see the copilot-scoped block
 * in eslint.config.mjs) and a static source-scan test,
 * src/tests/unit/copilotBoundary.test.ts, that fails the build if any
 * forbidden import specifier appears under this directory.
 */
import 'server-only';
import { generateCopilotText } from './anthropic';
import {
  findOpenIncidentById,
  listOpenIncidentsForGrounding,
  listAuditEventsForGrounding,
  listBreakdownReportsForGrounding,
} from './grounding';
import { buildIncidentExplanationPrompt, buildNlQueryPrompt, buildShiftReportPrompt } from './prompts';
import {
  logCopilotInteraction,
  createShiftReportDraft,
  getShiftReportDraft,
  finalizeShiftReportDraft,
  type FinalizeAction,
} from './repo';
import type {
  ExplainIncidentResponse,
  CopilotQueryResponse,
  ShiftReportDraft,
} from '@/models/copilot';

export class CopilotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopilotUnavailableError';
  }
}

export interface CopilotActor {
  userId: string;
  role: string;
}

export async function explainIncident(
  incidentId: string,
  routeDirectionId: string | undefined,
  actor: CopilotActor,
): Promise<ExplainIncidentResponse> {
  const lookup = await findOpenIncidentById(incidentId, routeDirectionId);
  const relatedAuditEvents = lookup.incident
    ? (await listAuditEventsForGrounding({ limit: 50 })).filter(
        (event) => event.resourceId === incidentId,
      )
    : [];

  const { system, prompt, citations } = buildIncidentExplanationPrompt(lookup.incident, relatedAuditEvents);
  const llmResult = await generateCopilotText({ system, prompt });

  await logCopilotInteraction({
    kind: 'incident_explanation',
    actorUserId: actor.userId,
    actorRole: actor.role,
    incidentId,
    routeDirectionId: routeDirectionId ?? null,
    prompt,
    response: llmResult.ok ? llmResult.text : null,
    sourceRecordIds: citations,
    model: llmResult.ok ? llmResult.model : (process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-5'),
    status: llmResult.ok ? 'ok' : 'error',
    errorMessage: llmResult.ok ? null : llmResult.error,
  });

  if (!llmResult.ok) {
    throw new CopilotUnavailableError(llmResult.error);
  }
  if (lookup.controlServiceUnavailable) {
    throw new CopilotUnavailableError(lookup.unavailableReason ?? 'control service unavailable');
  }

  return {
    incidentId,
    narrative: llmResult.text,
    citations,
    model: llmResult.model,
    generatedAt: new Date().toISOString(),
  };
}

export async function answerCopilotQuery(
  question: string,
  routeDirectionId: string | undefined,
  actor: CopilotActor,
): Promise<CopilotQueryResponse> {
  const [incidents, auditEvents, breakdownReports] = await Promise.all([
    listOpenIncidentsForGrounding(routeDirectionId).catch(() => []),
    listAuditEventsForGrounding({ limit: 30 }),
    listBreakdownReportsForGrounding({ limit: 15 }),
  ]);

  const { system, prompt, citations } = buildNlQueryPrompt(question, incidents, auditEvents, breakdownReports);
  const llmResult = await generateCopilotText({ system, prompt });

  await logCopilotInteraction({
    kind: 'nl_query',
    actorUserId: actor.userId,
    actorRole: actor.role,
    routeDirectionId: routeDirectionId ?? null,
    question,
    prompt,
    response: llmResult.ok ? llmResult.text : null,
    sourceRecordIds: citations,
    model: llmResult.ok ? llmResult.model : (process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-5'),
    status: llmResult.ok ? 'ok' : 'error',
    errorMessage: llmResult.ok ? null : llmResult.error,
  });

  if (!llmResult.ok) {
    throw new CopilotUnavailableError(llmResult.error);
  }

  return {
    answer: llmResult.text,
    citations,
    model: llmResult.model,
    generatedAt: new Date().toISOString(),
  };
}

export interface DraftShiftReportInput {
  shiftLabel: string;
  periodStart: string;
  periodEnd: string;
  routeDirectionId?: string;
}

/**
 * Generates and PERSISTS an AI-drafted shift report. Always returns
 * status='draft' — this function has no way to mark a draft saved/sent;
 * that only happens via finalizeShiftReport, called separately by a human
 * action (ticket AC "require human send/save, never auto-publish").
 */
export async function draftShiftReport(
  input: DraftShiftReportInput,
  actor: CopilotActor,
): Promise<ShiftReportDraft> {
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);

  const [incidents, auditEvents, breakdownReports] = await Promise.all([
    listOpenIncidentsForGrounding(input.routeDirectionId).catch(() => []),
    listAuditEventsForGrounding({ since: periodStart, until: periodEnd, limit: 50 }),
    listBreakdownReportsForGrounding({ since: periodStart, until: periodEnd, limit: 25 }),
  ]);

  const { system, prompt, citations } = buildShiftReportPrompt(
    { shiftLabel: input.shiftLabel, periodStart: input.periodStart, periodEnd: input.periodEnd, routeDirectionId: input.routeDirectionId },
    incidents,
    auditEvents,
    breakdownReports,
  );
  const llmResult = await generateCopilotText({ system, prompt, maxTokens: 1800 });

  await logCopilotInteraction({
    kind: 'shift_report_draft',
    actorUserId: actor.userId,
    actorRole: actor.role,
    routeDirectionId: input.routeDirectionId ?? null,
    prompt,
    response: llmResult.ok ? llmResult.text : null,
    sourceRecordIds: citations,
    model: llmResult.ok ? llmResult.model : (process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-5'),
    status: llmResult.ok ? 'ok' : 'error',
    errorMessage: llmResult.ok ? null : llmResult.error,
  });

  if (!llmResult.ok) {
    throw new CopilotUnavailableError(llmResult.error);
  }

  const content = `[AI-DRAFTED — review before saving or sending]\n\n${llmResult.text}`;

  return createShiftReportDraft({
    shiftLabel: input.shiftLabel,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    routeDirectionId: input.routeDirectionId ?? null,
    content,
    citations,
    createdBy: actor.userId,
  });
}

export async function fetchShiftReportDraft(id: string): Promise<ShiftReportDraft | null> {
  return getShiftReportDraft(id);
}

/** The one and only path that can move a draft out of 'draft' — always attributed to the calling human's ops session. */
export async function finalizeShiftReport(
  id: string,
  action: FinalizeAction,
  actor: CopilotActor,
): Promise<ShiftReportDraft | null> {
  return finalizeShiftReportDraft(id, action, actor.userId);
}
