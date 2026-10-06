import { getLiveSnapshot, type LiveSnapshotResult } from '@/lib/upsrtc/liveSnapshot';
import type { FleetRepository, FleetSnapshotView } from './types';

/**
 * How old last-good data may be before the depot pages call the feed stale. The shared
 * snapshot marks every answer served after a failed refresh as stale, however young the
 * data; for the depot pages one failed refresh is not an outage. The feed itself changes
 * about every 40 seconds, so data up to 90 seconds old (two of its periods) is as good as
 * the feed. Freshness, not the path that served the answer, decides the flag here; the
 * answer still carries the time it was fetched, and the saved sample is always stale.
 */
export const LAST_GOOD_FRESH_MS = 90_000;

function staleForDepots(result: LiveSnapshotResult, nowMs: number): boolean {
  if (result.source === 'fixture') return true;
  if (!result.stale) return false;
  const fetchedMs = Date.parse(result.snapshot.fetchedAt);
  if (!Number.isFinite(fetchedMs)) return true;
  // A negative age means this machine's clock stepped back below the fetch (P7): the age is
  // unknown, so the data is not called fresh rather than fresh until the clock catches up.
  const ageMs = nowMs - fetchedMs;
  return ageMs < 0 || ageMs > LAST_GOOD_FRESH_MS;
}

/**
 * The fleet as the shared live snapshot sees it. The map route reads the same
 * snapshot, so a depot count and a map pin always describe one upstream fetch.
 *
 * Rows are passed through, never copied. Besides saving a copy of ~9.6k rows,
 * this is load-bearing: the depot analysis is memoised on the identity of the
 * rows array, so copying here would re-run the analysis on every request.
 */
export function createLiveFleetRepository(
  // Data younger than the fresh limit is answered at once and refreshed in the background:
  // a depot poll never waits on the upstream while what it would show is still fresh.
  load: () => Promise<LiveSnapshotResult> = () =>
    getLiveSnapshot(Date.now(), { serveLastGoodWithinMs: LAST_GOOD_FRESH_MS }),
  now: () => number = () => Date.now(),
): FleetRepository {
  return {
    async snapshot(): Promise<FleetSnapshotView> {
      const result = await load();
      const { snapshot, source } = result;
      return {
        rows: snapshot.depotRows,
        feedNow: snapshot.feedNow,
        fetchedAt: snapshot.fetchedAt,
        source,
        stale: staleForDepots(result, now()),
        feedClockAheadRows: snapshot.feedClockAheadRows,
        recordCount: snapshot.recordCount,
      };
    },
  };
}

export const liveFleetRepository: FleetRepository = createLiveFleetRepository();
