import { NextResponse } from 'next/server';
import { getOpsSession } from '@/lib/auth/rbac/server';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Safe session-status endpoint. Never returns the raw token, password hash,
 * or session secret — only whether a session is active and, when it is, the
 * role and expiry (mirrors /api/auth/session for the PIN system).
 *
 * For the `pilot_driver` role, also returns the caller's own admin-assigned
 * `vehicleId` (db/migrations/20260806180000__ops_users_vehicle_assignment.sql)
 * so the driver PWA (CommandConsole.tsx) can display/poll for it without
 * ever letting the client self-report a vehicle — the read here is scoped
 * to the session's own user row, same as the authorization check in
 * GET /api/ops/pilot-driver/commands and the ack route.
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
      // the whole session check closed.
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
