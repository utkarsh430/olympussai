import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createMiddlewareSupabaseClient, getMiddlewareUser } from '@/lib/supabase/middleware';
import { resolveOpsEdgeCeiling } from '@/lib/auth/rbac/edgeSession';
import { roleForSegment, rolesForOpsApiPath, isPublicOpsApiPath } from '@/lib/auth/rbac/roles';

/**
 * Edge middleware — the first line of defence for protected surfaces.
 *
 * This is NOT the only check: the protected layout and every UPSRTC API verify
 * the session independently (Section 10). Middleware only imports edge-safe
 * code (`@supabase/ssr`); the Node-only service-role client and next/headers
 * are never pulled in here.
 *
 * - Credential-less page request under /project/*  → redirect to /login?next=…
 * - Credential-less API request under /api/upsrtc/* → 401 JSON
 *
 * See handleProjectRequest below for what this branch does and, more
 * importantly, what it deliberately does NOT decide.
 *
 * /ops/* and /api/ops/* (the multi-role RBAC surface) are handled by a
 * separate branch (handleOpsRequest, below). Those two auth systems used to
 * be deliberately independent, with separate cookies and separate secrets.
 * They are being collapsed onto one front door: the ops branch now accepts a
 * Supabase session carrying an `app_metadata.ops_role` claim, AND the legacy
 * ops cookie, so both login paths keep working until the cutover is proven.
 * See src/lib/auth/rbac/edgeSession.ts.
 *
 * /api/control-service/* is machine-to-machine and authenticates itself — see
 * PUBLIC_MACHINE_API_PREFIXES below.
 */
export const config = {
  // Deliberately an allowlist of protected prefixes, NOT a broad '/api/:path*'.
  // /api/control-service/* must never appear here, directly or via a wider
  // pattern — see PUBLIC_MACHINE_API_PREFIXES for why. The `middleware`
  // function below repeats the exemption so widening this matcher later
  // cannot silently break inbound webhooks.
  matcher: ['/project/:path*', '/api/upsrtc/:path*', '/ops/:path*', '/api/ops/:path*'],
};

/**
 * Paths that carry their own request-level authentication and must never be
 * touched by a session gate.
 *
 * /api/control-service/webhook receives HMAC-signed deliveries from the
 * control service. It has no cookie, no Supabase user and no ops session — the
 * signature is the entire authentication (see that route's doc comment).
 *
 * Why this is repeated here even though `config.matcher` already excludes it:
 * the failure mode is silent and total. If a session gate ever did apply, the
 * unauthenticated POST would be answered with a redirect to a login page —
 * which fetch() follows — so the sender would receive HTTP 200 with an HTML
 * body and mark the event DELIVERED. Every command lifecycle event would be
 * discarded while every dashboard reported success. Belt and braces is cheap;
 * that outage is not.
 */
const PUBLIC_MACHINE_API_PREFIXES = ['/api/control-service/'] as const;

function isPublicMachineApi(pathname: string): boolean {
  return PUBLIC_MACHINE_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Role gate for the ops RBAC surface.
 *
 * Pages (/ops/<segment>/...) are checked by their first URL segment alone,
 * with strict equality against the caller's role — a page is one role's
 * screen, and nothing should widen it (roleForSegment gives exactly one
 * role, so `allowedRoles.includes(claims.role)` below behaves as strict
 * equality here).
 *
 * API routes (/api/ops/<segment>/...) are checked via
 * rolesForOpsApiPath(pathname, method) instead, which returns a segment's
 * bare role UNLESS a more specific, method-scoped override applies
 * (OPS_API_ROLE_OVERRIDES in src/lib/auth/rbac/roles.ts — see that file for
 * why some API routes need a wider or otherwise-undeterminable-from-the-URL
 * allowlist). Middleware's check is a CEILING, not the decision: every ops
 * route handler calls requireOpsRole itself with its own, authoritative,
 * narrow allowlist (src/lib/auth/rbac/guard.ts) and never trusts middleware
 * alone.
 *
 * Paths whose segment is not a role surface at all (auth, login, forbidden)
 * are intentionally left unchecked here — each such route enforces whatever
 * it individually needs. That exemption is an explicit allowlist
 * (isPublicOpsApiPath for API routes; page segments are never role-gated
 * unless roleForSegment says so), not "anything unrecognised passes" — an
 * /api/ops/* path that is neither role-gated nor on that allowlist fails
 * CLOSED below to "must be authenticated", so a brand-new /api/ops/fleet/*
 * route nobody has added an override for yet cannot reach its handler with
 * zero check the way GET /api/ops/fleet/schedule and .../breakdown-reports
 * both used to before their overrides existed (and the way HEAD/POST on
 * either still could, since OPS_API_ROLE_OVERRIDES only lists GET).
 *
 * Authenticated-but-wrong-role never bounces to /ops/login (that would imply
 * "you are not signed in", which is false and would invite retrying with a
 * different account); it redirects to /ops/forbidden / returns 403 instead.
 *
 * WHERE THE ROLE COMES FROM, and why it is only a ceiling: the Edge runtime
 * cannot reach `pg`, so it cannot read `ops_users`. It reads a role out of a
 * verified token instead — a Supabase access token's
 * `app_metadata.ops_role`, verified LOCALLY against the project's published
 * signing keys, or the legacy ops cookie (src/lib/auth/rbac/edgeSession.ts).
 * That role is baked in at mint time, so it is stale after a role change and
 * says nothing at all about whether the account has since been disabled.
 * Every ops route handler and layout re-reads `ops_users` itself and can
 * still refuse (src/lib/auth/rbac/server.ts). Nothing here is ever the
 * decision.
 *
 * Note it verifies the token locally rather than calling
 * `getMiddlewareUser()` / `supabase.auth.getUser()` as the project branch
 * below does. `getUser()` is unconditionally an HTTP round-trip to Supabase
 * Auth; using it here would put a network hop on every ops page load and
 * every ops API call — where today there is none — and would make the whole
 * control surface unavailable during a Supabase Auth outage.
 */
async function handleOpsRequest(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith('/api/ops/');
  const root = isApi ? '/api/ops/' : '/ops/';
  const segment = pathname.slice(root.length).split('/')[0] ?? '';

  const allowedRoles = isApi
    ? rolesForOpsApiPath(pathname, request.method)
    : (() => {
        const role = roleForSegment(segment);
        return role ? [role] : null;
      })();

  // Built even for public paths so a refreshed Supabase auth cookie is
  // carried back on the response; constructing the client is local work, not
  // a network call.
  const { supabase, supabaseResponse } = createMiddlewareSupabaseClient(request);

  if (!allowedRoles && (!isApi || isPublicOpsApiPath(pathname))) {
    // Genuinely not a role surface at all: an intentionally public page
    // (login/forbidden/accept-invite) or an API path that authenticates
    // itself (/api/ops/auth/*, e.g. the login call itself, which by
    // definition cannot require a session yet). The route handler or layout
    // enforces whatever it individually needs.
    return supabaseResponse;
  }

  const ceiling = await resolveOpsEdgeCeiling(request, supabase);

  // allowedRoles is null past this point only for an /api/ops/* path this
  // map cannot classify (see the doc comment above) — that still requires a
  // valid session (any role), just not a specific one; the route handler's
  // own requireOpsRole remains the real, narrow decision either way.
  if (ceiling && (!allowedRoles || allowedRoles.includes(ceiling.role))) {
    return supabaseResponse;
  }

  if (isApi) {
    if (ceiling) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Your role does not permit this action.' } },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (ceiling) {
    return NextResponse.redirect(new URL('/ops/forbidden', request.url));
  }

  const loginUrl = new URL('/ops/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

/**
 * Credential gate for the enterprise project surface (/project/* and
 * /api/upsrtc/*).
 *
 * THIS BRANCH DECIDES NOTHING, AND SAYING SO IS THE POINT. It used to be
 * `if (user) return supabaseResponse;` sitting in front of a route layout and
 * two API handlers that also only asked "is there a Supabase user?" — so the
 * edge check WAS the decision by default, and with public self-signup on the
 * Supabase project it admitted anyone who could complete a registration form
 * to the whole command centre and the live fleet feed.
 *
 * Admission is now decided where `ops_users` can actually be read: the page
 * guard (src/lib/auth/projectPageGuard.ts) and the API guard
 * (src/lib/auth/authorize.ts), both re-reading role and status per request.
 * What is left here is a CEILING, in the same relationship to those guards
 * that handleOpsRequest's role check has to `requireOpsRole` — cheap, coarse,
 * and never the last word.
 *
 * WHY IT IS NOT TIGHTENED FURTHER, WHICH IS A DELIBERATE CHOICE AND NOT AN
 * OVERSIGHT. The obvious tightening is to demand `app_metadata.ops_role`
 * here, exactly as the ops branch does. It is rejected because a CEILING MUST
 * NEVER REFUSE WHAT THE AUTHORITY WOULD ADMIT, and it would:
 *
 *   - A linked, active ops account whose role claim has not been pushed yet
 *     is admitted by the authority (`resolveOpsSession` treats a null claim
 *     as "no ceiling", not as a mismatch) but carries no claim to check here.
 *     That state is not exotic — it is every account between step 1 and step
 *     4 of docs/olympuss/AUTH_CUTOVER_RUNBOOK.md, and step 0 of that runbook
 *     is "sign in at /login and land on /project/upsrtc".
 *   - From the Edge, that account is indistinguishable from a stranger's
 *     self-signup: both are a valid Supabase session with no ops claim. The
 *     difference lives in a database this runtime cannot reach.
 *
 * So the edge would have to refuse both or admit both. Refusing both closes
 * the hole one layer earlier and locks every un-pushed operator out of the
 * product for the length of the cutover; admitting both lets a stranger's
 * request reach a Node guard that answers it with a 401 and no data. The
 * second is the same security outcome for one wasted round-trip, so it wins.
 *
 * WHAT DID CHANGE HERE, BESIDES THE FRAMING: the legacy ops cookie is now
 * accepted. It resolves to a real ops profile in `resolveOpsSession`, so the
 * authority already admitted those requests — the edge was refusing them and
 * bouncing operators to /login. That is the same ceiling-inversion described
 * above, and it was live: the legacy password door is the cutover's lockout
 * safety net, and a safety net that cannot reach the product it is meant to
 * rescue you into is not one.
 */
async function handleProjectRequest(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const { supabase, supabaseResponse } = createMiddlewareSupabaseClient(request);

  const user = await getMiddlewareUser(supabase);
  if (user) return supabaseResponse;

  // No Supabase session. Before refusing, check the legacy ops door — an
  // operator holding only that cookie has a real, active ops profile behind
  // it, which is strictly more than the Supabase session above proves.
  const ceiling = await resolveOpsEdgeCeiling(request, supabase);
  if (ceiling) return supabaseResponse;

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Checked first, ahead of both auth systems: these paths authenticate
  // themselves per-request and must reach their handler untouched.
  if (isPublicMachineApi(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/ops/') || pathname.startsWith('/api/ops/')) {
    return handleOpsRequest(request);
  }

  return handleProjectRequest(request);
}
