/**
 * PUBLIC PREVIEW MODE — the branch-local switch that takes the login off.
 *
 * ─── WHAT THIS IS FOR ────────────────────────────────────────────────────
 *
 * The `simulator-preview` branch exists to be deployed to a domain and shown
 * to people: the fleet-trial console at /ops/control-room/simulator and the
 * consoles around it, with no sign-in in front of them. Nobody being shown
 * the simulator's analytics has an ops account, and issuing one per viewer is
 * not the point of the exercise.
 *
 * ─── WHY IT IS A SWITCH AND NOT A DELETION ───────────────────────────────
 *
 * Every gate in this app is a documented, tested, defence-in-depth pair
 * (middleware ceiling + Node authority — see src/middleware.ts and
 * src/lib/auth/rbac/server.ts). Deleting either half would delete the
 * reasoning with it, break the ~30 test files that prove those guarantees,
 * and make the branch unmergeable rather than merely dangerous. So the code
 * stays exactly where it is and five call sites — the edge gate, the session
 * authority, the two role guards and the sign-in pages — ask this function
 * first.
 *
 * ─── THE DEFAULT IS "AUTH OFF", AND THAT IS THE DANGEROUS PART ───────────
 *
 * Unset means DISABLED, because a preview deployment that silently keeps its
 * login because someone forgot a build variable is the failure this branch
 * exists to avoid — and because `process.env` reads inside the middleware
 * bundle are resolved when `next build` runs, not when the server starts, so
 * a runtime-only variable would not reliably reach the edge gate at all.
 *
 * The consequence, stated plainly: MERGING THIS BRANCH INTO `main` SHIPS AN
 * APP WITH NO AUTHENTICATION. Set `DISABLE_AUTH=false` at build time before
 * this code goes anywhere near a real deployment, or drop the branch.
 *
 * Two exemptions keep the switch from hiding itself:
 *   - Under the test runner it defaults to auth ON, so the existing auth
 *     suite keeps proving the real behaviour rather than proving this
 *     bypass. src/tests/unit/publicPreview.test.ts pins that.
 *   - Middleware stamps `x-olympuss-auth: disabled` on every response it
 *     lets through, so the state is visible to a developer with devtools
 *     open and invisible to an audience watching a demo.
 *
 * ─── EDGE-SAFE ───────────────────────────────────────────────────────────
 *
 * Imported by src/middleware.ts, so this module may never reach for
 * `next/headers`, `pg`, `server-only` or anything else off the Edge runtime.
 * src/tests/unit/middlewareEdgeSafety.test.ts walks the import graph and
 * fails if that stops being true.
 */
import type { OpsRole } from './rbac/roles';
import type { OpsSessionClaims } from './rbac/session';

/**
 * Who the app says you are when there is no sign-in to ask.
 *
 * Only used when no real `ops_users` row can be read — see
 * `resolveOpsSession` in src/lib/auth/rbac/server.ts, which prefers a real
 * profile precisely so that anything writing `claims.sub` into one of the
 * fourteen columns with an FK to `ops_users(id)` still works in a preview.
 * A synthetic id is the fallback for a deployment with no ops database at
 * all, where those writes were never going to succeed anyway.
 */
export const PREVIEW_OPS_SUBJECT = '00000000-0000-4000-8000-000000000001';
export const PREVIEW_OPS_EMAIL = 'preview@olympuss.ai';

/**
 * The role a preview visitor holds when nothing narrower has been asked for.
 * `control_room` because that is where the simulator lives and it is the
 * widest operational surface; the role guards override it per screen anyway
 * (see previewClaimsFor).
 */
export const PREVIEW_DEFAULT_ROLE: OpsRole = 'control_room';

/** Four hours, matching a real ops session's lifetime. Cosmetic here. */
const PREVIEW_SESSION_SECONDS = 4 * 60 * 60;

function switchValue(): string | undefined {
  // DISABLE_AUTH is the server/edge switch. NEXT_PUBLIC_DISABLE_AUTH is the
  // same decision made visible to client components (OpsSignOut and friends),
  // which cannot see a non-public variable at all. Reading both from one
  // function is what keeps the two halves from ever disagreeing.
  //
  // Both keys are read STATICALLY. `process.env[key]` would be tidier and is
  // wrong: Next replaces `process.env.NEXT_PUBLIC_*` textually at build time,
  // and a computed key is not text it can find, so the browser half would
  // read undefined forever. The `typeof` guard is for the same bundle, where
  // only the NEXT_PUBLIC_ read is guaranteed to have been substituted.
  const server = typeof process === 'undefined' ? undefined : process.env.DISABLE_AUTH;
  const raw = server ?? process.env.NEXT_PUBLIC_DISABLE_AUTH;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : undefined;
}

/**
 * True inside `vitest`. Deliberately NOT `process.env.CI`: on several build
 * platforms CI is set while the production bundle is being built, and since
 * middleware resolves these reads at build time that would quietly re-enable
 * the login on the very deployment this branch is for. CI turns the login
 * back on by setting DISABLE_AUTH=false explicitly instead — see
 * .github/workflows/ci-web.yml's e2e job.
 */
function isTestRunner(): boolean {
  if (typeof process === 'undefined') return false;
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
}

/**
 * Is authentication switched off for this deployment?
 *
 * Accepted values are spelled out both ways so neither `DISABLE_AUTH=0` nor
 * `DISABLE_AUTH=false` is read as the truthy string it technically is.
 */
export function isAuthDisabled(): boolean {
  const raw = switchValue();
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'no') return false;
  if (raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes') return true;
  return !isTestRunner();
}

/**
 * A session for a preview visitor, in the role the calling screen asked for.
 *
 * The role is a parameter rather than a constant because every page guard
 * compares `claims.role` against the one role its screen belongs to
 * (pageGuard.ts) and every API guard against its own allowlist (guard.ts).
 * Handing each of them the role it just asked for is what lets one anonymous
 * visitor walk the whole console — the driver screen as a driver, the depot
 * screen as depot — instead of seeing /ops/forbidden everywhere but one.
 *
 * @param identity The real ops row this preview resolved to, when there is
 *   one. Its id and email are used; its role is not — see above.
 */
export function previewClaimsFor(
  role: OpsRole = PREVIEW_DEFAULT_ROLE,
  identity?: { sub: string; email: string },
): OpsSessionClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: identity?.sub ?? PREVIEW_OPS_SUBJECT,
    email: identity?.email ?? PREVIEW_OPS_EMAIL,
    role,
    iat: now,
    exp: now + PREVIEW_SESSION_SECONDS,
  };
}
