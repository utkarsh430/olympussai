import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';
import { fetchActiveCommandForVehicle, acknowledgeCommand } from '@/lib/controlService/commands';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  vehicleId: z.string().trim().min(1).max(200),
  outcome: z.enum(['accept', 'unable', 'unsafe']),
  reason: z.string().trim().min(1).max(2000).nullable().optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * POST /api/ops/pilot-driver/commands/:id/ack
 *
 * The driver PWA's single-tap ACK/UNABLE/UNSAFE (AC2). All three outcomes
 * take the identical path here and at control-service
 * (control-service/src/db/commands.ts#acknowledgeCommand) — there is no
 * penalty/scoring parameter anywhere in this call, satisfying "no penalty
 * applied" for `unable`/`unsafe` by construction, not by a conditional that
 * could be gotten wrong.
 *
 * Ownership check (A01): `vehicleId` in the body must match the command's
 * own `vehicleId` at control-service, re-derived from a fresh
 * fetchActiveCommandForVehicle call rather than trusted from the client —
 * a driver can only ack the command actually active for the vehicle they
 * queried. This is still bounded by the same limitation
 * DriverDashboard.tsx already documents: `vehicleId` itself is
 * driver-self-reported, because this RBAC schema has no driver-to-vehicle
 * assignment yet. Filed as follow-up work (see ticket comment) rather than
 * solved here — adding that assignment is a schema change affecting every
 * driver-scoped endpoint, not just this one.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['pilot_driver']);
  if (!guard.ok) return guard.response;

  const { id: commandId } = await params;

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
    return errorResponse('INVALID_BODY', 'A vehicleId and outcome (accept/unable/unsafe) are required.', 400);
  }

  try {
    const active = await fetchActiveCommandForVehicle(parsed.data.vehicleId);
    if (!active || active.id !== commandId) {
      return errorResponse(
        'COMMAND_NOT_ACTIVE',
        'This command is no longer the active command for that vehicle (already acked, superseded, or expired).',
        409,
      );
    }

    const command = await acknowledgeCommand(commandId, {
      outcome: parsed.data.outcome,
      reason: parsed.data.reason ?? null,
      actorId: guard.claims.sub,
    });

    // Fail closed: if the audit write fails, the whole request 500s — an
    // ack that exists without an audit trail entry is worse than no ack.
    const repo = getOpsRepo();
    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'pilot_driver.command.ack',
      resourceType: 'command',
      resourceId: commandId,
      metadata: { outcome: parsed.data.outcome, vehicleId: parsed.data.vehicleId },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json({ ok: true, command }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    if (error instanceof ControlServiceConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Control service is not configured.', 503);
    }
    if (error instanceof ControlServiceUnavailableError) {
      return errorResponse('CONTROL_SERVICE_UNAVAILABLE', 'Control service is temporarily unavailable.', 503);
    }
    if (error instanceof ControlServiceRequestError) {
      return errorResponse('CONTROL_SERVICE_ERROR', error.message, error.status ?? 502);
    }
    throw error;
  }
}
