/**
 * Server-side ops session resolution for Route Handlers and Server Components.
 *
 * Node runtime (next/headers, `pg`). This module is THE AUTHORITY: it is the
 * only place that decides whether a request has a usable ops session, and it
 * decides it from `ops_users` — never from a token claim alone.
 *
 * THE ORDERING, stated once:
 *
 *   Edge middleware  -> ceiling.   A role read out of a verified token. Fast
 *                                  (no database, no network), stale by up to
 *                                  one access-token lifetime, and blind to
 *                                  whether the account has been disabled.
 *   This module      -> authority. `ops_users.role` and `ops_users.status`,
 *                                  re-read per guarded request.
 *
 * That is the same shape OPS_API_ROLE_OVERRIDES already has with
 * `requireOpsRole` (src/lib/auth/rbac/roles.ts, guard.ts) — the map widens
 * what middleware will let through, the route handler still decides.
 *
 * WHAT IS GENUINELY NEW HERE. Before this change the ops token WAS the whole
 * authority: `getOpsSession()` verified a cookie and returned its claims,
 * with no database read anywhere on the request path. `ops_users.status` was
 * checked only at login, so a disabled operator kept full command authority
 * until their 4h token expired. The per-request profile read below is what
 * closes that, and it is why the read must not be "optimized away" by
 * putting `ops_users.id` and `role` in the token and trusting them.
 *
 * DUAL-ACCEPT DURING THE CUTOVER. Two front doors are accepted:
 *
 *   1. A Supabase Auth session, resolved to an ops profile through
 *      `ops_users.supabase_user_id`.
 *   2. The legacy `olympuss_ops_session` HS256 cookie, resolved through
 *      `ops_users.id`.
 *
 * Both then pass through the SAME authority checks, so the new path can be
 * landed and proven while the old one still works, and rollback is a config
 * change rather than a data restore. `establishOpsSession` /
 * `clearOpsSession` are retained for exactly that reason — they are the
 * rollback lever, not dead code.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { OPS_SESSION_COOKIE, OPS_SESSION_MAX_AGE_SECONDS, isOpsProduction } from './config';
import { createOpsSessionToken, verifyOpsSessionToken, type OpsSessionClaims } from './session';
import { readSupabaseOpsClaim, type SupabaseOpsClaim } from './supabaseClaims';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getOpsRepo, type OpsUserRecord } from './repo';
import type { OpsRole } from './roles';

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isOpsProduction(),
    path: '/',
  };
}

/**
 * Why a session was refused. The distinction matters to callers: `no_session`
 * means "sign in", while the other three mean "you are signed in, but this
 * session cannot be used" — which must send the user back to authenticate
 * rather than to a terminal forbidden page they have no way out of.
 */
export type OpsSessionDenial =
  /** No usable credential on the request at all through either front door. */
  | 'no_session'
  /**
   * Authenticated, but the identity has no linked `ops_users` row. The normal
   * state for an ordinary project viewer, and the transient state for an ops
   * account that has not been linked yet. Not an error — just no ops access.
   */
  | 'no_profile'
  /** Linked profile exists but `ops_users.status` is not 'active'. */
  | 'profile_disabled'
  /**
   * The token's role claim and `ops_users.role` disagree. Denied outright
   * rather than resolved in either direction: the two writers are out of sync
   * and proceeding on either value is guessing. Re-authenticating mints a
   * fresh, correct claim, so this is self-healing, never a lockout.
   */
  | 'role_claim_mismatch';

export type OpsSessionResolution =
  | { ok: true; claims: OpsSessionClaims }
  | { ok: false; reason: OpsSessionDenial };

interface OpsIdentity {
  profile: OpsUserRecord;
  /** Role asserted by the token, or null when the token carries none. */
  roleClaim: OpsRole | null;
  iat: number;
  exp: number;
  supabaseUserId?: string;
}

/** Never throws: an unconfigured or unreachable Supabase means "no Supabase session". */
async function readSupabaseIdentity(): Promise<SupabaseOpsClaim | null> {
  try {
    const supabase = await createSupabaseServerClient();
    return await readSupabaseOpsClaim(supabase);
  } catch {
    return null;
  }
}

async function readLegacyClaims(): Promise<OpsSessionClaims | null> {
  const store = await cookies();
  return verifyOpsSessionToken(store.get(OPS_SESSION_COOKIE)?.value);
}

/**
 * Resolve the current request to an ops profile, or to the specific reason it
 * was refused. This is the function guards should call; `getOpsSession()`
 * below is the claims-or-null wrapper the existing 13 ops pages already use.
 *
 * Fails closed on every path: a thrown database error propagates (a 503 is
 * correct — the authority is unavailable, and promoting the token to sole
 * authority as "graceful degradation" would convert an outage into a
 * privilege-escalation window).
 */
export async function resolveOpsSession(): Promise<OpsSessionResolution> {
  const identity = await resolveIdentity();
  if (!identity.ok) return identity;

  const { profile, roleClaim, iat, exp, supabaseUserId } = identity.identity;

  if (profile.status !== 'active') {
    return { ok: false, reason: 'profile_disabled' };
  }
  if (roleClaim !== null && roleClaim !== profile.role) {
    return { ok: false, reason: 'role_claim_mismatch' };
  }

  return {
    ok: true,
    claims: {
      // Always the ops id, never the Supabase one. See OpsSessionClaims.sub.
      sub: profile.id,
      email: profile.email,
      // The DATABASE decides the role. The claim above is only ever checked
      // for disagreement, never used as the value.
      role: profile.role,
      iat,
      exp,
      ...(supabaseUserId ? { supabaseUserId } : {}),
    },
  };
}

async function resolveIdentity(): Promise<
  { ok: true; identity: OpsIdentity } | { ok: false; reason: OpsSessionDenial }
> {
  const repo = getOpsRepo();

  // The Supabase front door first — it is the intended one.
  const supabaseClaim = await readSupabaseIdentity();
  if (supabaseClaim) {
    const profile = await repo.findUserBySupabaseId(supabaseClaim.supabaseUserId);
    if (profile) {
      return {
        ok: true,
        identity: {
          profile,
          roleClaim: supabaseClaim.roleClaim,
          iat: supabaseClaim.iat,
          exp: supabaseClaim.exp,
          supabaseUserId: supabaseClaim.supabaseUserId,
        },
      };
    }
    // A Supabase session with no linked ops profile does NOT deny outright
    // here: during the cutover the same browser can also hold a valid legacy
    // ops cookie, and that must keep working. Fall through and try it.
  }

  const legacy = await readLegacyClaims();
  if (legacy) {
    const profile = await repo.findUserById(legacy.sub);
    if (!profile) return { ok: false, reason: 'no_profile' };
    return {
      ok: true,
      identity: {
        profile,
        roleClaim: legacy.role,
        iat: legacy.iat,
        exp: legacy.exp,
        ...(profile.supabaseUserId ? { supabaseUserId: profile.supabaseUserId } : {}),
      },
    };
  }

  if (supabaseClaim) return { ok: false, reason: 'no_profile' };
  return { ok: false, reason: 'no_session' };
}

/**
 * The current ops session, or null if there is not a usable one.
 *
 * Unchanged signature, deliberately: every ops page calls
 * `(await getOpsSession())!`. Note what changed BEHIND it — this now reads
 * `ops_users` and returns null for a disabled account, an unlinked identity
 * or a role claim that disagrees with the database, none of which it used to
 * do. Callers that need to tell those apart use `resolveOpsSession()`.
 */
export async function getOpsSession(): Promise<OpsSessionClaims | null> {
  const resolution = await resolveOpsSession();
  return resolution.ok ? resolution.claims : null;
}

/**
 * Create a LEGACY ops session for a specific user and write the HttpOnly
 * cookie. Retained through the cutover: POST /api/ops/auth/login still uses
 * it, and it is the credential path that still works if Supabase Auth is
 * unreachable. Do not delete it before the new front door is proven.
 */
export async function establishOpsSession(user: {
  id: string;
  email: string;
  role: OpsRole;
}): Promise<void> {
  const token = await createOpsSessionToken(user);
  const store = await cookies();
  store.set(OPS_SESSION_COOKIE, token, {
    ...baseCookieOptions(),
    maxAge: OPS_SESSION_MAX_AGE_SECONDS,
  });
}

/** Clear the legacy ops session cookie (logout). Retained, same reason. */
export async function clearOpsSession(): Promise<void> {
  const store = await cookies();
  store.set(OPS_SESSION_COOKIE, '', {
    ...baseCookieOptions(),
    maxAge: 0,
  });
}
