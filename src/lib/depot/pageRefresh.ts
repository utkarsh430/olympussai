/**
 * Which of the open page's own data requests are failing after a success, so the shell
 * can say at once that the figures on screen are the last ones received. The polling
 * hook writes here; the shell's notice, the feed chip and the provenance line read it.
 * A tiny external store (for `useSyncExternalStore`) so no page has to pass anything:
 * every depot data hook is a call to the polling hook, which reports for it.
 */

export interface RefreshFailure {
  /** The feed time of the last figures received (the feed's own clock), null if unknown. */
  readonly since: string | null;
}

/** What the shell shows: whether any of the page's own requests is failing, and since when. */
export interface PageRefreshState {
  readonly failed: boolean;
  /** The oldest feed time among the failing requests' last figures; null when none is known. */
  readonly since: string | null;
}

export const PAGE_REFRESH_OK: PageRefreshState = { failed: false, since: null };

type Listener = () => void;

const NO_FAILURES: ReadonlyMap<string, RefreshFailure> = new Map();
let failures: ReadonlyMap<string, RefreshFailure> = NO_FAILURES;
const listeners = new Set<Listener>();

/** Records (or, with null, clears) one request's failure; listeners hear only real changes. */
export function reportRefreshFailure(key: string, failure: RefreshFailure | null): void {
  const current = failures.get(key);
  if (failure === null ? current === undefined : current?.since === failure.since) return;
  const next = new Map(failures);
  if (failure === null) next.delete(key);
  else next.set(key, failure);
  failures = next;
  listeners.forEach((listener) => listener());
}

export function subscribeRefreshFailures(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current failures; a new map only when something changed, so it is a stable snapshot. */
export function refreshFailuresSnapshot(): ReadonlyMap<string, RefreshFailure> {
  return failures;
}

/** Nothing has failed on the server, which never polls. */
export function serverRefreshFailuresSnapshot(): ReadonlyMap<string, RefreshFailure> {
  return NO_FAILURES;
}

/** The oldest known feed time wins: the notice must not make old figures look newer. */
export function pageRefreshState(all: ReadonlyMap<string, RefreshFailure>): PageRefreshState {
  if (all.size === 0) return PAGE_REFRESH_OK;
  const times = [...all.values()]
    .map((failure) => failure.since)
    .filter((since): since is string => since !== null)
    .sort();
  return { failed: true, since: times[0] ?? null };
}

/** The feed time a response carries, if it carries one; responses are otherwise opaque here. */
export function feedTimeOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('feedNow' in payload)) return null;
  const feedNow = (payload as { readonly feedNow: unknown }).feedNow;
  return typeof feedNow === 'string' ? feedNow : null;
}
