/**
 * Server-side gate for the UPSRTC project pages (Server Components).
 *
 * The page-side twin of `requireUpsrtcAccess()` in ./authorize.ts, and the
 * exact counterpart of `requireOpsRolePage` for the ops console: same
 * authority (`ops_users`, re-read per request), same refusal reasons,
 * different way of answering them, because a page's refusal IS a redirect
 * and the destination is the whole user experience of being refused.
 *
 * WHERE EACH REFUSAL GOES, and why:
 *
 *   - `no_session` — not signed in. `/login`, carrying `next`, so the deep
 *     link survives authentication. Rare in practice: middleware bounces
 *     these before a page ever renders. It is here for the case middleware
 *     cannot cover — a session that expired between the edge check and this
 *     render — which is precisely why this guard does not trust middleware.
 *
 *   - `role_claim_mismatch` — the token's role claim disagrees with the
 *     database. `/login`, carrying `next`: signing in again mints a fresh,
 *     correct claim, so this is self-healing rather than a lockout, and
 *     sending it anywhere terminal would strand a user one click from the
 *     fix.
 *
 *   - `no_profile` / `profile_disabled` — signed in, and this account may not
 *     use the surface. `/login?notice=no-ops-access`, which RENDERS an
 *     explanation instead of offering another hop.
 *
 *     Keeping `next` here would be the bug, not the courtesy it looks like.
 *     `/login` would honour it, the user would click through, this guard
 *     would refuse again, and the product would look broken while doing
 *     exactly the right thing. That is the loop `src/lib/auth/landing.ts`
 *     documents at length; the notice is the terminal state it built for it.
 *
 *   - `unavailable` — the directory that decides this could not be read at
 *     all. Not the sign-in page, and not an unhandled error either: it goes
 *     to the same outage explanation the ops console uses
 *     (`OPS_UNAVAILABLE_PATH`, which reads nothing, so it still renders while
 *     everything else is failing). Sending them to sign in would blame their
 *     account for a service fault and point them at a flow that reads the
 *     very authority that is down; throwing would answer an outage with a
 *     stack trace, which is the failure mode this whole change exists to
 *     remove. One authority, one outage, one explanation.
 */
import 'server-only';
import { redirect } from 'next/navigation';
import { resolveProjectAccess } from './authorize';
import { NO_OPS_ACCESS_NOTICE } from './landing';
import { OPS_UNAVAILABLE_PATH } from './rbac/pageGuard';
import type { OpsSessionClaims } from './rbac/session';

/**
 * Require an active ops profile to render a `/project/*` page.
 *
 * @param nextPath Where to return the user after they sign in. Pass the
 *   page's own path; it is re-sanitized by `/login` against the internal
 *   allowlist, so it can never become an open redirect.
 */
export async function requireProjectSurface(nextPath: string): Promise<OpsSessionClaims> {
  const resolution = await resolveProjectAccess();
  if (resolution.ok) return resolution.claims;

  if (resolution.reason === 'unavailable') {
    redirect(`${OPS_UNAVAILABLE_PATH}?next=${encodeURIComponent(nextPath)}`);
  }

  if (resolution.reason === 'no_profile' || resolution.reason === 'profile_disabled') {
    redirect(`/login?notice=${NO_OPS_ACCESS_NOTICE}`);
  }

  redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}
