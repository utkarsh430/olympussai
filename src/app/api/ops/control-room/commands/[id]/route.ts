import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { ControlServiceConfigError, ControlServiceRequestError, ControlServiceUnavailableError, fetchControlService } from '@/lib/controlService/client';
import { commandAuditResponseSchema } from '@/models/control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * GET /api/ops/control-room/commands/:id — read-only proxy of
 * control-service's GET /v1/commands/:id/audit (this ticket's incident
 * timeline "ack"/"outcome" stages: the audit log is the sole source of
 * truth for command lifecycle reconstruction — see that endpoint's own
 * doc comment in control-service/src/routes/commands.ts). This app has no
 * link yet from its own ops_dispatcher_actions to a control-service
 * commandId (no REST client that actually dispatches a command exists —
 * docs/CONTROL_SERVICE_INTEGRATION.md), so a control-room operator who
 * knows a commandId (e.g. from a test dispatch, or once that client ships)
 * pastes it in to inspect that command's lifecycle here.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return errorResponse('INVALID_REQUEST', 'id must be a valid UUID.', 400);
  }

  try {
    const raw = await fetchControlService(`/v1/commands/${encodeURIComponent(parsedParams.data.id)}/audit`);
    const parsed = commandAuditResponseSchema.parse(raw);
    return NextResponse.json(parsed, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ControlServiceRequestError && error.status === 404) {
      return errorResponse('COMMAND_NOT_FOUND', 'No command found with that id.', 404);
    }
    if (error instanceof ControlServiceConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Control service is not configured.', 503);
    }
    if (error instanceof ControlServiceUnavailableError || error instanceof ControlServiceRequestError) {
      return errorResponse('CONTROL_SERVICE_UNAVAILABLE', error.message, 502);
    }
    throw error;
  }
}
