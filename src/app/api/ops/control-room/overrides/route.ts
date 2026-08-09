import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  dispatcherActionId: z.string().uuid(),
  summary: z.string().trim().min(1).max(2000),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Records a dispatcher 'override' decision. Deliberately does NOT call the
 * control service.
 *
 * An override means a human acted outside the automated control set — held a
 * bus by radio, sent a driver on a route change, made a call the nine modelled
 * action types do not describe. There is no command to issue, because the
 * thing already happened outside the system; the attributable audit record IS
 * the deliverable, and it must exist whether or not the control service is
 * reachable.
 *
 * Why 'override' is not simply added to the command path: control-service's
 * `commands.action_type` CHECK constraint enumerates the nine real levers
 * (control-service/db/migrations/20260805190000__core_data_model.sql).
 * Widening it would let an unmodelled action reach applyHardSafetyFilter,
 * which switches on actionType and has no 'override' case — i.e. it would
 * pass through the safety filter unexamined. The constraint stays as it is.
 *
 * Uses the same claim -> mark-dispatched two-phase flow as the command path
 * so an override approval moves through exactly one terminal transition and
 * a failed audit write leaves it retryable rather than burned.
 * control_service_command_id stays NULL, which is the durable marker that
 * this approval was recorded rather than dispatched.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['control_room']);
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
    return errorResponse('INVALID_BODY', 'A dispatcherActionId and summary are required.', 400);
  }
  const body = parsed.data;

  try {
    const repo = getOpsRepo();

    const approval = await repo.findDispatcherAction(body.dispatcherActionId);
    if (!approval) {
      return errorResponse(
        'DISPATCHER_ACTION_INVALID',
        'dispatcherActionId does not reference a valid, unconsumed approval.',
        409,
      );
    }
    if (approval.actionType !== 'override') {
      return errorResponse(
        'APPROVAL_MISMATCH',
        `Approval ${approval.id} authorizes ${approval.actionType}, not an override. Issue it via POST /api/ops/control-room/commands.`,
        422,
      );
    }

    const claimed = await repo.claimDispatcherAction(body.dispatcherActionId, guard.claims.sub);
    if (!claimed) {
      return errorResponse(
        'DISPATCHER_ACTION_INVALID',
        'dispatcherActionId does not reference a valid, unconsumed approval, or another dispatch is already in flight for it.',
        409,
      );
    }

    // Fail closed: the audit record is the entire point of an override, so if
    // it cannot be written the override is not recorded at all. Releasing the
    // claim first keeps the approval retryable instead of burning it on an
    // infrastructure failure.
    let auditEventId: string;
    let createdAt: string;
    try {
      const event = await repo.recordAuditEvent({
        actorUserId: guard.claims.sub,
        actorRole: guard.claims.role,
        action: 'control_room.override.record',
        resourceType: 'ops_dispatcher_action',
        resourceId: approval.id,
        metadata: {
          dispatcherActionId: body.dispatcherActionId,
          actionType: approval.actionType,
          vehicleId: approval.vehicleId,
          routeDirectionId: approval.routeDirectionId,
          reason: approval.reason,
          summary: body.summary,
        },
        ip: clientIpFrom(request.headers),
      });
      auditEventId = event.id;
      createdAt = event.createdAt;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await repo.releaseDispatcherActionClaim(body.dispatcherActionId, message).catch(() => undefined);
      throw error;
    }

    // Null commandId: an override never becomes a control-service command.
    await repo.markDispatcherActionDispatched(body.dispatcherActionId, null);

    return NextResponse.json(
      { ok: true, dispatcherActionId: approval.id, auditEventId, createdAt },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
