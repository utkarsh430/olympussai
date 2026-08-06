/**
 * Persistence for the copilot module's own tables
 * (db/migrations/20260806140000__ops_copilot.sql): ops_copilot_interactions
 * (the audit log of every LLM call) and ops_shift_report_drafts (AI-drafted
 * shift reports, human-finalized). Uses this app's own ops Postgres pool
 * (src/lib/db/pool.ts) directly — deliberately NOT src/lib/auth/rbac/repo.ts,
 * which is where createDispatcherAction/consumeDispatcherAction (the
 * command-approval path) live; see src/lib/copilot/service.ts's boundary
 * comment and src/tests/unit/copilotBoundary.test.ts.
 */
import 'server-only';
import { getOpsPool } from '@/lib/db/pool';
import type { CopilotSourceCitation, ShiftReportDraft, ShiftReportStatus } from '@/models/copilot';

export type CopilotInteractionKind = 'incident_explanation' | 'shift_report_draft' | 'nl_query';

export interface LogCopilotInteractionInput {
  kind: CopilotInteractionKind;
  actorUserId: string;
  actorRole: string;
  incidentId?: string | null;
  routeDirectionId?: string | null;
  question?: string | null;
  prompt: string;
  response: string | null;
  sourceRecordIds: CopilotSourceCitation[];
  model: string;
  status: 'ok' | 'error';
  errorMessage?: string | null;
}

/**
 * Writes one row to ops_copilot_interactions. Called for EVERY copilot LLM
 * call, success or failure (ticket AC "LLM prompts/responses touching
 * incident data logged for audit") — src/lib/copilot/service.ts calls this
 * from a `finally`-equivalent path so a thrown error never skips the log
 * write. The table is append-only at the database level (trigger in the
 * migration), so this function has no corresponding update/delete.
 */
export async function logCopilotInteraction(
  input: LogCopilotInteractionInput,
): Promise<{ id: string; createdAt: string }> {
  const pool = getOpsPool();
  const { rows } = await pool.query(
    `insert into ops_copilot_interactions
       (kind, actor_user_id, actor_role, incident_id, route_direction_id, question, prompt, response, source_record_ids, model, status, error_message)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning id, created_at`,
    [
      input.kind,
      input.actorUserId,
      input.actorRole,
      input.incidentId ?? null,
      input.routeDirectionId ?? null,
      input.question ?? null,
      input.prompt,
      input.response,
      JSON.stringify(input.sourceRecordIds),
      input.model,
      input.status,
      input.errorMessage ?? null,
    ],
  );
  return { id: String(rows[0].id), createdAt: new Date(rows[0].created_at as string).toISOString() };
}

export interface CreateShiftReportDraftInput {
  shiftLabel: string;
  periodStart: string;
  periodEnd: string;
  routeDirectionId?: string | null;
  content: string;
  citations: CopilotSourceCitation[];
  createdBy: string;
}

function mapDraftRow(row: Record<string, unknown>): ShiftReportDraft {
  return {
    id: String(row.id),
    shiftLabel: String(row.shift_label),
    periodStart: new Date(row.period_start as string).toISOString(),
    periodEnd: new Date(row.period_end as string).toISOString(),
    routeDirectionId: row.route_direction_id ? String(row.route_direction_id) : null,
    content: String(row.content),
    aiDrafted: true,
    citations: (row.source_record_ids ?? []) as CopilotSourceCitation[],
    status: row.status as ShiftReportStatus,
    createdAt: new Date(row.created_at as string).toISOString(),
    savedAt: row.saved_at ? new Date(row.saved_at as string).toISOString() : null,
    sentAt: row.sent_at ? new Date(row.sent_at as string).toISOString() : null,
  };
}

/**
 * Inserts a new draft. Deliberately takes no `status` parameter — every
 * draft is created 'draft'/ai_drafted=true (the column defaults, and the
 * migration's CHECK constraints make anything else at INSERT time
 * impossible), so "never auto-publish" cannot be bypassed by a caller
 * passing the wrong flag.
 */
export async function createShiftReportDraft(input: CreateShiftReportDraftInput): Promise<ShiftReportDraft> {
  const pool = getOpsPool();
  const { rows } = await pool.query(
    `insert into ops_shift_report_drafts
       (shift_label, period_start, period_end, route_direction_id, content, source_record_ids, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      input.shiftLabel,
      input.periodStart,
      input.periodEnd,
      input.routeDirectionId ?? null,
      input.content,
      JSON.stringify(input.citations),
      input.createdBy,
    ],
  );
  return mapDraftRow(rows[0]);
}

export async function getShiftReportDraft(id: string): Promise<ShiftReportDraft | null> {
  const pool = getOpsPool();
  const { rows } = await pool.query('select * from ops_shift_report_drafts where id = $1 limit 1', [id]);
  return rows[0] ? mapDraftRow(rows[0]) : null;
}

export type FinalizeAction = 'save' | 'send';

/**
 * Advances a draft from 'draft' to 'saved' or 'sent' — the ONLY write path
 * that can ever change a draft's status, and only when called from
 * POST /api/ops/control-room/copilot/shift-reports/[id]/finalize, which
 * requires an authenticated ops session (a human) on every call. Atomic
 * `UPDATE ... WHERE status = 'draft'` so two concurrent finalize calls
 * cannot both succeed. Returns null if the draft does not exist or was
 * already finalized (never silently overwrites a prior finalize).
 */
export async function finalizeShiftReportDraft(
  id: string,
  action: FinalizeAction,
  actorUserId: string,
): Promise<ShiftReportDraft | null> {
  const pool = getOpsPool();
  const nextStatus: ShiftReportStatus = action === 'save' ? 'saved' : 'sent';
  const column = action === 'save' ? 'saved' : 'sent';

  const { rows } = await pool.query(
    `update ops_shift_report_drafts
        set status = $1, ${column}_by = $2, ${column}_at = now()
      where id = $3 and status = 'draft'
      returning *`,
    [nextStatus, actorUserId, id],
  );
  return rows[0] ? mapDraftRow(rows[0]) : null;
}
