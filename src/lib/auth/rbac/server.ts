/**
 * Server-side ops session helpers for Route Handlers and Server Components.
 *
 * Node runtime (next/headers cookies()) — mirrors src/lib/auth/server.ts.
 * Middleware does NOT use this module; it reads the request cookie directly
 * via verifyOpsSessionToken.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { OPS_SESSION_COOKIE, OPS_SESSION_MAX_AGE_SECONDS, isOpsProduction } from './config';
import { createOpsSessionToken, verifyOpsSessionToken, type OpsSessionClaims } from './session';
import type { OpsRole } from './roles';

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isOpsProduction(),
    path: '/',
  };
}

/** Read and verify the current ops session, or null if absent/invalid. */
export async function getOpsSession(): Promise<OpsSessionClaims | null> {
  const store = await cookies();
  const token = store.get(OPS_SESSION_COOKIE)?.value;
  return verifyOpsSessionToken(token);
}

/** Create an ops session for a specific user and write the HttpOnly cookie. */
export async function establishOpsSession(user: {
  id: string;
  email: string;
  role: OpsRole;
}): Promise<void> {
  const token = await createOpsSessionToken(user);
  const store = await cookies();
  store.set(OPS_SESSION_COOKIE, token, {
    ...baseCookieOptions(),
    maxAge: OPS_SESSION_MAX_AGE_SECONDS,
  });
}

/** Clear the ops session cookie (logout). */
export async function clearOpsSession(): Promise<void> {
  const store = await cookies();
  store.set(OPS_SESSION_COOKIE, '', {
    ...baseCookieOptions(),
    maxAge: 0,
  });
}
