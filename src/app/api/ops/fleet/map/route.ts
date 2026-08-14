import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { OpsDbConfigError } from '@/lib/db/pool';
import { resolveOpsFleetScope, DEPOT_SCOPE_DENIAL_RESPONSE } from '@/lib/ops/depotAccess';
import { getOpsMapSnapshot } from '@/lib/ops/mapData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The ops fleet map's refresh endpoint.
 *
 * A map is the one ops surface that cannot be a once-per-render Server
 * Component read: a control-room screen sits open for a whole shift, and
 * vehicles that stop moving on it are worse than no map. So this exists, and
 * because it exists it is the place the depot boundary is most likely to be
 * lost - a polling endpoint that serves the statewide feed and lets the
 * browser filter looks identical in the UI and is completely broken.
 *
 * Two properties keep that from happening, and both are tested in
 * src/tests/unit/opsMapBoundary.test.ts:
 *
 *   1. THE SCOPE IS NEVER IN THE REQUEST. It is derived from the caller's own
 *      ops_users row by resolveOpsFleetScope. There is no `depot` query
 *      parameter to forge, and adding one would be a visible change to this
 *      file rather than a silent widening.
 *   2. THE NARROWING IS SERVER-SIDE. getOpsMapSnapshot returns only the
 *      vehicles the caller owns, so the response body itself carries no other
 *      depot's vehicles. Opening devtools shows an operator exactly what the
 *      map shows them.
 *
 * `routeDirectionId` is optional and is NOT a scoping parameter: it selects
 * which corridor's control-service estimates and bunching incidents to
 * enrich with. A depot caller who passes another corridor's id still gets
 * only their own depot's vehicles, because the enrichment is intersected
 * against their scoped fleet before it is used.
 *
 * `fleet` is this repo's established segment for cross-role ops reads (see
 * GET /api/ops/fleet/schedule and /api/ops/fleet/breakdown-reports).
 */

const querySchema = z.object({
  // A control-service route_directions UUID. Loosely validated as a non-empty
  // bounded string rather than a strict UUID: control-service owns that
  // format, an unknown id simply yields no vehicle states, and a 400 here
  // would be this app asserting a shape it does not define.
  routeDirectionId: z.string().trim().min(1).max(200).optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  // driver and pilot_driver are deliberately absent: a driver's surface is
  // their own vehicle and their own commands, not a fleet map. admin has no
  // operational dashboard. Mirrors the role list on the breakdown-report read.
  const guard = await requireOpsRole(['control_room', 'dispatcher', 'depot', 'planner']);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    routeDirectionId: searchParams.get('routeDirectionId') ?? undefined,
  });
  if (!parsed.success) {
    return errorResponse(
      'INVALID_QUERY',
      parsed.error.issues[0]?.message ?? 'Invalid query parameters.',
      400,
    );
  }

  try {
    const scopeResolution = await resolveOpsFleetScope(guard.claims);
    if (!scopeResolution.ok) {
      // An unassigned depot operator gets a refusal, never the statewide
      // fleet. Failing open here would be the whole boundary.
      const denial = DEPOT_SCOPE_DENIAL_RESPONSE[scopeResolution.reason];
      return errorResponse(denial.code, denial.message, denial.status);
    }

    const snapshot = await getOpsMapSnapshot(scopeResolution.scope, {
      routeDirectionId: parsed.data.routeDirectionId,
    });

    return NextResponse.json(snapshot, {
      status: 200,
      // no-store, not a short max-age: one operator's scoped fleet must never
      // be served to another from any cache in between.
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'The ops datastore is not configured.', 503);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse('MAP_UNAVAILABLE', `Fleet map data is unavailable right now (${message}).`, 503);
  }
}
