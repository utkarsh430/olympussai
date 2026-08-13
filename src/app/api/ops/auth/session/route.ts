import { NextResponse } from 'next/server';
import { resolveOpsSession } from '@/lib/auth/rbac/server';
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
 *
 * "NOT SIGNED IN" AND "CANNOT TELL" ARE DIFFERENT ANSWERS. This used to
 * report both as a flat 200 `{ authenticated: false }`, because the resolver
 * behind it collapsed every refusal into null. Once the ops profile table
 * became the authority, that made a transient ops-database failure
 * indistinguishable from a signed-out operator — the console would quietly
 * report a driver as having no assigned vehicle in the middle of an outage,
 * which is a statement about the fleet, not about the database. An unreadable
 * authority is now a 503 that says so, and callers that check the status get
 * an honest "unknown" instead of a confident wrong answer.
 */
export async function GET(): Promise<Response> {
  const resolution = await resolveOpsSession();
  if (!resolution.ok) {
    const unavailable = resolution.reason === 'unavailable';
    return NextResponse.json(
      // `authenticated: false` is kept on the outage response so an existing
      // caller reading only that field is no worse off than before; the
      // status code and flag are what let a caller tell the two apart.
      unavailable ? { authenticated: false, unavailable: true } : { authenticated: false },
      { status: unavailable ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const session = resolution.claims;

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
