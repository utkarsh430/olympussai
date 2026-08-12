import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const categorySchema = z.enum(['Mechanical', 'Electrical', 'Tyre/wheel', 'Accident', 'Other']);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().datetime().optional(),
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
    const repo = getOpsRepo();
    const { items, nextCursor } = await repo.listBreakdownReports({
      limit: parsed.data.limit,
      before: parsed.data.before,
      category: parsed.data.category,
      vehicleReg: parsed.data.vehicleReg,
    });

    return NextResponse.json(
      { reports: items, nextCursor },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
