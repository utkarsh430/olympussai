'use client';

import { useSyncExternalStore } from 'react';
import type { PolledState } from '@/hooks/usePolledJson';

const subscribeNever = (): (() => void) => () => undefined;

/**
 * False while the calling component renders on the server or hydrates, true otherwise.
 * After hydration React sees the snapshot change and renders the component again at once.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * A shared poll as it was before its first answer: what the server rendered. The shell's
 * providers sit above each page's Suspense boundary, and a boundary can hydrate after the
 * poll has answered, so a hydrating consumer reads this and gets the answer one render later.
 */
export function beforeFirstAnswer<S extends PolledState<unknown>>(state: S): S {
  return { ...state, data: null, error: null, loading: true, previous: false };
}
