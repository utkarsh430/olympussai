/**
 * Session token creation and verification (jose / HS256).
 *
 * Edge-safe — jose runs on both the Edge and Node runtimes, so middleware and
 * route handlers verify tokens through the same code path. The signed token is
 * only ever transported in an HttpOnly cookie; it is never exposed to
 * client-side JavaScript.
 */
import { SignJWT, jwtVerify } from 'jose';
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_ROLE,
  getSessionSecret,
} from './config';

export interface SessionClaims {
  /** Project the session grants access to (e.g. "upsrtc"). */
  project: string;
  /** Fixed authorization role. */
  role: string;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiration (epoch seconds). */
  exp: number;
}

/** Create a signed session token for a project. */
export async function createSessionToken(project: string): Promise<string> {
  const secret = getSessionSecret();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ project, role: SESSION_ROLE })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(secret);
}

/**
 * Verify a session token. Returns the claims on success, or null on any
 * failure (bad signature, expiry, wrong role, malformed payload). Never throws.
 */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const secret = getSessionSecret();
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload.project !== 'string' || payload.project.length === 0) return null;
    if (payload.role !== SESSION_ROLE) return null;
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
    return {
      project: payload.project,
      role: payload.role,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    // AuthConfigError (missing secret) or any jose verification error → deny.
    return null;
  }
}
