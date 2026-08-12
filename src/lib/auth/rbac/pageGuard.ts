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
 */
import 'server-only';
import { redirect } from 'next/navigation';
import { resolveOpsSession } from './server';
import type { OpsRole } from './roles';
import type { OpsSessionClaims } from './session';

export async function requireOpsRolePage(
  role: OpsRole,
  nextPath: string,
): Promise<OpsSessionClaims> {
  const resolution = await resolveOpsSession();
  if (!resolution.ok) {
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
