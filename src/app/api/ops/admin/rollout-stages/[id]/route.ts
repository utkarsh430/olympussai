import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';
import { setRolloutStageRequestSchema } from '@/models/control';
import { setRolloutStage } from '@/lib/controlService/pilotData';
import { ControlServiceConfigError, ControlServiceRequestError, ControlServiceUnavailableError } from '@/lib/controlService/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid('id must be a valid route-direction UUID') });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * PUT /api/ops/admin/rollout-stages/:id
 *
 * Admin sets a route-direction's pilot rollout stage (ticket AC1). Proxies
 * to control-service's PUT /v1/route-directions/:id/rollout-stage, which
 * takes effect on the very next command it evaluates — no deploy, no
 * restart (control-service/src/pilot/gate.ts reads the table directly).
 * `changedBy` is always this request's own authenticated admin identity,
 * never taken from the request body — the admin cannot attribute a stage
 * change to anyone else.
 *
 * Also writes this app's own ops_audit_log (ticket AC4: "stage changes ...
 * audit-logged"), on top of control-service's own rollout_stage_audit_log
 * (the source of truth the gate itself reasons about) — same
 * correlated-not-shared pattern as ops_dispatcher_actions <->
 * control-service's dispatcher_actions (Crewban-4/Crewban-9 handoffs).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['admin']);
  if (!guard.ok) return guard.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return errorResponse('INVALID_BODY', 'Invalid route-direction id.', 400);
  }
  const routeDirectionId = parsedParams.data.id;

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

  const parsed = setRolloutStageRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse('INVALID_BODY', 'stage (and optional reason) are required.', 400);
  }

  try {
    const rolloutStage = await setRolloutStage(routeDirectionId, guard.claims.email, parsed.data);

    await getOpsRepo().recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'admin.rollout_stage.set',
      resourceType: 'route_direction',
      resourceId: routeDirectionId,
      metadata: { stage: parsed.data.stage, reason: parsed.data.reason ?? null },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json({ rolloutStage }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    if (error instanceof ControlServiceConfigError) {
      return errorResponse('CONTROL_SERVICE_NOT_CONFIGURED', 'Control service is not configured.', 503);
    }
    if (error instanceof ControlServiceUnavailableError) {
      return errorResponse('CONTROL_SERVICE_UNAVAILABLE', 'Control service is unavailable right now.', 503);
    }
    if (error instanceof ControlServiceRequestError) {
      return errorResponse(error.code ?? 'CONTROL_SERVICE_ERROR', error.message, error.status && error.status >= 400 && error.status < 500 ? error.status : 502);
    }
    throw error;
  }
}
