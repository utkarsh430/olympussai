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
 *
 * ONE ANSWER PER REQUEST, AND WHY IT IS A CORRECTNESS PROPERTY. While this
 * was a pure token decode it was deterministic and free, so it did not
 * matter how many times a request asked. It is now a database read, and a
 * page renders its layout guard and its body CONCURRENTLY — two independent
 * reads of a table an admin can change at any moment. When they disagreed
 * (an operator disabled or re-roled mid-render) the guard redirected while
 * the body carried on with a null session, which is how every ops dashboard
 * could answer a routine admin action with HTTP 500. `resolveOpsSession` is
 * therefore wrapped in React `cache()`: one resolution per request, shared
 * by the guard and everything downstream of it, so a mid-render change
 * cannot split a single render's view of who the caller is. It also halves
 * the profile reads a guarded page pays. `cache()` is request-scoped — it is
 * NOT a cross-request cache and must never be replaced by one, or a disabled
 * account would keep working until the cache expired.
 *
 * MEMOISATION IS NOT THE WHOLE FIX. No caller may assume a non-null session
 * because some earlier caller checked: the guarantee is "the same answer",
 * never "an answer you may assert on". Pages take their session from
 * `requireOpsRolePage` (pageGuard.ts), which redirects on refusal.
 */
import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { OPS_SESSION_COOKIE, OPS_SESSION_MAX_AGE_SECONDS, isOpsProduction } from './config';
import { createOpsSessionToken, verifyOpsSessionToken, type OpsSessionClaims } from './session';
import { readSupabaseOpsClaim, type SupabaseOpsClaim } from './supabaseClaims';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getOpsRepo, type OpsUserRecord } from './repo';
import { isAuthDisabled, previewClaimsFor } from '@/lib/auth/publicPreview';
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
  | 'role_claim_mismatch'
  /**
   * The AUTHORITY ITSELF could not be read — the ops database is unreachable,
   * unconfigured, or timed out.
   *
   * Deliberately its own reason rather than being folded into `no_session`.
   * The four reasons above are all statements about the CALLER, and every one
   * of them is answered by "sign in again". This one is a statement about
   * this service, and sending an operator to a sign-in page during an ops
   * database outage tells them a lie about their own account, invites them to
   * retype credentials that will not help, and buries the one fact an
   * operations console must never bury: the console is down, not you. It is
   * also, on its own, a bounce with nothing at the end of it, since signing in
   * again lands on the same unreadable authority.
   *
   * It is never an authorization result: no path anywhere may treat this as
   * access, and no path may fall back to the token's own role claim to
   * "degrade gracefully" — that would convert an outage into a window in
   * which a disabled account works again.
   */
  | 'unavailable';

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
 * was refused. This is the function guards call, and the ONE place a request
 * decides who its caller is.
 *
 * Memoised per request (see this module's header). The wrapped implementation
 * is below; callers must always use this export so the guard and the page
 * body cannot resolve to two different answers within one render.
 *
 * Refuses on every path, and says which kind of refusal it is: a caller
 * problem, or this service's own authority being unreadable (`unavailable`).
 * It never promotes the token to sole authority to keep working through an
 * outage.
 */
export const resolveOpsSession: () => Promise<OpsSessionResolution> = cache(resolveOpsSessionUncached);

/**
 * The ops row a public-preview visitor borrows, or null when there is none to
 * borrow.
 *
 * WHY THIS BOTHERS TO READ THE DATABASE AT ALL. `claims.sub` is written
 * straight into fourteen columns with an FK to `ops_users(id)` (audit actor,
 * dispatcher action, breakdown reporter, kill-switch operator, …), five of
 * them `not null on delete restrict`. A wholly synthetic id therefore does not
 * degrade gracefully in a preview — it turns the first button anyone presses
 * during a demo into a constraint violation. Borrowing a real row keeps every
 * write path working exactly as it does behind a login.
 *
 * `PREVIEW_OPS_USER_EMAIL` names the row explicitly; without it this takes the
 * widest active account it can find, preferring the two roles that can reach
 * the most surfaces. Never throws: a preview with no ops database at all is a
 * legitimate deployment of this branch (the simulator console reads
 * control-service, not Postgres), and it falls back to the synthetic identity
 * in publicPreview.ts.
 */
async function findPreviewProfile(): Promise<OpsUserRecord | null> {
  try {
    const repo = getOpsRepo();
    const named = process.env.PREVIEW_OPS_USER_EMAIL?.trim();
    if (named) {
      const match = await repo.findUserByEmail(named);
      if (match?.status === 'active') return match;
    }
    const active = (await repo.listUsers()).filter((user) => user.status === 'active');
    return (
      active.find((user) => user.role === 'control_room') ??
      active.find((user) => user.role === 'admin') ??
      active[0] ??
      null
    );
  } catch {
    return null;
  }
}

async function resolveOpsSessionUncached(): Promise<OpsSessionResolution> {
  // PUBLIC PREVIEW: there is no credential to resolve, so this authority
  // answers "yes" and says who. Placed above everything else because the two
  // front doors below both reach for configuration a preview deployment need
  // not have (Supabase, and the ops session secret), and because the whole
  // point is that no request here carries a session.
  //
  // The ROLE returned is the default one; the two guards that actually care
  // about a role (pageGuard.ts, guard.ts) substitute the one their own screen
  // or endpoint asked for. See src/lib/auth/publicPreview.ts.
  if (isAuthDisabled()) {
    // READ THE COOKIE STORE AND THROW THE ANSWER AWAY. This is not dead code.
    //
    // Every guarded page in this app is dynamically rendered for one implicit
    // reason: this function calls `cookies()`, which opts the route out of
    // static prerendering. Returning early without touching it made the ops
    // dashboards look prerenderable to Next, and `next build` then tried to
    // render /ops/driver — profile read and all — against an ops database
    // that is not running at build time, failing the whole build with
    // ECONNREFUSED. One preserved read restores exactly the rendering mode
    // these surfaces have always had.
    await cookies();

    const profile = await findPreviewProfile();
    return {
      ok: true,
      claims: previewClaimsFor(
        undefined,
        profile ? { sub: profile.id, email: profile.email } : undefined,
      ),
    };
  }

  let identity: Awaited<ReturnType<typeof resolveIdentity>>;
  try {
    identity = await resolveIdentity();
  } catch (error) {
    // NEXT'S OWN CONTROL FLOW IS NOT AN OUTAGE, and it arrives as a thrown
    // error like any other. `redirect()`, `notFound()` and the
    // dynamic-rendering bailout raised by reading cookies during a build are
    // all signalled by throwing, so a bare catch here would swallow them and
    // report "the authority is unavailable" for a page that was merely
    // telling Next it cannot be prerendered. `unstable_rethrow` is the
    // sanctioned way to let those through, and it must come first.
    unstable_rethrow(error);
    // Anything left really is the authority failing. The ops database
    // decides who the caller is, so failing to read it is not "no session" —
    // it is "no answer". Logged because an operations console silently
    // degrading to a sign-in page during its own outage is the failure mode
    // this reason exists to prevent.
    console.error('[ops-auth] Could not read the ops profile authority.', error);
    return { ok: false, reason: 'unavailable' };
  }
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
 * NULL IS AN ANSWER, NOT AN IMPOSSIBILITY. Every ops page used to call this
 * as `(await getOpsSession())!`, on the reasoning that the layout's
 * `requireOpsRolePage()` had already proven a session existed. That held only
 * while this was a pure token decode: two decodes of one cookie cannot
 * disagree. It stopped holding the moment this became a database read, and
 * `!` then turned an ordinary mid-render change — an admin disabling an
 * operator, or changing their role, while they were loading a dashboard —
 * into an unhandled TypeError and an HTTP 500 on every ops dashboard.
 *
 * Pages must take their session from `requireOpsRolePage()` instead, which
 * returns a session or redirects. This wrapper remains for the handful of
 * callers that genuinely want "session or nothing" and handle the nothing —
 * /ops/forbidden and the legacy /ops/login — and it deliberately still
 * collapses all four refusals plus `unavailable` into null, because those
 * two callers render the same thing either way. Anything that must tell them
 * apart calls `resolveOpsSession()`.
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
