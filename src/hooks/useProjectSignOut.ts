'use client';

import { useCallback, useState } from 'react';

/**
 * Project sign-out behaviour shared by every protected project surface.
 *
 * Calls the server logout endpoint (clears the HttpOnly cookie) then
 * hard-navigates to /login, so the now-unauthenticated client cannot keep
 * rendering protected state. `pending` stays true until the page unloads.
 */
export function useProjectSignOut(): { signOut: () => void; pending: boolean } {
  const [pending, setPending] = useState(false);

  const signOut = useCallback((): void => {
    setPending(true);
    void (async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {
        // Even if the request fails, fall through to the login page; the
        // protected route + APIs re-verify server-side regardless.
      }
      window.location.assign('/login');
    })();
  }, []);

  return { signOut, pending };
}
