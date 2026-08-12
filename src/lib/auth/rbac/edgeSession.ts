/**
 * The ops role CEILING as seen from Edge middleware.
 *
 * Edge-safe: no `pg`, no `next/headers`, no `server-only`. This is the
 * seam `src/middleware.ts` calls instead of reading a cookie itself, so the
 * middleware's own shape does not change as the front door moves.
 *
 * DUAL-ACCEPT, ON PURPOSE. During the cutover BOTH front doors work:
 *
 *   1. A Supabase Auth session whose access token carries
 *      `app_metadata.ops_role` (the new path).
 *   2. The legacy `olympuss_ops_session` HS256 cookie minted by
 *      POST /api/ops/auth/login (the old path).
 *
 * Supabase is consulted first because it is the intended front door, but a
 * Supabase session with NO ops role claim does NOT deny — it falls through to
 * the legacy cookie. That fall-through is what lets an operator who is signed
 * in to the project surface as a plain viewer, or whose role claim has not
 * been pushed yet, keep using the old login. Removing it is a cutover step,
 * not a cleanup.
 *
 * DELIBERATELY NOT `OpsSessionClaims`. This returns a role and nothing else.
 * Middleware has no way to resolve a Supabase user id to an `ops_users.id`
 * (that needs the database, which the Edge runtime cannot reach), and
 * `OpsSessionClaims.sub` means `ops_users.id` to 27 call sites that write it
 * straight into FK columns pointing at `ops_users(id)`. Handing middleware a
 * claims object it could only half-populate is how a Supabase uuid ends up in
 * an audit row. A ceiling is all middleware needs and all it gets.
 */
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPS_SESSION_COOKIE } from './config';
import { verifyOpsSessionToken } from './session';
import { readSupabaseOpsClaim } from './supabaseClaims';
import type { OpsRole } from './roles';

export interface OpsEdgeCeiling {
  /**
   * The most this request may reach, per the token alone. NOT a decision:
   * every ops route handler and layout re-reads `ops_users` and can still
   * deny (src/lib/auth/rbac/server.ts).
   */
  role: OpsRole;
  /** Which front door supplied it. Diagnostics only — never an authorization input. */
  source: 'supabase' | 'legacy-ops-cookie';
}

/**
 * Resolve the ops ceiling for a request, or null when neither front door
 * yields one. Never throws; null always means deny.
 *
 * @param supabase Client built from this request's cookies, or null when
 *   Supabase is not configured in this environment (then only the legacy
 *   cookie can produce a ceiling).
 */
export async function resolveOpsEdgeCeiling(
  request: NextRequest,
  supabase: SupabaseClient | null,
): Promise<OpsEdgeCeiling | null> {
  const supabaseClaim = await readSupabaseOpsClaim(supabase);
  if (supabaseClaim?.roleClaim) {
    return { role: supabaseClaim.roleClaim, source: 'supabase' };
  }

  const legacy = await verifyOpsSessionToken(request.cookies.get(OPS_SESSION_COOKIE)?.value);
  if (legacy) {
    return { role: legacy.role, source: 'legacy-ops-cookie' };
  }

  return null;
}
