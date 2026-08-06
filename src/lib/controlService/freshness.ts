/**
 * Shared "is this observation LIVE" freshness rule for the observability
 * dashboard's per-vehicle LIVE badge. Pure/no I/O so it's usable from both
 * the server-rendered table and its unit tests without mocking fetch.
 */
export const LIVE_THRESHOLD_MS = 30_000;

export function isLiveObservation(observedAt: string, now: number = Date.now()): boolean {
  const observedAtMs = Date.parse(observedAt);
  if (Number.isNaN(observedAtMs)) return false;
  return now - observedAtMs <= LIVE_THRESHOLD_MS;
}
