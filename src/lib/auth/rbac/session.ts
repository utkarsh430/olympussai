/**
 * LEGACY ops session token creation and verification (jose / HS256).
 *
 * Edge-safe. Carries a user id, email and role per person — a self-contained
 * signed session minted by POST /api/ops/auth/login.
 *
 * This is the OLD front door and it is retained on purpose while the two auth
 * systems are collapsed onto Supabase (see config.ts's header). It is still
 * accepted at the edge (src/lib/auth/rbac/edgeSession.ts) and by the Node
 * guards (server.ts), so both login paths work at once and rollback is a
 * configuration change. What changed underneath it: this token is no longer
 * the AUTHORITY on anything. Its role is a ceiling; `ops_users.role` and
 * `ops_users.status` are re-read per guarded request and decide.
 */
import { SignJWT, jwtVerify } from 'jose';
import { isOpsRole, type OpsRole } from './roles';
import { OPS_SESSION_MAX_AGE_SECONDS, getOpsSessionSecret } from './config';

export interface OpsSessionClaims {
  /**
   * ops_users.id — and ONLY ever ops_users.id.
   *
   * 27 call sites write this straight into a Postgres column with a FK to
   * `ops_users(id)` (audit actor, dispatcher action, breakdown reporter,
   * invite author, kill-switch operator, …) or pass it to
   * `repo.findUserById`. Five of those columns are `not null` +
   * `on delete restrict`, and two of the tables are append-only and
   * trigger-protected. It also crosses the wire to control-service as
   * `dispatcherId`, into a plain text column with no FK — the one place a
   * wrong id would NOT be caught by a constraint.
   *
   * The Supabase Auth user id is a DIFFERENT uuid in a different system and
   * is exposed separately as `supabaseUserId` below. Never substitute one
   * for the other.
   */
  sub: string;
  email: string;
  role: OpsRole;
  iat: number;
  exp: number;
  /**
   * The Supabase Auth identity this session was established from
   * (`auth.users.id`), when it came in through the Supabase front door.
   * Absent for the legacy ops-cookie path, and absent when the profile has
   * not been linked yet. Informational: nothing authorizes on it, and it must
   * never be written to an ops FK column.
   */
  supabaseUserId?: string;
}

/** Create a signed ops session token for a specific user. */
export async function createOpsSessionToken(user: {
  id: string;
  email: string;
  role: OpsRole;
}): Promise<string> {
  const secret = getOpsSessionSecret();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + OPS_SESSION_MAX_AGE_SECONDS)
    .sign(secret);
}

/**
 * Verify an ops session token. Returns the claims on success, or null on any
 * failure (bad signature, expiry, unknown role, malformed payload). Never
 * throws — callers uniformly deny access on null.
 */
export async function verifyOpsSessionToken(
  token: string | undefined | null,
): Promise<OpsSessionClaims | null> {
  if (!token) return null;
  try {
    const secret = getOpsSessionSecret();
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    if (typeof payload.email !== 'string' || payload.email.length === 0) return null;
    if (!isOpsRole(payload.role)) return null;
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    // OpsAuthConfigError (missing secret) or any jose verification error → deny.
    return null;
  }
}
