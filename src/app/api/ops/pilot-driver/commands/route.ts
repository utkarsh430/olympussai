import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
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
 * GET /api/ops/pilot-driver/commands?vehicleId=<reg>
 *
 * The driver PWA's poll for "the one active command" (AC1). `vehicleId` is
 * the driver's self-reported vehicle registration, the same convention
 * src/components/ops/driver/DriverDashboard.tsx already uses for schedule
 * lookup — this RBAC schema still has no driver-to-vehicle assignment (see
 * that component's own comment). Restricted to the `pilot_driver` role
 * (AC4: "delivered only to RBAC-provisioned pilot driver accounts").
 *
 * Response is always 200 with `{ command: Command | null }`, even when
 * nothing is active — "no active command" is a normal state for a poll
 * endpoint, not an error.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const guard = await requireOpsRole(['pilot_driver']);
  if (!guard.ok) return guard.response;

  const vehicleId = request.nextUrl.searchParams.get('vehicleId')?.trim();
  if (!vehicleId) {
    return errorResponse('INVALID_QUERY', 'vehicleId query parameter is required.', 400);
  }

  try {
    const command = await fetchActiveCommandForVehicle(vehicleId);
    return NextResponse.json({ command }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
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
