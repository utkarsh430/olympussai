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

const paramsSchema = z.object({ id: z.string().uuid() });

const bodySchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * POST /api/ops/control-room/approvals/:id/reject — the approval queue's
 * "reject" decision (this ticket's AC: "decisions logged with reason and
 * actor"). The other terminal decision, "approve", is already covered by
 * issuing a command that consumes this same dispatcherActionId (POST
 * /api/ops/control-room/commands) — that consumption *is* the approval,
 * already attributed and reasoned via that endpoint's own audit write.
 * This endpoint only adds the missing alternative: reject outright, with
 * no command ever created, still attributed and reasoned the same way.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return errorResponse('INVALID_BODY', 'Invalid dispatcher action id.', 400);
  }

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
    return errorResponse('INVALID_BODY', 'A reason is required.', 400);
  }

  try {
    const repo = getOpsRepo();
    const rejected = await repo.rejectDispatcherAction({
      id: parsedParams.data.id,
      rejectedBy: guard.claims.sub,
      reason: parsed.data.reason,
    });

    if (!rejected) {
      return errorResponse(
        'ACTION_NOT_PENDING',
        'This action no longer exists or has already been approved or rejected.',
        409,
      );
    }

    // Fail closed, same reasoning as the approval path: a rejection without
    // an audit trail entry is worse than no rejection at all.
    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'control_room.approval.reject',
      resourceType: 'ops_dispatcher_action',
      resourceId: rejected.id,
      metadata: { actionType: rejected.actionType, reason: parsed.data.reason },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      { ok: true, dispatcherActionId: rejected.id, rejectedAt: rejected.rejectedAt },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
