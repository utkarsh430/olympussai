/**
 * Server-side session helpers for Route Handlers and Server Components.
 *
 * These use the Next.js `cookies()` API (Node runtime). Middleware does NOT use
 * this module — it reads the request cookie directly. The signed token stays in
 * an HttpOnly cookie and is never handed to client JavaScript.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  isAuthorizedProject,
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

/**
 * Server-component gate: return the session, or redirect to login carrying the
 * path to come back to. Defence in depth behind the edge middleware — every
 * protected layout and page calls it, because layouts do not re-run on client
 * navigation.
 */
export async function requireProjectSession(nextPath: string): Promise<SessionClaims> {
  const session = await getSession();
  if (!session || !isAuthorizedProject(session.project)) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return session;
}
