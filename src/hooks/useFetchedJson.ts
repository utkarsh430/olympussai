'use client';

import { useJsonResource } from '@/hooks/usePolledJson';

export interface FetchedState<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
}

/** One-shot fetch per URL: same rules and fixed error strings as `usePolledJson`, no timer. */
export function useFetchedJson<T>(url: string | null): FetchedState<T> {
  const { data, error, loading } = useJsonResource<T>(url, null);
  return { data, error, loading };
}
