/**
 * Where an expired session goes: the sign-in page, with a `next` that brings the user
 * back to the page they were on. The login page passes `next` through `sanitizeNext`
 * (`lib/auth/redirect.ts`), which accepts a root-relative path under a protected root
 * and falls back to the project home for anything else.
 */

export const SIGN_IN_PATH = '/login';

/** The parts of `window.location` the redirect reads and calls, so tests can pass a stand-in. */
export interface SignInLocation {
  readonly pathname: string;
  readonly search: string;
  readonly assign: (url: string) => void;
}

/** The sign-in URL that returns to `pathname` + `search`. */
export function signInUrl(pathname: string, search: string): string {
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(`${pathname}${search}`)}`;
}

let redirecting = false;

/**
 * Sends the browser to sign in, once: several requests answering 401 together navigate
 * once. Never from the sign-in page itself, so a 401 there cannot loop.
 */
export function redirectToSignIn(location: SignInLocation = window.location): void {
  if (redirecting || location.pathname === SIGN_IN_PATH) return;
  redirecting = true;
  location.assign(signInUrl(location.pathname, location.search));
}

/** Test seam: forget that a redirect was started. */
export function resetSignInRedirectForTests(): void {
  redirecting = false;
}
