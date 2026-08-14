import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { fetchVehicleArrivals } from '@/lib/controlService/arrivals';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Upcoming stops returned to the driver. Enough for the next stretch, not the whole working. */
const STOP_LIMIT = 6;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * GET /api/ops/pilot-driver/arrivals
 *
 * Per-stop arrival prediction for the caller's OWN bus.
 *
 * ─── OWNERSHIP ───────────────────────────────────────────────────────────
 *
 * The vehicle is read from the caller's own `ops_users` row (set only by an
 * admin), exactly as GET /api/ops/pilot-driver/commands does. No client-supplied
 * `vehicleId` is accepted at all - not as a query parameter, not as a header.
 * A driver's own arrival times are a per-vehicle read, and a per-vehicle read
 * that takes an id from the client is an enumeration endpoint for the whole
 * state fleet. The depot boundary is preserved for free by this: a driver can
 * only ever name one vehicle, their own.
 *
 * ─── WHY A FAILURE IS NOT AN EMPTY PREDICTION ────────────────────────────
 *
 * When the control service cannot be reached, this returns 503 rather than a
 * synthesised `status: 'unavailable'` envelope. Those two are different facts -
 * "the control service looked and could not predict this bus" versus "nobody
 * looked" - and collapsing them would let an outage read on a driver's screen
 * as a calm, normal "no arrival times right now".
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

    const arrivals = await fetchVehicleArrivals(user.vehicleId, { limit: STOP_LIMIT });
    return NextResponse.json(arrivals, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    if (error instanceof ControlServiceConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Control service is not configured.', 503);
    }
    if (error instanceof ControlServiceUnavailableError) {
      return errorResponse(
        'CONTROL_SERVICE_UNAVAILABLE',
        'Arrival times are unavailable because the control service cannot be reached.',
        503,
      );
    }
    if (error instanceof ControlServiceRequestError) {
      return errorResponse('CONTROL_SERVICE_ERROR', error.message, error.status ?? 502);
    }
    throw error;
  }
}
