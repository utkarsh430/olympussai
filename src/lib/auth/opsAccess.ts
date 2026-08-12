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
