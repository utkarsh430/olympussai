import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo, decisionStateOf, isDisruptiveActionType, type DispatcherActionDecisionState } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionTypeSchema = z.enum([
  'terminal_dispatch_hold',
  'two_way_hold',
  'self_equalizing_hold',
  'speed_guidance',
  'stop_skip',
  'short_turn',
  'deadhead',
  'boarding_limit',
  'standby_injection',
  'override',
]);

const bodySchema = z.object({
  actionType: actionTypeSchema,
  reason: z.string().trim().min(1).max(2000),
  routeDirectionId: z.string().max(200).optional(),
  vehicleId: z.string().max(200).optional(),
  incidentId: z.string().max(200).optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * The concrete "approval, override" example required by this ticket's audit
 * acceptance criterion: a dispatcher logs a human approval/override decision,
 * attributable to their ops_users row. Creates one ops_dispatcher_actions row
 * plus one ops_audit_log row. This row's id is the future dispatcherActionId
 * a not-yet-built control-service REST client would pass when it sends a
 * command (docs/CONTROL_SERVICE_INTEGRATION.md §1) — issuing that call is out
 * of scope for this ticket; only the logged human decision is in scope.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['dispatcher']);
  if (!guard.ok) return guard.response;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return errorResponse('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.', 415);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Malformed request body.', 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse('INVALID_BODY', 'A valid actionType and reason are required.', 400);
  }

  try {
    const repo = getOpsRepo();
    const action = await repo.createDispatcherAction({
      dispatcherUserId: guard.claims.sub,
      actionType: parsed.data.actionType,
      reason: parsed.data.reason,
      routeDirectionId: parsed.data.routeDirectionId ?? null,
      vehicleId: parsed.data.vehicleId ?? null,
      incidentId: parsed.data.incidentId ?? null,
    });

    // Fail closed: if the audit write fails, the whole request 500s. A
    // dispatcher approval that exists without an audit trail entry is worse
    // than no approval at all for an operational record.
    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: `dispatcher.${parsed.data.actionType === 'override' ? 'override' : 'approval'}.create`,
      resourceType: 'ops_dispatcher_action',
      resourceId: action.id,
      metadata: { actionType: action.actionType, reason: action.reason },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      { ok: true, dispatcherActionId: action.id, createdAt: action.createdAt },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}

const statusQuerySchema = z.enum(['pending', 'approved', 'rejected', 'all']);

/**
 * The approval-queue read model (this ticket's AC: "Approval queue handles
 * disruptive actions ... decisions logged with reason and actor"). Both the
 * dispatcher who files these and the control-room operators who decide them
 * need to see it — dispatcher to track their own submissions, control-room
 * to triage. Defaults to `pending`, scoped to the four disruptive action
 * types named in the AC unless `?disruptiveOnly=false` is passed (control-
 * room's decision history view wants the full picture, e.g. when tracing
 * an incident timeline's "decision" stage regardless of action type).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const guard = await requireOpsRole(['dispatcher', 'control_room']);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const statusParam = statusQuerySchema.safeParse(url.searchParams.get('status') ?? 'pending');
  if (!statusParam.success) {
    return errorResponse('INVALID_QUERY', 'status must be one of pending, approved, rejected, all.', 400);
  }
  const disruptiveOnly = url.searchParams.get('disruptiveOnly') !== 'false';
  const incidentId = url.searchParams.get('incidentId') ?? undefined;

  try {
    const repo = getOpsRepo();
    const status: DispatcherActionDecisionState | undefined =
      statusParam.data === 'all' ? undefined : statusParam.data;
    const actions = await repo.listDispatcherActions({ status, incidentId, limit: 100 });
    const filtered = disruptiveOnly ? actions.filter((a) => isDisruptiveActionType(a.actionType)) : actions;

    return NextResponse.json(
      {
        actions: filtered.map((a) => ({ ...a, decision: decisionStateOf(a) })),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
