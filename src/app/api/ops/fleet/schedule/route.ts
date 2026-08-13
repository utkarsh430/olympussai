import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { OPERATIONAL_ROLES } from '@/lib/auth/rbac/roles';
import { isValidRegistrationNumber } from '@/lib/upsrtc/client';
import { getOpsFleetSnapshot, getOpsVehicleSchedule } from '@/lib/ops/fleetData';
import { resolveOpsFleetScope, DEPOT_SCOPE_DENIAL_RESPONSE } from '@/lib/ops/depotAccess';
import { OpsDbConfigError } from '@/lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only vehicle schedule lookup backing the depot/planner "schedule
 * view" and the driver "own schedule" dashboard content (this ticket's
 * acceptance criteria). Not an audited-action endpoint — it never mutates
 * anything, so it doesn't write to ops_audit_log the way
 * POST /api/ops/dispatcher/approvals and POST /api/ops/control-room/commands
 * do; those two remain the only audited actions per this ticket's scope.
 *
 * Any of the operational roles may call this: a driver looks up their own
 * vehicle, planner/dispatcher/control-room look up any vehicle in the fleet
 * they're coordinating.
 *
 * A `depot` CALLER IS SCOPED TO THEIR OWN DEPOT
 * (db/migrations/20260812150000__ops_depot_ownership.sql). This is the route
 * that made the depot boundary meaningful or meaningless: `regNum` is a
 * client-supplied vehicle, so a depot operator who could pass any
 * registration could read any depot's roster straight from the API, whatever
 * their dashboard showed them. The check below derives the caller's depot
 * from their own ops_users row and refuses a registration outside it — which
 * is why scoping the page alone would have been theatre.
 */
const querySchema = z.object({
  regNum: z
    .string()
    .min(4)
    .max(16)
    .refine(isValidRegistrationNumber, { message: 'Malformed registration number' }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional(),
  tripId: z.string().min(1).max(32).optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const guard = await requireOpsRole(OPERATIONAL_ROLES);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    regNum: searchParams.get('regNum') ?? '',
    date: searchParams.get('date') ?? undefined,
    tripId: searchParams.get('tripId') ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      'INVALID_QUERY',
      parsed.error.issues[0]?.message ?? 'A valid regNum is required.',
      400,
    );
  }

  try {
    const scopeResolution = await resolveOpsFleetScope(guard.claims);
    if (!scopeResolution.ok) {
      const denial = DEPOT_SCOPE_DENIAL_RESPONSE[scopeResolution.reason];
      return errorResponse(denial.code, denial.message, denial.status);
    }

    const { scope } = scopeResolution;
    if (scope.kind === 'depot') {
      // Membership is decided against the live fleet, the only place a
      // vehicle's depot is known. `getOpsFleetSnapshot(scope)` already
      // contains exactly this caller's vehicles, so "is this registration
      // mine" is a lookup in it rather than a second, separately-reasoned
      // rule that could drift from the roster the operator sees.
      const fleet = await getOpsFleetSnapshot(scope);
      const normalizedReg = parsed.data.regNum.toUpperCase();
      const owned = fleet.buses.some((bus) => bus.registrationNumber.toUpperCase() === normalizedReg);
      if (!owned) {
        // Deliberately the same answer for "that bus belongs to another
        // depot" and "no such bus": telling them apart would turn this
        // endpoint into an oracle for enumerating other depots' fleets, which
        // is a smaller version of the leak being closed. 404, not 403,
        // because from inside this caller's scope the vehicle does not exist.
        return errorResponse(
          'VEHICLE_NOT_IN_DEPOT',
          'No such vehicle in your depot.',
          404,
        );
      }
    }

    const result = await getOpsVehicleSchedule(parsed.data.regNum, parsed.data.date, parsed.data.tripId ?? null);

    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
