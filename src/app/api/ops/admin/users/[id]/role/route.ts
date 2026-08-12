import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsIdentityError, pushOpsRoleClaim } from '@/lib/auth/rbac/opsIdentity';
import { OPS_ROLES } from '@/lib/auth/rbac/roles';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ role: z.enum(OPS_ROLES) });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * POST /api/ops/admin/users/:id/role
 *
 * Change an operator's role. Until now the only way a role was ever set was
 * at invite time (repo.acceptInvite copies it off the invite row), so an
 * admin who needed to move someone between roles had to disable the account
 * and re-invite them. This is the first surface that changes one in place —
 * and it is also the first place where a role has to be written to two
 * stores at once.
 *
 * THE DUAL WRITE. `ops_users.role` is the authority: FK-linked, audited, and
 * re-read on every guarded request. `app_metadata.ops_role` is the ceiling
 * that Edge middleware checks without a database. `resolveOpsSession()`
 * refuses any session whose claim disagrees with the database, in both
 * directions, so the two must never be left diverged. They are written as
 * one transaction: the claim write runs before commit, and its failure rolls
 * the database change back rather than leaving the account in a state where
 * every request is refused until the operator signs in again.
 *
 * A FAILED ASSIGNMENT IS STILL AUDITED. The rollback undoes the role change;
 * it does not undo the fact that an admin attempted it and the system could
 * not carry it out. `ops_audit_log` is append-only by trigger, so the
 * failure is recorded as its own event, after the rollback, naming which
 * half failed. An admin retrying a "nothing happened" 502 three times leaves
 * three records, which is the correct reading of what occurred.
 *
 * REASSIGNING THE SAME ROLE IS NOT A NO-OP, on purpose: it re-pushes the
 * claim, which is the repair action for anything GET
 * /api/ops/admin/role-drift reports.
 *
 * AN UNLINKED ACCOUNT HAS NO CLAIM TO WRITE. Accounts created before the
 * auth systems were collapsed still have `supabase_user_id = null` and sign
 * in through the legacy cookie, whose role comes from the token minted at
 * login. For those the database write is the whole assignment, and the audit
 * record says so rather than implying a claim was written.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['admin']);
  if (!guard.ok) return guard.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return errorResponse('INVALID_BODY', 'Invalid user id.', 400);
  }
  const targetId = parsedParams.data.id;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return errorResponse('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.', 415);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Malformed request body.', 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse('INVALID_BODY', 'A valid role is required.', 400);
  }
  const nextRole = parsed.data.role;

  const repo = getOpsRepo();
  const ip = clientIpFrom(request.headers);

  let target;
  try {
    target = await repo.findUserById(targetId);
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
  if (!target) {
    return errorResponse('NOT_FOUND', 'User not found.', 404);
  }

  // Same protection the disable route carries, for the same reason: an admin
  // demoting the last active admin locks the tenant out of invite and role
  // management with no way back in through the product.
  if (target.role === 'admin' && target.status === 'active' && nextRole !== 'admin') {
    const adminCount = await repo.countAdmins();
    if (adminCount <= 1) {
      return errorResponse(
        'LAST_ADMIN',
        'Cannot change the role of the last active admin account.',
        409,
      );
    }
  }

  const previousRole = target.role;
  // Set inside the transaction from the LOCKED row, not from the read above:
  // a backfill could link this account in between, and the audit record must
  // describe what actually happened rather than what was true a moment
  // earlier.
  let claimTarget: string | null = null;

  try {
    const updated = await repo.assignUserRole({
      id: targetId,
      role: nextRole,
      commitClaim: async (user) => {
        if (!user.supabaseUserId) return;
        claimTarget = user.supabaseUserId;
        await pushOpsRoleClaim(user.supabaseUserId, nextRole);
      },
    });

    if (!updated) {
      return errorResponse('NOT_FOUND', 'User not found.', 404);
    }

    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'admin.user.role_assign',
      resourceType: 'ops_user',
      resourceId: updated.id,
      metadata: {
        email: updated.email,
        previousRole,
        role: updated.role,
        // Distinguishes "both stores were written" from "there was only one
        // store to write". Without it, a reader cannot tell an unlinked
        // account from a claim write that was silently skipped.
        claimWritten: claimTarget !== null,
        supabaseUserId: claimTarget,
      },
      ip,
    });

    return NextResponse.json(
      {
        ok: true,
        id: updated.id,
        role: updated.role,
        previousRole,
        claimWritten: claimTarget !== null,
        // Their existing tokens still carry the old role, and a claim that
        // disagrees with the database is refused. Signing in again mints a
        // correct one. Surfaced so an admin UI can say so instead of the
        // operator discovering it as a mysterious sign-out.
        requiresReauth: previousRole !== updated.role,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsIdentityError) {
      // The role change is already rolled back. Record the attempt, then say
      // plainly that nothing was applied.
      await repo
        .recordAuditEvent({
          actorUserId: guard.claims.sub,
          actorRole: guard.claims.role,
          action: 'admin.user.role_assign_failed',
          resourceType: 'ops_user',
          resourceId: targetId,
          metadata: {
            email: target.email,
            role: previousRole,
            attemptedRole: nextRole,
            failure: error.failure,
            reason: error.message,
            rolledBack: true,
          },
          ip,
        })
        .catch((auditError: unknown) => {
          // Never mask the real failure with the failure to record it.
          console.error('[ops/admin/users/role] could not audit a failed assignment', auditError);
        });

      const status = error.failure === 'not_configured' ? 503 : 502;
      return errorResponse(
        'ROLE_CLAIM_WRITE_FAILED',
        'The role was not changed. The sign-in provider could not be updated, and applying ' +
          'only half of the change would have locked this operator out.',
        status,
      );
    }
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
