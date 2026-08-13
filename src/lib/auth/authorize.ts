/**
 * Who may use the UPSRTC project surface — the enterprise command centre at
 * `/project/*` and the `/api/upsrtc/*` feeds behind it.
 *
 * WHAT THIS USED TO BE, AND WHY IT WAS A HOLE. `requireUpsrtcAccess()` was
 * literally `return getSupabaseUser()`: a valid Supabase session, of any
 * kind, was the whole authorization decision. That was written when every
 * Supabase account was admin-provisioned by `scripts/create-project-user.mjs`
 * and the sentence "any signed-in Supabase user is authorized" was therefore
 * a statement about a hand-curated list of people.
 *
 * It stopped being true twice over:
 *
 *   1. The Supabase project accepts public self-signup. Whether that setting
 *      is on or off is a dashboard toggle, and a dashboard toggle is not an
 *      access-control mechanism — it can be flipped by anyone with console
 *      access, it is invisible from the code, and nothing here would change
 *      behaviour when it moved. With it on, "signed-in" meant "anyone who
 *      completed a registration form", and that admitted strangers to a live
 *      fleet feed carrying every vehicle's position.
 *   2. Collapsing the two auth systems gave invite-created OPS accounts real
 *      Supabase identities. An invited `driver` — provisioned deliberately,
 *      for one narrow screen — silently gained the entire enterprise surface
 *      as a side effect of being able to sign in at all.
 *
 * SO THE DECISION IS NOW THE SAME ONE THE OPS SURFACE MAKES: an ACTIVE,
 * linked `ops_users` profile, re-read from the database per request through
 * `resolveOpsSession()` (src/lib/auth/rbac/server.ts). Signed-in is a
 * prerequisite, never the answer. This module deliberately owns no session
 * logic of its own — a second, subtly different implementation of "who is
 * this" is exactly how one of two doors ends up weaker than the other.
 *
 * BOTH FRONT DOORS ARE ACCEPTED, because `resolveOpsSession` accepts both: a
 * Supabase session resolved through `ops_users.supabase_user_id`, and the
 * legacy `olympuss_ops_session` cookie resolved through `ops_users.id`. The
 * legacy door is the cutover's lockout safety net, and a safety net that
 * reaches the ops console but not the project surface is not a safety net.
 *
 * ORDERING WITH MIDDLEWARE IS UNCHANGED AND STILL LOAD-BEARING. Edge
 * middleware is a first line of defence that cannot read `ops_users` (no
 * `pg` on the Edge runtime), so it can only ever say "there is a credential
 * here". THIS is the decision, and it is made again on every guarded
 * request — see src/middleware.ts's `handleProjectRequest`.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { resolveOpsSession, type OpsSessionResolution } from './rbac/server';
import type { OpsSessionClaims } from './rbac/session';

/**
 * Why the project surface was refused — the ops resolver's own reasons,
 * re-exported rather than re-modelled.
 *
 * Deliberately not a parallel type. Four of the five refusals are statements
 * about the caller and the fifth (`unavailable`) is a statement about the
 * authority itself; a second enum here would be one rename away from the two
 * doors disagreeing about what a refusal even means, which is precisely how
 * the weaker of two doors gets built.
 */
export type ProjectAccessResolution = OpsSessionResolution;

/**
 * Resolve the current request's project-surface access, once per request.
 *
 * A thin alias, and it stays thin on purpose: `resolveOpsSession` is already
 * memoised with React `cache()` (src/lib/auth/rbac/server.ts), so the
 * surface's layout guard, this module's API guard and any ops guard on the
 * same request all share ONE `ops_users` read and — the property that
 * actually matters — one answer. Wrapping it in a second cache here would
 * add a second memo without a second question to answer, and re-implementing
 * the resolution would give the project surface its own subtly different idea
 * of who the caller is.
 */
export const resolveProjectAccess: () => Promise<ProjectAccessResolution> = resolveOpsSession;

/** Standard 401 response for unauthenticated/unauthorized API requests. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * 503 for the one refusal that is not about the caller at all.
 *
 * Kept distinct from the 401 deliberately. Answering an authority outage with
 * "Unauthorized" would tell an operator their credentials are the problem and
 * send them to re-authenticate, which cannot help and costs the one signal
 * that would have named the real fault. Both refuse; only one of them is
 * honest about why.
 */
export function authorityUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Service unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

export type UpsrtcGuardResult =
  | { ok: true; claims: OpsSessionClaims }
  | { ok: false; response: NextResponse };

/**
 * Require an active ops profile for a UPSRTC API route.
 *
 * Returns the resolved claims, or the exact response the caller should
 * return. A result object rather than a nullable user because the two
 * refusals are genuinely different answers (401 vs 503) and collapsing them
 * to `null` would force every call site to re-derive which one it meant.
 *
 * Every sensitive UPSRTC route calls this independently — middleware is a
 * first line of defence, not the only one.
 */
export async function requireUpsrtcAccess(): Promise<UpsrtcGuardResult> {
  const resolution = await resolveProjectAccess();
  if (resolution.ok) return { ok: true, claims: resolution.claims };

  // Every caller-side refusal is 401, never 403, and never a distinct
  // message per reason: `/login` is publicly reachable, so "that account is
  // disabled" or "that account has no profile" would be an account
  // enumeration oracle. The account holder gets one answer; the
  // administrator has the audit log.
  return {
    ok: false,
    response:
      resolution.reason === 'unavailable'
        ? authorityUnavailableResponse()
        : unauthorizedResponse(),
  };
}
