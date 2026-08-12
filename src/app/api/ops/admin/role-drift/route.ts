import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { findOpsRoleDrift } from '@/lib/auth/rbac/roleDrift';
import { OpsIdentityError } from '@/lib/auth/rbac/opsIdentity';
import { OpsDbConfigError } from '@/lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/admin/role-drift
 *
 * Admin-only. Lists every ops profile whose database role disagrees with the
 * role stored on its Supabase identity — the one failure mode of the
 * two-store role design that produces no error anywhere until an operator
 * cannot sign in.
 *
 * Read-only. The repair is POST /api/ops/admin/users/:id/role with the role
 * the database already holds, which re-pushes the claim as an ordinary
 * audited assignment. See src/lib/auth/rbac/roleDrift.ts for why this does
 * not repair anything itself.
 *
 * A route rather than a script because it needs the same admin session, the
 * same repository and the same service-role credential every other admin
 * surface already has, and because the answer is only useful to someone who
 * can act on it — which is exactly who is already signed in here.
 */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['admin']);
  if (!guard.ok) return guard.response;

  try {
    const report = await findOpsRoleDrift();
    return NextResponse.json(report, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return NextResponse.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Ops authentication is not configured.' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (error instanceof OpsIdentityError && error.failure === 'not_configured') {
      return NextResponse.json(
        {
          error: {
            code: 'NOT_CONFIGURED',
            message: 'Supabase Auth is not configured, so token claims cannot be read.',
          },
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }
}
