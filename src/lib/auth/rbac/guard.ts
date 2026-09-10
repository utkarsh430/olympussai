/**
 * Per-request role guard for ops API route handlers.
 *
 * This is the SECOND independent check (middleware is the first — defence in
 * depth, the same pattern requireUpsrtcAccess() follows for the Supabase-Auth
 * surface). Every ops
 * route handler calls one of these itself and never trusts middleware alone,
 * so a middleware matcher mistake can never be the only thing standing
 * between a request and another role's endpoint.
 *
 * Ordering with middleware's OPS_API_ROLE_OVERRIDES map
 * (src/lib/auth/rbac/roles.ts): that map is a CEILING — an edge-safe
 * approximation of who may reach a route at all — while the `allowed` list
 * passed to requireOpsRole here is the DECISION. A route's real allowlist
 * always lives here; the map exists only so middleware doesn't 403 a
 * request the route handler would have accepted.
 *
 * The same ordering now runs one level deeper. Middleware's role check reads
 * a role out of a verified TOKEN (Supabase `app_metadata.ops_role`, or the
 * legacy ops cookie) — fast, and necessarily stale. `resolveOpsSession()`
 * behind these guards re-reads `ops_users` on every call, so the DATABASE
 * decides the role, a disabled account is refused on its very next request
 * rather than when its token happens to expire, and a token whose role
 * disagrees with the database is refused outright instead of either value
 * being guessed at. See src/lib/auth/rbac/server.ts.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { resolveOpsSession, type OpsSessionDenial } from './server';
import { isAuthDisabled } from '@/lib/auth/publicPreview';
import type { OpsRole } from './roles';
import type { OpsSessionClaims } from './session';

export interface OpsGuardOk {
  ok: true;
  claims: OpsSessionClaims;
}
export interface OpsGuardFail {
  ok: false;
  response: NextResponse;
}
export type OpsGuardResult = OpsGuardOk | OpsGuardFail;

function structuredError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * How each refusal reaches the client. The four caller-side reasons are 401
 * rather than 403: none of them mean "your role is too narrow for this
 * endpoint" (that is FORBIDDEN, below) — they mean this session cannot be
 * used at all and the caller must authenticate again. A distinct code per
 * reason so a client can tell a plain sign-in prompt from a stale session
 * that a re-login repairs, without this guard ever explaining WHY an account
 * was refused to the account itself.
 *
 * `unavailable` is the one that is not about the caller at all, and it is a
 * 503: the ops database could not be read, so this service has no answer
 * rather than a negative one. Telling a client "authentication required" for
 * an outage would have every operator's console invite them to re-enter
 * credentials that cannot help, and would make an outage indistinguishable
 * from a mass sign-out in the logs. It stays a refusal — never an access
 * result, and never satisfied from the token's own role claim.
 */
const DENIAL_RESPONSES: Record<
  OpsSessionDenial,
  { code: string; message: string; status: number }
> = {
  no_session: { code: 'UNAUTHORIZED', message: 'Authentication required.', status: 401 },
  no_profile: { code: 'UNAUTHORIZED', message: 'Authentication required.', status: 401 },
  profile_disabled: { code: 'UNAUTHORIZED', message: 'Authentication required.', status: 401 },
  role_claim_mismatch: {
    code: 'SESSION_STALE',
    message: 'Your session is out of date. Please sign in again.',
    status: 401,
  },
  unavailable: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Operations sign-in is temporarily unavailable. Try again shortly.',
    status: 503,
  },
};

/** Any authenticated ops user, regardless of role (e.g. logout, session status). */
export async function requireOpsSession(): Promise<OpsGuardResult> {
  const resolution = await resolveOpsSession();
  if (!resolution.ok) {
    const { code, message, status } = DENIAL_RESPONSES[resolution.reason];
    return { ok: false, response: structuredError(code, message, status) };
  }
  return { ok: true, claims: resolution.claims };
}

/** An authenticated ops user whose role is one of `allowed`. */
export async function requireOpsRole(allowed: readonly OpsRole[]): Promise<OpsGuardResult> {
  const base = await requireOpsSession();
  if (!base.ok) return base;

  // PUBLIC PREVIEW: the page-guard substitution (pageGuard.ts), applied to
  // endpoints. A console whose screens all render but whose fetches all 403
  // is a broken demo rather than an ungated one, so the preview visitor is
  // given the first role this endpoint accepts. `allowed` is never empty at
  // any call site, but the `?? role` keeps that from being load-bearing.
  if (isAuthDisabled() && !allowed.includes(base.claims.role)) {
    return { ok: true, claims: { ...base.claims, role: allowed[0] ?? base.claims.role } };
  }

  if (!allowed.includes(base.claims.role)) {
    return {
      ok: false,
      response: structuredError('FORBIDDEN', 'Your role does not permit this action.', 403),
    };
  }
  return base;
}
