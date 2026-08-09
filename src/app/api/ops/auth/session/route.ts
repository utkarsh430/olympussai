import { NextResponse } from 'next/server';
import { getOpsSession } from '@/lib/auth/rbac/server';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Safe session-status endpoint. Never returns the raw token, password hash,
 * or session secret — only whether a session is active and, when it is, the
 * role and expiry (mirrors /api/auth/session, the equivalent endpoint for
 * the Supabase-Auth surface).
 *
 * For `driver`/`pilot_driver` sessions, also returns the caller's own
 * admin-assigned `vehicleId`
 * (db/migrations/20260806180000__ops_users_vehicle_assignment.sql), `null`
 * if an admin has not assigned one yet — the read here is scoped to the
 * session's own user row, same as the authorization check in
 * GET /api/ops/pilot-driver/commands and the ack route. Client surfaces
 * (CommandConsole.tsx, DriverDashboard, BreakdownReportPanel) read this
 * instead of trusting a client-self-reported vehicle for anything beyond a
 * same-user convenience default.
 */
export async function GET(): Promise<Response> {
  const session = await getOpsSession();
  if (!session) {
    return NextResponse.json(
      { authenticated: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let vehicleId: string | null | undefined;
  if (session.role === 'pilot_driver' || session.role === 'driver') {
    try {
      const user = await getOpsRepo().findUserById(session.sub);
      vehicleId = user?.vehicleId ?? null;
    } catch (error) {
      // A vehicle-lookup failure should never break session status itself —
      // omit vehicleId and let the caller treat it as "unknown", not fail
      // the whole session check closed. Callers already fall back to the
      // pre-existing self-report convention when this is null or absent.
      if (!(error instanceof OpsDbConfigError)) throw error;
      vehicleId = null;
    }
  }

  return NextResponse.json(
    {
      authenticated: true,
      role: session.role,
      email: session.email,
      expiresAt: new Date(session.exp * 1000).toISOString(),
      ...(vehicleId !== undefined ? { vehicleId } : {}),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
