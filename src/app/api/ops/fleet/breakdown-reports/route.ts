import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo, BREAKDOWN_REPORT_CURSOR_PATTERN } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { resolveOpsFleetScope, DEPOT_SCOPE_DENIAL_RESPONSE } from '@/lib/ops/depotAccess';
import { getOpsFleetSnapshot } from '@/lib/ops/fleetData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const categorySchema = z.enum(['Mechanical', 'Electrical', 'Tyre/wheel', 'Accident', 'Other']);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  // Opaque `<createdAt>_<id>` keyset cursor from a previous page's
  // nextCursor — see BreakdownReportListFilter.before's doc comment
  // (src/lib/auth/rbac/repo.ts) for why a bare ISO datetime can't tell rows
  // sharing a created_at apart.
  before: z.string().regex(BREAKDOWN_REPORT_CURSOR_PATTERN, 'Invalid pagination cursor').optional(),
  category: categorySchema.optional(),
  vehicleReg: z.string().trim().min(1).max(50).optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Fleet-wide breakdown-report read surface. The write path (POST
 * /api/ops/driver/breakdown-reports, 20260806120000__ops_breakdown_reports.sql)
 * has existed with no GET anywhere — the only consumer was Copilot LLM
 * grounding (src/lib/copilot/grounding.ts), so a dispatcher/control-room/
 * depot operator had no way to see a filed report except by asking the
 * copilot a question. `fleet` is this repo's established segment for
 * cross-role ops reads (see GET /api/ops/fleet/schedule); depot is included
 * deliberately — a broken bus goes to a depot.
 *
 * Keyset-paginated via repo.listBreakdownReports (order by created_at desc,
 * id desc): pass the previous page's `nextCursor` back as `?before=` to
 * continue. `limit` follows the same clamp-to-1-200 idiom as
 * listDispatcherActions in src/lib/auth/rbac/repo.ts.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const guard = await requireOpsRole(['control_room', 'dispatcher', 'depot']);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: searchParams.get('limit') ?? undefined,
    before: searchParams.get('before') ?? undefined,
    category: searchParams.get('category') ?? undefined,
    vehicleReg: searchParams.get('vehicleReg') ?? undefined,
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
      const denial = DEPOT_SCOPE_DENIAL_RESPONSE[scopeResolution.reason];
      return errorResponse(denial.code, denial.message, denial.status);
    }
    const { scope } = scopeResolution;

    const repo = getOpsRepo();
    const { items, nextCursor } = await repo.listBreakdownReports({
      limit: parsed.data.limit,
      before: parsed.data.before,
      category: parsed.data.category,
      vehicleReg: parsed.data.vehicleReg,
    });

    // A depot caller sees only breakdowns on their own depot's vehicles
    // (db/migrations/20260812150000__ops_depot_ownership.sql). Membership is
    // decided against that caller's own scoped live fleet, the same list
    // their roster is drawn from, so the two can never disagree.
    //
    // Two honest consequences of scoping a self-reported field, both chosen
    // over the alternative:
    //  * A report whose vehicleReg matches no vehicle currently reporting -
    //    a typo, or a bus whose GPS is dark - is shown to NO depot. That is
    //    the fail-closed direction: a missed repair ticket is visible and
    //    recoverable, whereas defaulting an unattributable report into every
    //    depot's list would put one depot's incidents in another's queue.
    //  * Filtering happens after the keyset page is read, so a page can come
    //    back shorter than `limit`, or empty, while nextCursor still points
    //    at more rows. That is already how this cursor works (keep following
    //    nextCursor until it is null); it is not an "end of list" signal.
    const scopedItems =
      scope.kind === 'all'
        ? items
        : await (async () => {
            const fleet = await getOpsFleetSnapshot(scope);
            const owned = new Set(
              fleet.buses.map((bus) => bus.registrationNumber.trim().toUpperCase()),
            );
            return items.filter((item) => owned.has(item.vehicleReg.trim().toUpperCase()));
          })();

    // Fleet-wide view: a depot/dispatcher/control-room operator needs to
    // know WHO reported a breakdown to route a repair, never their email -
    // built explicitly (not spread) so a future field on BreakdownReportListItem
    // does not silently leak into this response by default.
    const reports = scopedItems.map((item) => ({
      id: item.id,
      driverUserId: item.driverUserId,
      vehicleReg: item.vehicleReg,
      category: item.category,
      description: item.description,
      createdAt: item.createdAt,
      reporterName: item.reporterName,
    }));

    return NextResponse.json(
      { reports, nextCursor },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
