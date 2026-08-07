import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';
import { submitIncidentReviewRequestSchema } from '@/models/control';
import { submitIncidentReview } from '@/lib/controlService/pilotData';
import { ControlServiceConfigError, ControlServiceRequestError, ControlServiceUnavailableError } from '@/lib/controlService/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ incidentId: z.string().uuid('incidentId must be a valid UUID') });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * PUT /api/ops/control-room/pilot/war-room/:incidentId
 *
 * War room records/revises an incident's classification (eligible /
 * exogenous / structural), action taken, and outcome (ticket AC3).
 * `reviewedBy` is always this request's own authenticated control-room
 * identity, never taken from the request body — same rule as
 * /api/ops/admin/rollout-stages/:id's `changedBy`. Also writes this app's
 * own ops_audit_log, matching every other privileged control-room action.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ incidentId: string }> },
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return errorResponse('INVALID_BODY', 'Invalid incident id.', 400);
  }
  const incidentId = parsedParams.data.incidentId;

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

  const parsed = submitIncidentReviewRequestSchema.omit({ reviewedBy: true }).safeParse(raw);
  if (!parsed.success) {
    return errorResponse('INVALID_BODY', 'classification (and optional actionTaken/outcome) are required.', 400);
  }

  try {
    const incident = await submitIncidentReview(incidentId, guard.claims.email, parsed.data);

    await getOpsRepo().recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'control_room.incident_review.submit',
      resourceType: 'bunching_incident',
      resourceId: incidentId,
      metadata: { classification: parsed.data.classification },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json({ incident }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
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
