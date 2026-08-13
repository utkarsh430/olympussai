/**
 * Ending an ops session — BOTH of them.
 *
 * Collapsing the two auth systems onto one front door left sign-out behind:
 * `POST /api/ops/auth/logout` cleared the legacy `olympuss_ops_session`
 * cookie and nothing else, so an operator signed in through Supabase (which
 * is every invite-created account, and every account after the backfill)
 * watched the login page appear while remaining fully authenticated. On a
 * shared depot tablet that is not a cosmetic bug: the next person to open
 * /ops/driver is still the previous driver, with no credential of their own.
 *
 * A sign-out therefore has to end every credential the request is carrying,
 * and this module is the one place that knows what those are:
 *
 *   olympuss_ops_session   The legacy HS256 cookie. Cleared by
 *                          `clearOpsSession()` — retained deliberately as the
 *                          rollback lever, so sign-out must keep clearing it.
 *   sb-<ref>-auth-token    The Supabase session, written by @supabase/ssr and
 *                          possibly split across `.0`/`.1` chunks. Ended by
 *                          `signOut()`, which drops the cookies locally AND
 *                          asks Supabase Auth to revoke the session.
 *
 * WHY GLOBAL SCOPE. `signOut()` defaults to `scope: 'global'`, and that
 * default is kept on purpose: it deletes every refresh token the account
 * holds, so the operator's OTHER devices cannot renew themselves either. A
 * local-scope sign-out is the wrong default for a control surface where
 * "sign out" is what a driver does before handing a shared tablet over — the
 * point of the action is that the credential stops working, not that this one
 * browser forgets it.
 *
 * What it does not do is retract a token already issued. This project signs
 * with ES256 and both surfaces verify the access token locally (see
 * ./supabaseClaims.ts), so an exfiltrated token stays cryptographically
 * valid until it expires. That is not what sign-out ever protected against
 * and it is not what the defect was: the defect was that the credential
 * stayed IN THE BROWSER, on a shared tablet, under a login screen that said
 * otherwise. Revoking someone else's access is the disable path's job
 * (./opsIdentity.ts), and it re-reads `ops_users` on every request.
 *
 * WHY THE COOKIE SWEEP EXISTS AT ALL. Everything above depends on reaching
 * Supabase Auth, or even on Supabase being configured. Neither is guaranteed,
 * and the failure the operator would experience — "I pressed sign out and I
 * am still signed in" — is exactly the defect being fixed. So the local
 * credential is expired unconditionally afterwards: an unreachable Supabase
 * degrades a sign-out from "revoked everywhere" to "ended on this device",
 * never to "did nothing". The sweep is idempotent; on the normal path it
 * finds the cookies already emptied by `signOut()` and writes nothing.
 *
 * WHY THE RESULT IS READ BACK. Reporting a sign-out that did not happen is
 * how the original defect shipped in the first place. `endOpsSessions()`
 * re-reads the cookie store afterwards and names any credential that
 * survived, so the route can refuse to claim success it cannot demonstrate.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { OPS_SESSION_COOKIE } from './config';
import { clearOpsSession } from './server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** What happened to the Supabase half of the session. */
export type SupabaseSignOutResult =
  /** There was a Supabase session and Supabase Auth revoked it. */
  | 'signed_out'
  /** The request carried no Supabase credential — nothing to end. */
  | 'no_session'
  /** Supabase is not configured in this environment (never an auth outcome). */
  | 'not_configured'
  /**
   * A Supabase credential was present and the revoke call failed. The cookies
   * are still dropped, so this device is signed out; other devices the
   * account is signed in on are not.
   */
  | 'revoke_failed';

export interface OpsSignOutOutcome {
  supabase: SupabaseSignOutResult;
  /** Reason the revoke failed, for the server log. Never returned to a client. */
  supabaseError: string | null;
  /**
   * Cookie names that STILL carry a credential after everything above ran.
   * Empty on every healthy path — a non-empty list means the caller must not
   * tell the operator they are signed out.
   */
  residualCredentials: string[];
}

/**
 * Supabase's session cookies, whatever the project ref and however many
 * chunks it took. Matched by shape rather than by reconstructing the name
 * from the project URL, so a sign-out still clears cookies left behind by a
 * previous project ref (a restored backup, a re-pointed environment) instead
 * of stranding a credential nothing will ever clean up.
 */
function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith('sb-') && name.includes('-auth-token');
}

function credentialCookieNames(all: readonly { name: string; value: string }[]): string[] {
  return all
    .filter(({ name, value }) => value.length > 0 && isCredentialCookie(name))
    .map(({ name }) => name);
}

function isCredentialCookie(name: string): boolean {
  return name === OPS_SESSION_COOKIE || isSupabaseAuthCookie(name);
}

/**
 * End every session this request is authenticated by, and report what is
 * left. Never throws: a sign-out that raises is a sign-out that silently did
 * not happen, and the caller cannot tell the difference from success.
 */
export async function endOpsSessions(): Promise<OpsSignOutOutcome> {
  const store = await cookies();

  // The legacy cookie first: it needs nothing external, so it is the half
  // that cannot fail, and doing it first means a later throw cannot leave it
  // behind.
  try {
    await clearOpsSession();
  } catch {
    // Read-only cookie store; the verification at the bottom reports it.
  }

  const before = credentialCookieNames(store.getAll());
  const hadSupabaseSession = before.some(isSupabaseAuthCookie);

  let supabase: SupabaseSignOutResult = 'no_session';
  let supabaseError: string | null = null;

  if (hadSupabaseSession) {
    try {
      const client = await createSupabaseServerClient();
      // Default scope is 'global' — see this module's header.
      const { error } = await client.auth.signOut();
      if (error) {
        supabase = 'revoke_failed';
        supabaseError = error.message;
      } else {
        supabase = 'signed_out';
      }
    } catch (error) {
      // A configuration error and an unreachable Supabase are reported
      // differently because only one of them is an incident.
      const message = error instanceof Error ? error.message : 'Unknown error.';
      supabase = /not configured/i.test(message) ? 'not_configured' : 'revoke_failed';
      supabaseError = message;
    }
  }

  // The unconditional local expiry. Idempotent, and the only reason an
  // unreachable Supabase still ends the session on this device. The legacy
  // cookie is left to `clearOpsSession()` above so its own Secure/HttpOnly
  // options are the ones that go out on the wire.
  for (const name of before.filter(isSupabaseAuthCookie)) {
    try {
      store.set(name, '', { path: '/', maxAge: 0 });
    } catch {
      // Read-only cookie store (a Server Component render). The verification
      // below reports the credential as residual rather than assuming it went.
    }
  }

  return {
    supabase,
    supabaseError,
    residualCredentials: credentialCookieNames(store.getAll()),
  };
}
