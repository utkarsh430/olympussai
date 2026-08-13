import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/admin/depots
 *
 * The depot registry (ops_depots), for the admin user-management screen's
 * depot picker. Admin-only, and read-only: the registry is populated by
 * scripts/seed-ops-depots.mjs from the live feed, not through the API — a
 * depot exists because vehicles report it, and letting an admin invent one
 * by hand would create depots that can own nothing while looking like a
 * valid assignment.
 *
 * `code` is returned alongside `name` because it is the value the boundary
 * actually matches on; showing it lets an admin confirm they are assigning
 * the depot they mean when two names look alike (e.g. SAHARANPUR(A) versus
 * SAHARANPUR).
 */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['admin']);
  if (!guard.ok) return guard.response;

  try {
    const depots = await getOpsRepo().listDepots();
    return NextResponse.json(
      {
        depots: depots.map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
        })),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return NextResponse.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Ops authentication is not configured.' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }
}
