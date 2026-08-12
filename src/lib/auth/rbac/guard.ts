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
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { getOpsSession } from './server';
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

/** Any authenticated ops user, regardless of role (e.g. logout, session status). */
export async function requireOpsSession(): Promise<OpsGuardResult> {
  const claims = await getOpsSession();
  if (!claims) {
    return {
      ok: false,
      response: structuredError('UNAUTHORIZED', 'Authentication required.', 401),
    };
  }
  return { ok: true, claims };
}

/** An authenticated ops user whose role is one of `allowed`. */
export async function requireOpsRole(allowed: readonly OpsRole[]): Promise<OpsGuardResult> {
  const base = await requireOpsSession();
  if (!base.ok) return base;
  if (!allowed.includes(base.claims.role)) {
    return {
      ok: false,
      response: structuredError('FORBIDDEN', 'Your role does not permit this action.', 403),
    };
  }
  return base;
}
