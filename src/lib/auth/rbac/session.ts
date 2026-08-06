/**
 * Ops session token creation and verification (jose / HS256).
 *
 * Edge-safe — mirrors src/lib/auth/session.ts exactly, but for per-person ops
 * accounts: the claim set carries a user id, email and role instead of a
 * shared project name. Verified independently by middleware and every route
 * handler/layout (defence in depth, same pattern as the PIN system).
 */
import { SignJWT, jwtVerify } from 'jose';
import { isOpsRole, type OpsRole } from './roles';
import { OPS_SESSION_MAX_AGE_SECONDS, getOpsSessionSecret } from './config';

export interface OpsSessionClaims {
  /** ops_users.id */
  sub: string;
  email: string;
  role: OpsRole;
  iat: number;
  exp: number;
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
