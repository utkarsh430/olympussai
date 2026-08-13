import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { revokeOpsIdentity } from '@/lib/auth/rbac/opsIdentity';
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
 * DISABLE HAS TO REACH EVERY SURFACE THE ACCOUNT CAN STILL REACH.
 *
 *   ops_users.status   Revokes THIS PRODUCT, both surfaces. Re-read on every
 *                      guarded request by `resolveOpsSession()` — which now
 *                      gates /project/* and /api/upsrtc/* as well as /ops/*
 *                      — so the account is refused on its very next request
 *                      through either front door, whatever token it is still
 *                      holding. This is what makes a disable immediate.
 *   app_metadata       The ceiling Edge middleware checks. Cleared so the
 *                      disabled account stops carrying an ops role in its
 *                      tokens at all, and cannot even reach an ops route to
 *                      be refused by the guard.
 *   ban_duration       Revokes the SIGN-IN IDENTITY itself, which neither of
 *                      the above touches. A Supabase account is a credential
 *                      against the Supabase project, not just against this
 *                      app: unbanned, a fired operator keeps a working
 *                      sign-in and keeps renewing tokens by refresh forever.
 *                      It is also the standing backstop for the profile gate
 *                      on the enterprise surface — which is exactly the check
 *                      that was missing until recently.
 *                      `revokeOpsIdentity` writes it with the claim clear in
 *                      one call; see that function for the measured effect of
 *                      a ban on an already-issued token, and for the residual
 *                      it cannot close.
 *
 * THE ORDER IS DELIBERATE, AND IT IS THE OPPOSITE OF THE ROLE-ASSIGNMENT
 * PATH. There, a claim write that fails must roll the database change back,
 * because half an assignment locks the operator out. Here, the database
 * write already revokes the ops surface, so failing the disable because the
 * identity write did not land would leave the account fully active — trading
 * a partial revocation for no revocation at all. The status write therefore
 * commits first and the identity revocation is best effort, with its outcome
 * recorded in the audit event and returned to the caller rather than
 * swallowed. When it does fail, the response says plainly that enterprise
 * access is still live, because that is a fact an admin has to act on.
 *
 * WHAT THIS STILL DOES NOT DO: end an in-flight Supabase session by session
 * id. @supabase/auth-js 2.112.2 exposes no administrator path to another
 * user's sessions (`admin.signOut` needs that user's own JWT; there is no
 * session list or delete). It does not need to. Every guarded request in this
 * product re-reads `ops_users` and refuses; a ban stops the identity ever
 * obtaining another token. What neither reaches is a purely LOCAL signature
 * check of a token already issued — in this app that is only the Edge
 * ceiling, which is never a decision. `revokeOpsIdentity` documents the
 * measured bound.
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

    // The OPS surface is revoked at this point. Everything below is what
    // takes the enterprise surface and the token ceiling with it.
    //
    // `identityRevoked` replaces the earlier `claimCleared` field, which
    // named only half of what this step now does. Audit rows written before
    // this change keep the old key; nothing reads either one programmatically.
    let identityRevoked: boolean | null = null;
    let identityRevokeError: string | null = null;
    if (updated.supabaseUserId) {
      try {
        await revokeOpsIdentity(updated.supabaseUserId);
        identityRevoked = true;
      } catch (error) {
        identityRevoked = false;
        identityRevokeError = error instanceof Error ? error.message : 'Unknown error.';
        console.error('[ops/admin/users/disable] could not revoke the sign-in identity', {
          opsUserId: updated.id,
          supabaseUserId: updated.supabaseUserId,
          error: identityRevokeError,
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
        // null = nothing to revoke (never linked to a Supabase identity).
        identityRevoked,
        ...(identityRevokeError ? { identityRevokeError } : {}),
      },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      {
        ok: true,
        id: updated.id,
        status: updated.status,
        identityRevoked,
        ...(identityRevoked === false
          ? {
              warning:
                'Access is revoked — every request from this account is now refused, on the ' +
                'operations console and the project surface alike. Their Supabase sign-in ' +
                'identity could NOT be revoked, so the account itself still exists and can ' +
                'still be used against the Supabase project directly. Re-run this action, or ' +
                'ban the user in the Supabase dashboard (Authentication -> Users), to close it.',
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
