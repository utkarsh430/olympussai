'use client';

import { useCallback, useState } from 'react';

/**
 * Project sign-out behaviour shared by every protected project surface.
 *
 * Calls the server logout endpoint (clears the HttpOnly cookie) then
 * hard-navigates to /login, so the now-unauthenticated client cannot keep
 * rendering protected state. `pending` stays true until the page unloads.
 * When the logout request fails or is refused, the cookie may still be valid, so
 * the user stays on the page with `failed` set rather than being told they are out.
 */
export function useProjectSignOut(): { signOut: () => void; pending: boolean; failed: boolean } {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const signOut = useCallback((): void => {
    setPending(true);
    setFailed(false);
    void (async () => {
      let ok = false;
      try {
        ok = (await fetch('/api/auth/logout', { method: 'POST' })).ok;
      } catch {
        ok = false;
      }
      if (ok) {
        window.location.assign('/login');
        return;
      }
      setPending(false);
      setFailed(true);
    })();
  }, []);

  return { signOut, pending, failed };
}
