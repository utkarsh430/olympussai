/**
 * Server-side session helpers for Route Handlers and Server Components.
 *
 * These use the Next.js `cookies()` API (Node runtime). Middleware does NOT use
 * this module — it reads the request cookie directly. The signed token stays in
 * an HttpOnly cookie and is never handed to client JavaScript.
 */
import 'server-only';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  isProduction,
} from './config';
import { createSessionToken, verifySessionToken, type SessionClaims } from './session';

/** Cookie attributes shared by set and clear (Section 10). */
function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
  };
}

/** Read and verify the current session, or null if absent/invalid. */
export async function getSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

/** Create a session for a project and write the HttpOnly cookie. */
export async function establishSession(project: string): Promise<void> {
  const token = await createSessionToken(project);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    ...baseCookieOptions(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Clear the session cookie (logout). */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', {
    ...baseCookieOptions(),
    maxAge: 0,
  });
}
