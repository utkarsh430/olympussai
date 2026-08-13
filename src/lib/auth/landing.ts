/**
 * Where a signed-in person goes after `/login`.
 *
 * Pure and edge-safe (no `server-only`, no `pg`, no `next/headers`): the
 * login page and POST /api/auth/login both call this so the page a user is
 * offered and the page the form navigates to can never disagree.
 *
 * ─── WHY THIS IS A FUNCTION AND NOT THREE INLINE `if`s ──────────────────
 *
 * The dangerous case is a redirect LOOP, and a loop is what locks people out
 * of the product. The cycle is real and reachable today:
 *
 *   /ops/depot            middleware finds no usable role ceiling
 *     -> /ops/login?next=/ops/depot
 *     -> /login?next=/ops/depot        (the collapse: one front door)
 *     -> user is already signed in, so send them to their dashboard
 *     -> /ops/depot                    ... and round again, forever.
 *
 * Two independent things stop it, and BOTH are deliberate:
 *
 *   1. `/login` never issues an automatic server redirect. It renders. A
 *      cycle needs an automatic hop at every step; a page that renders is a
 *      terminal state with a visible explanation and a working way out. This
 *      is the load-bearing one, because it holds even when the reason for
 *      the bounce is something this module cannot see (a missing role claim
 *      in the token, say — which is the state EVERY account is in until the
 *      backfill pushes `app_metadata`).
 *
 *   2. This function refuses to nominate ANY target for someone with no
 *      usable ops profile — `/project/*` included, now that it is gated on
 *      the same profile. Sending them anywhere would produce a bounce even if
 *      rule 1 were ever weakened.
 *
 *   3. And it refuses to nominate an `/ops/*` target for an operator whose
 *      token does not yet carry their role claim, which is rule 1's blind
 *      spot made explicit: the sign-in route can now SEE that state, so it
 *      no longer has to rely on the terminal page to absorb the bounce.
 *
 * `sanitizeOpsNext` contributes a fourth, narrower guard by refusing
 * `/ops/login` and `/ops/accept-invite` as targets at all — a `next` that
 * points back at a login page is a one-hop loop of its own.
 */
import { OPS_ROLE_SEGMENT, type OpsRole } from './rbac/roles';
import { isOpsPath, sanitizeNextOrNull } from './redirect';

/**
 * Roles whose `/ops/<segment>` path is not actually a page.
 *
 * `admin` is the only one: `OPS_ROLE_SEGMENT.admin` is `'admin'`, but
 * `src/app/(ops)/ops/admin/` contains only `layout.tsx`, `invites/` and
 * `rollout-stages/` — there is no `admin/page.tsx`. Every existing caller
 * that built `/ops/${OPS_ROLE_SEGMENT[role]}` therefore sent an admin to a
 * 404: signing in, accepting an invite, and following "Back to your
 * dashboard" off /ops/forbidden all did it. Invites is the right home —
 * it is the screen an admin actually works in.
 *
 * `opsLandingPathsAreReal` in the tests walks the App Router directory and
 * fails if any role's home stops resolving to a real page, so a future
 * route move cannot silently reintroduce this.
 */
const OPS_ROLE_HOME_OVERRIDES: Partial<Record<OpsRole, string>> = {
  admin: '/ops/admin/invites',
};

/** The dashboard a role lands on. Always a real page. */
export function opsHomePath(role: OpsRole): string {
  return OPS_ROLE_HOME_OVERRIDES[role] ?? `/ops/${OPS_ROLE_SEGMENT[role]}`;
}

export type LandingDecision =
  /** Navigate here. Always a safe internal path. */
  | { kind: 'go'; path: string }
  /**
   * Signed in, but holding no usable ops profile — so there is nowhere to
   * send them. Deliberately NOT a path: the caller must render an
   * explanation, because every destination this app has would bounce them
   * straight back here.
   *
   * `requested` is the path they explicitly asked for, or null when they
   * asked for nothing in particular. The explanation reads differently in
   * those two cases ("it cannot open X" vs. a plain statement of the state),
   * so the distinction is preserved rather than defaulted away.
   */
  | { kind: 'no-ops-access'; requested: string | null }
  /**
   * The DATABASE says this person is an operator; their TOKEN does not carry
   * the role yet, and it could not be repaired on the spot.
   *
   * A different answer from `no-ops-access` because it is a different fact
   * and needs a different instruction: nobody should tell an active
   * dispatcher that their account "has no operations access configured" when
   * it demonstrably does. It is also the specific state this decision must
   * never nominate an `/ops/*` path for — the edge gate reads the token, so
   * every ops destination bounces, and nominating one is the redirect loop
   * itself. `requested` is null when the user named no destination.
   *
   * A NON-ops destination is still nominated for them, and that remains
   * correct after `/project/*` was gated on the ops profile: this account
   * HAS one. What it lacks is the edge ceiling, and `/project/*` has no
   * ceiling to lack — its guard reads the same profile table directly.
   */
  | { kind: 'ops-access-pending'; role: OpsRole; requested: string | null };

export interface LandingInput {
  /** Raw, unsanitized `next` query parameter. Sanitized here. */
  readonly requestedNext?: string | null;
  /**
   * The role on the caller's ACTIVE, linked `ops_users` row, or null for
   * "no usable ops profile". Null covers an ordinary project viewer, an
   * unlinked ops account mid-cutover, a disabled account, and a failed or
   * unavailable lookup — all four must be treated identically here, because
   * all four bounce off `/ops/*` and none of them should be told anything
   * more specific than "not configured" on a public page.
   */
  readonly opsRole?: OpsRole | null;
  /**
   * Whether the caller's CURRENT access token carries `opsRole` as its
   * `app_metadata.ops_role` claim, which is the only thing Edge middleware
   * can see.
   *
   * Defaults to true so every existing caller keeps its behaviour; pass it
   * explicitly wherever the token is actually knowable. Meaningless when
   * `opsRole` is null and ignored there.
   */
  readonly opsClaimReady?: boolean;
}

/**
 * NO OPS PROFILE NOW MEANS NO DESTINATION AT ALL, which is a real change of
 * behaviour and worth stating plainly.
 *
 * This function used to send an account with no ops profile to
 * `/project/upsrtc`, on the understanding that the project surface was a
 * separate product any signed-in enterprise user could use. That
 * understanding was the C1 exposure: the "enterprise viewer" tier was not a
 * provisioned population, it was whoever had registered — and it carried the
 * live fleet feed. `/project/*` is now gated on the same active `ops_users`
 * profile the ops console requires (src/lib/auth/authorize.ts).
 *
 * So both halves of this app are behind one profile, and nominating any path
 * for someone without one would hand them a link that refuses them on
 * arrival. The `no-ops-access` decision is not a fallback here; it is the
 * only truthful answer, and `/login` renders it as a terminal state with a
 * working way out (sign out, or ask an administrator).
 *
 * OPERATIONAL CONSEQUENCE, deliberately not softened: a Supabase account with
 * no `ops_users` row can no longer reach anything. During the cutover that
 * includes accounts created by `pnpm create-project-user` for the project
 * surface alone. They need an ops row and a link (steps 1-3 of
 * docs/olympuss/AUTH_CUTOVER_RUNBOOK.md), or the legacy `/ops/login` door,
 * which still resolves to a real profile and is still open.
 *
 * THE TWO REFUSALS ARE ORDERED, AND THE ORDER IS THE POINT. "No profile at
 * all" is checked first and is terminal; "a profile the edge cannot see yet"
 * is checked second and is narrower — it withholds only `/ops/*`. Reversing
 * them would tell a profile-less account that its access is merely pending,
 * which is a promise nobody is going to keep.
 */
export function resolveLanding({
  requestedNext,
  opsRole,
  opsClaimReady = true,
}: LandingInput): LandingDecision {
  const requested = sanitizeNextOrNull(requestedNext);

  if (!opsRole) return { kind: 'no-ops-access', requested };

  // An operator the edge gate cannot yet see. Everything under /ops/* is
  // unreachable for them until the claim lands, so no ops path may be
  // nominated — not the requested one, and not their own dashboard. A
  // non-ops destination still works: /project/* reads the profile table
  // itself and has no token ceiling to be missing.
  if (!opsClaimReady) {
    if (!requested || isOpsPath(requested)) {
      return { kind: 'ops-access-pending', role: opsRole, requested };
    }
    return { kind: 'go', path: requested };
  }

  // An operator with an explicit destination gets it; otherwise their own
  // dashboard. This is the "role-correct landing" half — before the collapse,
  // /login sent all seven ops roles to /project/upsrtc.
  return { kind: 'go', path: requested ?? opsHomePath(opsRole) };
}

/** Query parameter `/login` reads to render the no-ops-access explanation. */
export const NO_OPS_ACCESS_NOTICE = 'no-ops-access';

/**
 * Query parameter `/login` reads to render the "your role has not reached
 * your sign-in yet" explanation. Distinct from NO_OPS_ACCESS_NOTICE because
 * the two are opposite facts about the account and need opposite advice.
 */
export const OPS_ACCESS_PENDING_NOTICE = 'ops-access-pending';

/**
 * THE ROLLBACK LEVER, and the reason `/ops/login` is redirected rather than
 * deleted.
 *
 * `/ops/login` now forwards to `/login` — but `/login` is Supabase, and the
 * standing requirement on this whole migration is that it must never lock the
 * captain out of his own product. If Supabase Auth is unreachable or
 * unconfigured, an unconditional forward would leave NO reachable door at
 * all, because the legacy password form would only be a redirect away from a
 * page that cannot authenticate anyone.
 *
 * `?legacy=1` renders that form instead of forwarding. It grants nothing on
 * its own: the legacy path still needs a valid `ops_users` password and still
 * lands in the same per-request authority checks. It is a way IN to a door
 * that is still open, not a way AROUND one that is shut, and it disappears
 * with `/ops/login` itself at the cutover.
 */
export const OPS_LEGACY_LOGIN_PARAM = 'legacy';
export const OPS_LEGACY_LOGIN_PATH = `/ops/login?${OPS_LEGACY_LOGIN_PARAM}=1`;

/**
 * Where POST /api/auth/login tells the form to go for a `no-ops-access`
 * decision: back to `/login`, which renders the explanation. Going back to
 * the page the user is already on is intentional — it is the one place
 * guaranteed not to bounce them, and it keeps "signed in, but no ops access"
 * a visible state rather than a silent drop onto the project dashboard.
 */
export function landingUrl(decision: LandingDecision): string {
  switch (decision.kind) {
    case 'go':
      return decision.path;
    case 'ops-access-pending':
      return `/login?notice=${OPS_ACCESS_PENDING_NOTICE}`;
    case 'no-ops-access':
      return `/login?notice=${NO_OPS_ACCESS_NOTICE}`;
  }
}
