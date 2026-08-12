import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { clearOpsRoleClaim } from '@/lib/auth/rbac/opsIdentity';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Disable an ops user (revoke access without deleting the audit history
 * attributed to them). Admin-only; refuses an admin disabling their own
 * account when they are the last active admin, so a tenant can never lock
 * itself out of invite management.
 *
 * DISABLE HAS TO REACH BOTH AUTH PATHS NOW.
 *
 *   ops_users.status   The revocation. Re-read on every guarded request by
 *                      `resolveOpsSession()`, so the account is refused on
 *                      its very next request through either front door,
 *                      whatever token it is still holding. This is what
 *                      makes a disable immediate.
 *   app_metadata       The ceiling Edge middleware checks. Cleared here so
 *                      the disabled account stops carrying an ops role in
 *                      its tokens at all, and cannot even reach an ops route
 *                      to be refused by the guard.
 *
 * THE ORDER IS DELIBERATE, AND IT IS THE OPPOSITE OF THE ROLE-ASSIGNMENT
 * PATH. There, a claim write that fails must roll the database change back,
 * because half an assignment locks the operator out. Here, the database
 * write alone ALREADY fully revokes access, so failing the disable because
 * the second write did not land would leave the account active — trading a
 * stale, harmless ceiling for a genuinely live session. The status write
 * therefore commits first and the claim clear is best effort, with its
 * outcome recorded in the audit event and returned to the caller rather than
 * swallowed.
 *
 * WHAT THIS DOES NOT DO: end the user's Supabase session. @supabase/auth-js
 * 2.112.2 exposes no way for an administrator to revoke another user's
 * sessions (`admin.signOut` needs that user's own JWT; there is no session
 * list or delete). An already-issued access token therefore stays
 * cryptographically valid until it expires — which is precisely why the
 * per-request `ops_users` read is the disable mechanism and not an
 * optimisation anyone may remove.
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

  try {
    const repo = getOpsRepo();
    const target = await repo.findUserById(targetId);
    if (!target) {
      return errorResponse('NOT_FOUND', 'User not found.', 404);
    }

    if (target.role === 'admin' && target.status === 'active') {
      const adminCount = await repo.countAdmins();
      if (adminCount <= 1) {
        return errorResponse('LAST_ADMIN', 'Cannot disable the last active admin account.', 409);
      }
    }

    const updated = await repo.disableUser(targetId, guard.claims.sub);
    if (!updated) {
      return errorResponse('NOT_FOUND', 'User not found.', 404);
    }

    // Access is already revoked at this point. Everything below is about the
    // token side catching up.
    let claimCleared: boolean | null = null;
    let claimClearError: string | null = null;
    if (updated.supabaseUserId) {
      try {
        await clearOpsRoleClaim(updated.supabaseUserId);
        claimCleared = true;
      } catch (error) {
        claimCleared = false;
        claimClearError = error instanceof Error ? error.message : 'Unknown error.';
        console.error('[ops/admin/users/disable] could not clear the ops role claim', {
          opsUserId: updated.id,
          supabaseUserId: updated.supabaseUserId,
          error: claimClearError,
        });
      }
    }

    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'admin.user.disable',
      resourceType: 'ops_user',
      resourceId: updated.id,
      metadata: {
        disabledEmail: updated.email,
        disabledRole: updated.role,
        // null = nothing to clear (never linked to a Supabase identity).
        claimCleared,
        ...(claimClearError ? { claimClearError } : {}),
      },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      {
        ok: true,
        id: updated.id,
        status: updated.status,
        claimCleared,
        ...(claimCleared === false
          ? {
              warning:
                'Access is revoked — every request from this account is now refused. The role ' +
                'claim on their sign-in identity could not be cleared; re-run this action, or ' +
                'clear it in the Supabase dashboard, so it does not linger there.',
            }
          : {}),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
