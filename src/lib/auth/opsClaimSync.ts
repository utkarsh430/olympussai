/**
 * Bring a signing-in operator's ops role CLAIM up to date with the DATABASE.
 *
 * ─── THE TRAP THIS EXISTS TO CLOSE ──────────────────────────────────────
 *
 * An ops account's role lives in two stores (see
 * src/lib/auth/rbac/opsIdentity.ts's two-writer contract): `ops_users.role`
 * is the authority, and `app_metadata.ops_role` is the ceiling Edge
 * middleware checks because it cannot reach the database. Between the
 * backfill that links an ops profile to a Supabase identity and the push
 * that writes the claim, an account is linked with an ACTIVE role and no
 * claim at all — and that is not an edge case. It is the exact state every
 * operator passes through during the cutover.
 *
 * In that state sign-in used to answer "go to /ops/control-room" (it asks
 * the database, which knows), middleware then refused the request (it reads
 * the token, which does not), and the bounce landed on a page offering a
 * link straight back: a loop with no explanation, at the single moment the
 * whole roster is passing through it.
 *
 * ─── WHY PUSHING THE CLAIM HERE IS NOT A PRIVILEGE ESCALATION ───────────
 *
 * The direction of the write is the entire argument, and it only ever goes
 * one way:
 *
 *     ops_users.role   ──push──>   app_metadata.ops_role
 *
 * The value written is read server-side from `ops_users` for the identity
 * that has just proven possession of its password. Nothing the caller sends
 * influences it — not the request body, not the old token, not a `next`
 * parameter. The claim it produces is still only a ceiling: every ops page
 * and every ops API re-reads `ops_users` and can still refuse
 * (src/lib/auth/rbac/server.ts). So the most this can ever do is let the
 * edge agree with what the database already said, and it cannot grant a role
 * the database does not hold, nor revive a disabled account
 * (`opsRoleForSupabaseUser` returns null for anything but `status = 'active'`).
 *
 * THE REVERSE WRITE IS FORBIDDEN. Nothing here may ever read a role out of a
 * token and write it into `ops_users`, or use a token's claim to widen a
 * database answer. That would make a base64 payload the authority, and it is
 * precisely the mistake the claim/authority split exists to prevent.
 *
 * FAILURE IS NEVER FATAL AND NEVER SILENT. Every failure path returns false
 * rather than throwing: a Supabase Auth write that is refused, unreachable,
 * or unconfigured must not break a sign-in that has already succeeded. False
 * means "the edge still cannot see this operator's role", and the caller
 * owes them an explanation instead of a link that will bounce.
 */
import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { pushOpsRoleClaim } from './rbac/opsIdentity';
import { OPS_ROLE_CLAIM } from './rbac/supabaseClaims';
import { isOpsRole, type OpsRole } from './rbac/roles';

/** The ops role claim stored on a Supabase user record, or null. */
export function opsRoleClaimOf(user: User | null | undefined): OpsRole | null {
  const raw = (user?.app_metadata as Record<string, unknown> | undefined)?.[OPS_ROLE_CLAIM];
  return isOpsRole(raw) ? raw : null;
}

/**
 * The ops role carried by an access token's payload, or null.
 *
 * READ, NEVER TRUSTED. The signature is deliberately not checked here: this
 * is used only to confirm what a token WE just received from Supabase Auth
 * says about a claim WE just wrote, so that "the write landed" is established
 * from the artifact middleware will actually read rather than from the
 * absence of an error. No authorization decision is made from it — the edge
 * verifies this token properly (src/lib/auth/rbac/supabaseClaims.ts) and the
 * database decides regardless.
 */
export function opsRoleClaimInAccessToken(accessToken: string | null | undefined): OpsRole | null {
  if (!accessToken) return null;
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const claims = JSON.parse(json) as { app_metadata?: Record<string, unknown> };
    const raw = claims.app_metadata?.[OPS_ROLE_CLAIM];
    return isOpsRole(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Make the caller's CURRENT session carry `databaseRole`, if it does not
 * already. Returns whether it now does.
 *
 * Two steps, and both are needed. Writing `app_metadata` only changes what
 * the NEXT token will say; the token this request just minted is already
 * issued and still claimless, so middleware would bounce this very
 * navigation. `refreshSession()` mints a replacement from the updated
 * metadata and writes it back through the caller's cookie adapter, which is
 * what makes the fix apply to the redirect the browser is about to follow
 * rather than to some later sign-in.
 *
 * @param supabase A client bound to THIS request's cookies (so the refreshed
 *   session is the one the caller leaves with). Never the service-role
 *   client — that one represents no user and must not write a session.
 * @param supabaseUserId The identity that just authenticated.
 * @param databaseRole `ops_users.role`, read server-side. The authority.
 */
export async function syncOpsRoleClaimForSignIn(
  supabase: SupabaseClient,
  supabaseUserId: string,
  databaseRole: OpsRole,
): Promise<boolean> {
  try {
    await pushOpsRoleClaim(supabaseUserId, databaseRole);
  } catch (error) {
    // Unconfigured service-role key, a refused write, a rate limit, an
    // unreachable Auth server. Logged because a whole cutover stalling on
    // this must be diagnosable from the server, not only from operators
    // reporting that they cannot reach their dashboard.
    console.error('[ops-auth] Could not push the ops role claim at sign-in.', error);
    return false;
  }

  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      console.error('[ops-auth] Pushed the ops role claim but could not refresh the session.', error);
      return false;
    }
    // Confirmed against the token itself: `updateUserById` merges server-side
    // and a merge that quietly did nothing looks identical to one that
    // worked if only the absence of an error is checked.
    return opsRoleClaimInAccessToken(data.session.access_token) === databaseRole;
  } catch (error) {
    console.error('[ops-auth] Could not refresh the session after pushing the ops role claim.', error);
    return false;
  }
}
