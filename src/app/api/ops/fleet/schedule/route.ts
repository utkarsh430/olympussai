import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { OPERATIONAL_ROLES } from '@/lib/auth/rbac/roles';
import { isValidRegistrationNumber } from '@/lib/upsrtc/client';
import { getOpsVehicleSchedule } from '@/lib/ops/fleetData';

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
 * Any of the five operational roles may call this: a driver looks up their
 * own vehicle, depot/planner/dispatcher/control-room look up any vehicle in
 * the fleet they're coordinating.
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

  const result = await getOpsVehicleSchedule(parsed.data.regNum, parsed.data.date, parsed.data.tripId ?? null);

  return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
