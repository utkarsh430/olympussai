'use client';

import { useJsonResource } from '@/hooks/usePolledJson';

export interface FetchedState<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
  /** True while `data` is the previous query's answer; see `usePolledJson`. */
  readonly previous?: boolean;
}

export interface FetchedJsonOptions {
  /** Keep the last answer while a new query of the same resource loads; see `usePolledJson`. */
  readonly keepPreviousOnQueryChange?: boolean;
}

/** One-shot fetch per URL: same rules and fixed error strings as `usePolledJson`, no timer. */
export function useFetchedJson<T>(
  url: string | null,
  options: FetchedJsonOptions = {},
): FetchedState<T> {
  const { data, error, loading, previous } = useJsonResource<T>(
    url,
    null,
    undefined,
    options.keepPreviousOnQueryChange,
  );
  return { data, error, loading, previous };
}
