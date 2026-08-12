import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOpsRepo, InviteNotAcceptableError } from '@/lib/auth/rbac/repo';
import { hashInviteToken } from '@/lib/auth/rbac/tokens';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/rbac/passwords';
import {
  OpsIdentityError,
  provisionOpsIdentity,
  releaseOpsIdentity,
} from '@/lib/auth/rbac/opsIdentity';
import { establishOpsSession } from '@/lib/auth/rbac/server';
import { OpsDbConfigError } from '@/lib/db/pool';
import { checkRateLimit, clientIpFrom, recordFailure } from '@/lib/auth/rate-limit';
import { isSameOrigin } from '@/lib/auth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().min(16).max(512),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Consumes a single-use admin-issued invite, provisions the Supabase Auth
 * account the operator will sign in with, and creates the ops_users profile
 * bound to it. The token itself proves possession of the invite (it was
 * emailed to the invited person via the Resend adapter — see
 * docs/olympuss/RBAC.md); there is no separate account to log in with
 * beforehand, by design ("admin-invite only").
 *
 * WHAT CHANGED, AND WHAT DID NOT. The password now goes to Supabase Auth
 * instead of into a bcrypt column, and the new row carries
 * `supabase_user_id` plus an `app_metadata.ops_role` claim from its first
 * token. Everything that made this flow safe is untouched: the raw token is
 * still never stored (only its sha256 digest), expiry, revocation and
 * single-use are still enforced under a row lock inside one transaction,
 * one-live-invite-per-email is still the database's partial unique index,
 * and the acceptance is still audited.
 *
 * THE TWO HALVES ARE ONE ACTION. Provisioning happens inside that same
 * transaction (repo.acceptInvite) and is undone if the database half fails,
 * because the two ways this can half-succeed are both unrecoverable by the
 * person clicking the link: a spent invite with no account to sign into, or
 * an account with no ops profile.
 *
 * The legacy ops session cookie is still issued on success. It is a session,
 * not a credential — the account has no local password — and it is what
 * keeps "accept the invite, land on your dashboard" working while the
 * Supabase sign-in page is still being built. It resolves through exactly
 * the same authority checks as any other session (src/lib/auth/rbac/server.ts).
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

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
    return errorResponse('INVALID_BODY', 'Invalid invite acceptance request.', 400);
  }

  const ip = clientIpFrom(request.headers);
  const rlKey = `ops-invite:${ip}`;
  const preCheck = await checkRateLimit(rlKey);
  if (preCheck.limited) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
      {
        status: 429,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': String(preCheck.retryAfterSeconds) },
      },
    );
  }

  const tokenHash = hashInviteToken(parsed.data.token);

  try {
    const user = await getOpsRepo().acceptInvite({
      tokenHash,
      name: parsed.data.name,
      // The email and role come from the locked invite row, never from the
      // request body — the invitee chooses their name and password, not who
      // they are or what they may do.
      provisionIdentity: ({ email, role }) =>
        provisionOpsIdentity({ email, password: parsed.data.password, role }),
      releaseIdentity: async (supabaseUserId) => {
        const removed = await releaseOpsIdentity(supabaseUserId);
        if (!removed) {
          console.error('[ops/accept-invite] orphaned Supabase identity after failed acceptance', {
            supabaseUserId,
          });
        }
      },
    });

    await getOpsRepo().recordAuditEvent({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'ops_user.invite.accept',
      resourceType: 'ops_user',
      resourceId: user.id,
      ip,
    });

    await establishOpsSession({ id: user.id, email: user.email, role: user.role });

    return NextResponse.json(
      { ok: true, role: user.role, name: user.name },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof InviteNotAcceptableError) {
      await recordFailure(rlKey);
      return errorResponse(
        'INVITE_NOT_ACCEPTABLE',
        'This invite link is invalid or has expired.',
        400,
      );
    }
    if (error instanceof OpsIdentityError) {
      // The invite is untouched — the transaction rolled back — so every one
      // of these is retryable once the underlying problem is fixed.
      if (error.failure === 'email_already_registered') {
        // Rate-limited like a bad token: this response distinguishes "an
        // account exists for this address" from "your link is invalid", and
        // an invite token is emailed, not guessed, so the only party who
        // should ever see it is the invitee.
        await recordFailure(rlKey);
        return errorResponse(
          'IDENTITY_ALREADY_EXISTS',
          'A sign-in account already exists for this email address. Ask your administrator ' +
            'to link it to your operational access instead of issuing a new invite.',
          409,
        );
      }
      if (error.failure === 'not_configured') {
        return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
      }
      console.error('[ops/accept-invite] identity provisioning failed', {
        failure: error.failure,
        message: error.message,
      });
      return errorResponse(
        'IDENTITY_PROVISIONING_FAILED',
        'Your account could not be created right now. Your invite is still valid — please try again.',
        502,
      );
    }
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
