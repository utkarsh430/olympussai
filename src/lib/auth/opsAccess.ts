/**
 * "Does this person have a usable ops profile?" for the SIGN-IN SURFACE only.
 *
 * Node runtime. Deliberately NOT an authority and never used as one: these
 * two functions decide where to POINT someone, and every ops page and API
 * route re-decides admission for itself against `ops_users`
 * (src/lib/auth/rbac/server.ts, guard.ts, pageGuard.ts). Being wrong here
 * costs a user one wrong link, never one unearned byte of access.
 *
 * BOTH SWALLOW ERRORS, WHICH IS SAFE ONLY BECAUSE OF THAT. `resolveOpsSession`
 * lets a database failure propagate on purpose — on a guarded route a 503 is
 * the correct answer, since the alternative is promoting a stale token to
 * sole authority. Here the caller is `/login` and POST /api/auth/login, which
 * are neither guarded nor ops-specific: letting the ops database decide
 * whether the PROJECT login page renders would mean an ops-side outage locks
 * every project user out of a product that does not depend on it. So a
 * failure degrades to null, and null routes to the project surface — strictly
 * less access, never more.
 */
import 'server-only';
import { resolveOpsSession } from './rbac/server';
import { getOpsRepo } from './rbac/repo';
import { readSupabaseOpsClaim } from './rbac/supabaseClaims';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OpsRole } from './rbac/roles';

/**
 * The current request's ops role, or null if it has no usable ops profile.
 *
 * Accepts either front door, because `resolveOpsSession` does: an operator
 * still holding a legacy ops cookie is as signed-in as one on a Supabase
 * session, and must keep landing correctly until that door is closed.
 */
export async function currentOpsRole(): Promise<OpsRole | null> {
  try {
    const resolution = await resolveOpsSession();
    return resolution.ok ? resolution.claims.role : null;
  } catch {
    return null;
  }
}

/** What the sign-in surface needs to know about the caller's ops access. */
export interface OpsAccessSummary {
  /** `ops_users.role` for an active, linked profile. The authority. */
  role: OpsRole | null;
  /**
   * Whether the caller's CURRENT access token carries that same role as its
   * `app_metadata.ops_role` claim — the only thing Edge middleware can check.
   *
   * False with a non-null `role` is the cutover state: a genuine operator the
   * edge gate cannot see yet. Offering them an ops link in that state is the
   * redirect loop, so /login must not. Reported as true when `role` is null,
   * where it means nothing.
   */
  claimReady: boolean;
}

/**
 * The caller's ops role AND whether their token can actually get them
 * through the edge gate with it.
 *
 * Both halves are needed because they can disagree, and the disagreement is
 * the whole failure: `currentOpsRole()` alone made /login offer "Continue to
 * Operations" to a linked-but-claimless operator, which bounced straight back
 * to /login. Degrades to "no ops access" on any failure, for the same reason
 * `currentOpsRole()` does — strictly less access, never more.
 */
export async function currentOpsAccess(): Promise<OpsAccessSummary> {
  const role = await currentOpsRole();
  if (!role) return { role: null, claimReady: true };

  try {
    const claim = await readSupabaseOpsClaim(await createSupabaseServerClient());
    // A legacy-ops-cookie session has no Supabase claim to be missing, and it
    // reaches the edge through its own cookie: the claim is irrelevant to it,
    // never "not ready". Only a live Supabase session is judged here.
    if (!claim) return { role, claimReady: true };
    return { role, claimReady: claim.roleClaim === role };
  } catch {
    return { role, claimReady: true };
  }
}

/**
 * The ops role linked to a Supabase user id, or null.
 *
 * Used by POST /api/auth/login, which has just minted the session and holds
 * `data.user.id` directly. It cannot use `currentOpsRole()` instead: the
 * Supabase cookies it just set are on the outgoing response and are not
 * readable back through `cookies()` within the same request, so a session
 * lookup there would report "not signed in" for the very user who just
 * successfully signed in.
 */
export async function opsRoleForSupabaseUser(supabaseUserId: string): Promise<OpsRole | null> {
  try {
    const profile = await getOpsRepo().findUserBySupabaseId(supabaseUserId);
    if (!profile || profile.status !== 'active') return null;
    return profile.role;
  } catch {
    return null;
  }
}
