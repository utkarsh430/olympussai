import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getRolloutStageAudit } from '@/lib/controlService/pilotData';
import { ControlServiceConfigError, ControlServiceRequestError, ControlServiceUnavailableError } from '@/lib/controlService/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid('id must be a valid route-direction UUID') });

/**
 * GET /api/ops/admin/rollout-stages/:id/audit
 *
 * Admin-only stage-change history for one route-direction (ticket AC4:
 * "stage changes ... audit-logged and visible without waiting for
 * day-end"). Reads directly from control-service's rollout_stage_audit_log
 * — always current, no polling/day-end delay.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireOpsRole(['admin']);
  if (!guard.ok) return guard.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'Invalid route-direction id.' } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const auditLog = await getRolloutStageAudit(parsedParams.data.id);
    return NextResponse.json(
      { routeDirectionId: parsedParams.data.id, auditLog },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ControlServiceConfigError || error instanceof ControlServiceUnavailableError) {
      return NextResponse.json(
        { error: { code: 'CONTROL_SERVICE_UNAVAILABLE', message: error.message } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (error instanceof ControlServiceRequestError) {
      return NextResponse.json(
        { error: { code: error.code ?? 'CONTROL_SERVICE_ERROR', message: error.message } },
        { status: error.status ?? 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }
}
