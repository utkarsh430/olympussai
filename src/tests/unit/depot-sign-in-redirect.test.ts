import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeNext } from '@/lib/auth/redirect';
import {
  SIGN_IN_PATH,
  redirectToSignIn,
  resetSignInRedirectForTests,
  signInUrl,
} from '@/lib/depot/signInRedirect';

function at(pathname: string, search = '') {
  return { pathname, search, assign: vi.fn() };
}

afterEach(() => resetSignInRedirectForTests());

describe('redirectToSignIn', () => {
  it('sends the browser to sign in with a return path the login page accepts', () => {
    const location = at('/project/depots/depot/12/fuel', '?view=week');
    redirectToSignIn(location);
    expect(location.assign).toHaveBeenCalledWith(
      '/login?next=%2Fproject%2Fdepots%2Fdepot%2F12%2Ffuel%3Fview%3Dweek',
    );
    const next = new URL(String(location.assign.mock.calls[0]?.[0]), 'http://x').searchParams.get('next');
    expect(sanitizeNext(next)).toBe('/project/depots/depot/12/fuel?view=week');
  });

  it('navigates once when several requests answer 401 together', () => {
    const location = at('/project/depots');
    redirectToSignIn(location);
    redirectToSignIn(location);
    expect(location.assign).toHaveBeenCalledTimes(1);
  });

  it('never redirects from the sign-in page itself', () => {
    const location = at(SIGN_IN_PATH, '?next=%2Fproject%2Fdepots');
    redirectToSignIn(location);
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('builds the URL from the path and query alone', () => {
    expect(signInUrl('/project/depots/routes', '')).toBe('/login?next=%2Fproject%2Fdepots%2Froutes');
  });
});
