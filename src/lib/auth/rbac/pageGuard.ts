/**
 * Server-side role gate for ops pages (Server Components).
 *
 * Second independent check, same pattern as the Supabase-Auth-gated
 * (protected)/project/upsrtc/layout.tsx: middleware is the first line, this
 * re-verifies and redirect()s without trusting middleware. Used by every
 * per-role layout under src/app/(ops)/ops/<role>/layout.tsx.
 *
 * Like guard.ts, this is now the AUTHORITY rather than a second read of the
 * same token: `resolveOpsSession()` re-reads `ops_users` (role and status)
 * on every render. See src/lib/auth/rbac/server.ts.
 *
 * WHERE EACH REFUSAL SENDS THE USER matters more here than on the API side,
 * because a page redirect is the whole user experience of being refused:
 *
 *   - Wrong role for this screen -> /ops/forbidden. The user IS signed in;
 *     bouncing them to a login page would imply otherwise and invite them to
 *     retry with another account.
 *   - Everything else (no session, no linked profile, disabled, or a role
 *     claim that disagrees with the database) -> the sign-in page, carrying
 *     `next`. A stale or unlinked session is repaired by signing in again,
 *     so a terminal forbidden page would be a dead end — and for an admin
 *     it would be a dead end in front of the very screens that fix it.
 *   - The ops database could not be read at all -> /ops/unavailable. NOT the
 *     sign-in page: nothing about the operator's account is wrong, signing in
 *     again reads the same unreadable authority, and an operations console
 *     that answers its own outage with "please sign in" hides the one fact
 *     the person on shift needs.
 *
 * THIS IS ALSO WHERE PAGES GET THEIR SESSION. Ops pages used to call the
 * layout guard for its side effect and then re-resolve the session themselves
 * with `(await getOpsSession())!`, asserting non-null on the strength of this
 * guard having run. Two independent resolutions of a database-backed session,
 * rendered concurrently, are exactly what a mid-render role change or disable
 * splits apart — and the `!` turned that split into an HTTP 500 rather than a
 * redirect. Pages now take the session this function returns. It costs no
 * extra read: `resolveOpsSession` is memoised per request (see server.ts), so
 * the layout and the page body share one resolution and one answer.
 */
import 'server-only';
import { redirect } from 'next/navigation';
import { resolveOpsSession } from './server';
import { isAuthDisabled } from '@/lib/auth/publicPreview';
import type { OpsRole } from './roles';
import type { OpsSessionClaims } from './session';

/** Where an operator is sent when the ops database itself cannot be read. */
export const OPS_UNAVAILABLE_PATH = '/ops/unavailable';

export async function requireOpsRolePage(
  role: OpsRole,
  nextPath: string,
): Promise<OpsSessionClaims> {
  const resolution = await resolveOpsSession();

  // PUBLIC PREVIEW: refuse nothing, and hand this screen the role it just
  // asked for rather than the one the borrowed profile happens to hold.
  //
  // The substitution is the whole point. Without it a single anonymous
  // visitor holds one role, so exactly one console renders and the strict
  // `!==` below sends them to /ops/forbidden on every other one — which is
  // indistinguishable, to someone being shown the product, from the login
  // this branch removed. See src/lib/auth/publicPreview.ts.
  if (isAuthDisabled() && resolution.ok) {
    return { ...resolution.claims, role };
  }

  if (!resolution.ok) {
    if (resolution.reason === 'unavailable') {
      // Carries `next` for the same reason the sign-in bounce does: the retry
      // has to land back on the screen the operator was actually opening, and
      // that page cannot work it out for itself (it reads nothing at all).
      redirect(`${OPS_UNAVAILABLE_PATH}?next=${encodeURIComponent(nextPath)}`);
    }
    // Still /ops/login while both front doors are live. The worker who
    // collapses the login pages repoints this to /login (and widens
    // src/lib/auth/redirect.ts's sanitizeNext to accept /ops/*, or every
    // deep link here silently lands on /project/upsrtc instead).
    redirect(`/ops/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (resolution.claims.role !== role) {
    redirect('/ops/forbidden');
  }
  return resolution.claims;
}
