import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { fetchActiveCommandForVehicle } from '@/lib/controlService/commands';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * GET /api/ops/pilot-driver/commands
 *
 * The driver PWA's poll for "the one active command" (AC1). Restricted to
 * the `pilot_driver` role (AC4: "delivered only to RBAC-provisioned pilot
 * driver accounts").
 *
 * Ownership check (A01 fix): the vehicle to poll for is read from the
 * caller's OWN ops_users row (guard.claims.sub -> repo.findUserById), set
 * only by an admin (db/migrations/20260806180000__ops_users_vehicle_assignment.sql,
 * POST /api/ops/admin/users/:id/vehicle). A client-supplied vehicleId is no
 * longer accepted at all — previously any `pilot_driver` account could pass
 * an arbitrary `?vehicleId=` and observe another vehicle's commands, since
 * this RBAC schema had no driver-to-vehicle assignment to check against.
 *
 * Response is always 200 with `{ command: Command | null }` once a vehicle
 * is assigned — "no active command" is a normal state for a poll endpoint,
 * not an error. A driver with no vehicle assigned yet gets a distinct 409
 * so the client can show "contact your admin" instead of silently polling
 * forever.
 */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['pilot_driver']);
  if (!guard.ok) return guard.response;

  try {
    const user = await getOpsRepo().findUserById(guard.claims.sub);
    if (!user || !user.vehicleId) {
      return errorResponse(
        'VEHICLE_NOT_ASSIGNED',
        'No vehicle is assigned to your account yet. Contact your admin.',
        409,
      );
    }

    const command = await fetchActiveCommandForVehicle(user.vehicleId);
    return NextResponse.json({ command }, { headers: { 'Cache-Control': 'no-store' } });
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
