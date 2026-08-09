import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { isSameOrigin } from '@/lib/auth/origin';
import { explainIncidentRequestSchema } from '@/models/copilot';
import { explainIncident, CopilotUnavailableError } from '@/lib/copilot/service';
import { recordCopilotCall } from '@/lib/copilot/rateLimit';
import { OpsDbConfigError } from '@/lib/db/pool';
import { ControlServiceConfigError } from '@/lib/controlService/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * POST /api/ops/control-room/copilot/explain — LLM-grounded narrative for
 * one currently-open bunching incident (ticket AC "Explanations grounded in
 * stored incident evidence"). Read-only against both the control service
 * and this app's own datastore; the only write is the audit log row
 * src/lib/copilot/service.ts's explainIncident makes via
 * ops_copilot_interactions.
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

  const parsed = explainIncidentRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse('INVALID_BODY', 'incidentId is required.', 400);
  }

  const rateLimit = await recordCopilotCall(guard.claims.sub);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many copilot requests. Please wait before trying again.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const result = await explainIncident(parsed.data.incidentId, parsed.data.routeDirectionId, {
      userId: guard.claims.sub,
      role: guard.claims.role,
    });
    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Copilot audit storage is not configured.', 503);
    }
    if (error instanceof ControlServiceConfigError) {
      return errorResponse('CONTROL_SERVICE_UNAVAILABLE', error.message, 502);
    }
    if (error instanceof CopilotUnavailableError) {
      return errorResponse('COPILOT_UNAVAILABLE', error.message, 503);
    }
    throw error;
  }
}
