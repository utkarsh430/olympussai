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
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { opsRoleClaimInAccessToken, syncOpsRoleClaimForSignIn } from '@/lib/auth/opsClaimSync';
import { landingUrl, resolveLanding } from '@/lib/auth/landing';
import { OpsDbConfigError } from '@/lib/db/pool';
import { checkRateLimit, clientIpFrom, recordFailure } from '@/lib/auth/rate-limit';
import { isSameOrigin } from '@/lib/auth/origin';
import type { OpsUserRecord } from '@/lib/auth/rbac/repo';

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
 * Sign the newly created operator in, and report whether the Edge gate can
 * actually see their role — which is the one thing that decides whether an
 * `/ops/*` destination may be nominated for them at all.
 *
 * Called only AFTER the acceptance has committed, so it never decides whether
 * the invite succeeded; it decides what the successful invitee walks away
 * holding. Never throws, for that reason: at this point the invite is spent
 * and the account exists, and the only question left is which session they
 * get, not whether they get one.
 *
 * The return value feeds `resolveLanding`'s `opsClaimReady`, so it must be
 * true only when the ceiling is genuinely in place, by either door:
 *
 *   Supabase  the access token that was just minted carries
 *             `app_metadata.ops_role`. `provisionOpsIdentity` sets that claim
 *             at creation and asserts it landed, so the first token should
 *             already have it — the sync below is the belt-and-braces repair
 *             for the case where it somehow did not, and it verifies against
 *             the token itself rather than the absence of an error.
 *   legacy    the HS256 ops cookie, which `resolveOpsEdgeCeiling` accepts on
 *             its own (src/lib/auth/rbac/edgeSession.ts). Also a real
 *             ceiling, so also `true` — reporting false here would send an
 *             operator who is holding a perfectly good session to an
 *             "access pending" explanation that is not true of them.
 *
 * False means neither door produced a ceiling. That is not a lockout: the
 * landing decision degrades to an explanation on `/login`, and the password
 * they just chose works there.
 */
async function establishInviteSession(user: OpsUserRecord, password: string): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      // The invite's own address, off the committed row — never the request
      // body, which is the same rule provisioning follows.
      email: user.email,
      password,
    });

    if (error || !data.user || !data.session) {
      // Deliberately not `error.message`: it can name the address. The
      // failure is a server-side operational fact, not something to leak.
      console.error('[ops/accept-invite] the new account could not be signed in', {
        opsUserId: user.id,
        status: (error as { status?: unknown } | null)?.status,
        code: (error as { code?: unknown } | null)?.code,
      });
      return await fallBackToLegacySession(user);
    }

    if (opsRoleClaimInAccessToken(data.session.access_token) === user.role) return true;
    return await syncOpsRoleClaimForSignIn(supabase, data.user.id, user.role);
  } catch (error) {
    // An unconfigured or unreachable Supabase. `provisionOpsIdentity` needed
    // the service-role key to get this far, so the realistic case is a
    // missing anon key or an Auth outage between the two calls.
    console.error('[ops/accept-invite] could not open a Supabase session for the new account', error);
    return await fallBackToLegacySession(user);
  }
}

/** Never throws: the acceptance has already committed and must still answer 200. */
async function fallBackToLegacySession(user: OpsUserRecord): Promise<boolean> {
  try {
    await establishOpsSession({ id: user.id, email: user.email, role: user.role });
    return true;
  } catch (error) {
    console.error('[ops/accept-invite] could not issue a fallback ops session either', error);
    return false;
  }
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
 * WHICH SESSION THE NEW OPERATOR LEAVES WITH, and why that had to change.
 * This route used to finish by calling `establishOpsSession` — the LEGACY
 * HS256 ops cookie — for an account it had just given a Supabase identity
 * and no local password at all. So the one path that creates brand-new
 * operators was the one path that never produced a Supabase session, and
 * every operator onboarded through it was minted straight into the world the
 * cutover is dismantling: their only credential lived in Supabase Auth, and
 * their only session did not. The moment the legacy door is deleted they
 * would have had no session at all, and until then they were carrying a
 * 4-hour cookie whose expiry was the first thing they would ever hit.
 *
 * It now signs them in through the same front door everybody else uses —
 * `signInWithPassword` with the password they just chose — so the cookies
 * they leave with are Supabase's, the token carries their `ops_role` claim
 * from the very first request, and `resolveLanding` picks the destination
 * instead of the browser guessing at it.
 *
 * THE LEGACY COOKIE SURVIVES ONLY AS A DEGRADED FALLBACK. The invite is
 * single-use and, by the time the sign-in runs, already spent: the identity
 * exists, the profile exists, and the transaction has committed. If Supabase
 * Auth then refuses or cannot be reached, refusing here would strand a real
 * operator behind a link that can never be clicked again. So a legacy
 * session is issued instead and the failure is logged loudly. It grants
 * nothing extra — it resolves through exactly the same per-request authority
 * checks as any other session (src/lib/auth/rbac/server.ts) — and it goes
 * away with the rest of the legacy door at the cutover. The account is
 * recoverable regardless: its password is in Supabase Auth, so `/login`
 * works on the next attempt.
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

    const decision = resolveLanding({
      opsRole: user.role,
      opsClaimReady: await establishInviteSession(user, parsed.data.password),
    });

    return NextResponse.json(
      // `role` is retained alongside `redirectTo` only so an older cached
      // bundle keeps working against a newer server. The SERVER picks the
      // destination; see src/lib/auth/landing.ts.
      { ok: true, role: user.role, name: user.name, redirectTo: landingUrl(decision) },
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
