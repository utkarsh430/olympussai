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

// `vehicleId` is nullable so an admin can explicitly unassign a driver
// (e.g. before disabling them or reassigning them elsewhere) — omitting the
// field entirely is a validation error, not treated as "leave unchanged",
// so the request body always states the caller's full intent.
const bodySchema = z.object({
  vehicleId: z.string().trim().min(1).max(200).nullable(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * POST /api/ops/admin/users/:id/vehicle
 *
 * Admin-only assignment of a driver/pilot_driver to a vehicle
 * (db/migrations/20260806180000__ops_users_vehicle_assignment.sql). This is
 * the ONLY write path to ops_users.vehicle_id outside of invite-time
 * assignment (repo.acceptInvite) — no driver-facing route may set their own
 * vehicle_id, which is the property that makes
 * GET /api/ops/pilot-driver/commands and POST
 * /api/ops/pilot-driver/commands/:id/ack safe to trust the session's own
 * user row for authorization instead of a client-supplied vehicleId (A01
 * fix, see this ticket). It is also the authoritative replacement for the
 * self-reported-vehicle-registration-in-localStorage convention that
 * DriverDashboard's schedule lookup and BreakdownReportPanel now read from
 * via GET /api/ops/auth/session's `vehicleId`, and it already has an admin
 * UI panel calling it (src/components/ops/OpsAdminInvitesPanel.tsx).
 */
export async function POST(
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
    return errorResponse('INVALID_BODY', 'Invalid user id.', 400);
  }
  const targetId = parsedParams.data.id;

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
    return errorResponse('INVALID_BODY', 'vehicleId (string or null) is required.', 400);
  }

  try {
    const repo = getOpsRepo();
    const target = await repo.findUserById(targetId);
    if (!target) {
      return errorResponse('NOT_FOUND', 'User not found.', 404);
    }

    const updated = await repo.setUserVehicle(targetId, parsed.data.vehicleId);
    if (!updated) {
      return errorResponse('NOT_FOUND', 'User not found.', 404);
    }

    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'admin.user.vehicle_assign',
      resourceType: 'ops_user',
      resourceId: updated.id,
      metadata: { email: updated.email, vehicleId: updated.vehicleId },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      { ok: true, id: updated.id, vehicleId: updated.vehicleId },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
