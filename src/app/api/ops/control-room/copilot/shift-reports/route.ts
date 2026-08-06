import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { isSameOrigin } from '@/lib/auth/origin';
import { shiftReportDraftRequestSchema } from '@/models/copilot';
import { draftShiftReport, CopilotUnavailableError } from '@/lib/copilot/service';
import { recordCopilotCall } from '@/lib/copilot/rateLimit';
import { OpsDbConfigError } from '@/lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * POST /api/ops/control-room/copilot/shift-reports — generates AND persists
 * an AI-drafted shift-report handoff (ticket AC "Shift-report drafts
 * labelled AI-drafted, require human send/save, never auto-publish"). The
 * response is always status='draft' — there is no parameter this endpoint
 * accepts that can mark it saved/sent; that is a separate, explicit human
 * action (POST .../shift-reports/[id]/finalize).
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

  const parsed = shiftReportDraftRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      'INVALID_BODY',
      'shiftLabel, periodStart and periodEnd (ISO 8601) are required.',
      400,
    );
  }

  if (new Date(parsed.data.periodEnd).getTime() < new Date(parsed.data.periodStart).getTime()) {
    return errorResponse('INVALID_BODY', 'periodEnd must not be before periodStart.', 400);
  }

  const rateLimit = recordCopilotCall(guard.claims.sub);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many copilot requests. Please wait before trying again.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const draft = await draftShiftReport(parsed.data, {
      userId: guard.claims.sub,
      role: guard.claims.role,
    });
    return NextResponse.json(draft, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Copilot storage is not configured.', 503);
    }
    if (error instanceof CopilotUnavailableError) {
      return errorResponse('COPILOT_UNAVAILABLE', error.message, 503);
    }
    throw error;
  }
}
