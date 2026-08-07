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
  summary: z.string().trim().min(1).max(2000),
  dispatcherActionId: z.string().uuid(),
  targetType: z.enum(['vehicle', 'route_direction', 'trip']),
  targetId: z.string().min(1).max(200),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * The concrete "command" example required by this ticket's audit acceptance
 * criterion: a control-room user issues a command, attributable to their
 * ops_users row, and required to reference an existing dispatcherActionId
 * (an ops_dispatcher_actions row created via POST /api/ops/dispatcher/approvals)
 * — mirrors the non-negotiable dispatcher-authorization rule in
 * docs/CONTROL_SERVICE_INTEGRATION.md §1 ("no operational action without a
 * valid, unconsumed dispatcherActionId") at this app's own audit layer.
 * Actually dispatching the command to the control service is out of scope —
 * no control-service REST client exists yet (see that doc, §6).
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
    return errorResponse(
      'INVALID_BODY',
      'A summary, dispatcherActionId, targetType and targetId are required.',
      400,
    );
  }

  try {
    const repo = getOpsRepo();

    // This ticket's kill-switch AC: "immediately halt new automatic
    // commands ... both logged". This endpoint is this app's one real
    // command-creation gate today (no control-service REST client that
    // actually dispatches a command exists yet — see this file's other
    // doc comment below), so it is the enforcement point. Network-wide
    // always applies; the route-scoped switch only applies when the
    // command targets that same route-direction directly — a
    // vehicle/trip-targeted command cannot be resolved to a
    // route-direction without a lookup this app doesn't have, so only the
    // network-wide switch blocks those (documented, not silently assumed).
    const routeDirectionId = parsed.data.targetType === 'route_direction' ? parsed.data.targetId : null;
    const activeKillSwitches = await repo.getActiveKillSwitches(routeDirectionId);
    const [blocking] = activeKillSwitches;
    if (blocking) {
      return errorResponse(
        'KILL_SWITCH_ENGAGED',
        blocking.scope === 'network'
          ? 'A network-wide kill switch is engaged; no new commands can be authorized.'
          : `A kill switch is engaged for route-direction ${blocking.routeDirectionId}; no new commands can be authorized for it.`,
        409,
      );
    }

    // Non-negotiable per docs/CONTROL_SERVICE_INTEGRATION.md §1: no command
    // without a valid, unconsumed dispatcherActionId. consumeDispatcherAction
    // is an atomic UPDATE ... WHERE consumed_at IS NULL, so a raced double
    // consumption of the same approval is impossible.
    const consumed = await repo.consumeDispatcherAction(parsed.data.dispatcherActionId);
    if (!consumed) {
      return errorResponse(
        'DISPATCHER_ACTION_INVALID',
        'dispatcherActionId does not reference a valid, unconsumed approval.',
        409,
      );
    }

    // Fail closed: an audited command must have exactly one attribution row.
    const { id, createdAt } = await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'control_room.command.create',
      resourceType: 'command',
      resourceId: parsed.data.dispatcherActionId,
      metadata: {
        summary: parsed.data.summary,
        targetType: parsed.data.targetType,
        targetId: parsed.data.targetId,
      },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      { ok: true, auditEventId: id, createdAt },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
