'use client';

import { useEffect, useState } from 'react';

/** Under this width the roster keeps three short columns (the shell's phone breakpoint). */
const PHONE_QUERY = '(max-width: 639px)';

/** True under 640px. Starts false so the server render and the first paint agree. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(PHONE_QUERY);
    setPhone(query.matches);
    const handler = (event: MediaQueryListEvent): void => setPhone(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  return phone;
}
