import type { FleetSnapshotView } from '../repositories/types';
import { cachedRouteProfiles, routeCatalogueRevision } from '../routes/routeCatalogue';
import { operatingDateOf } from '../sim/seed';
import { analyseSnapshot, forgetWithAnalyses, type SnapshotAnalysis } from './analysis';
import { routeTableOf, type CatalogueBody, type RouteContext } from './routeInputs';

export interface FeedTimeBody<T> extends CatalogueBody<T> {
  /** The feed time (`feedNow`) of the snapshot the body was built on. */
  readonly plannedAt: string | null;
}

interface Slot<T> {
  readonly operatingDate: string;
  readonly revision: number;
  /** Monotonic milliseconds when the body was built. */
  readonly builtAt: number;
  /** Feed-clock milliseconds of the snapshot it was built on, when the feed had a clock. */
  readonly feedMs: number | null;
  readonly plannedAt: string | null;
  /** The snapshots it has served, held weakly so none outlives its own snapshot. */
  readonly servedOn: WeakSet<SnapshotAnalysis>;
  readonly body: T;
}

function feedMsOf(feedNow: string | null): number | null {
  if (feedNow === null) return null;
  const ms = Date.parse(feedNow);
  return Number.isFinite(ms) ? ms : null;
}

/** True while the slot may stand for this snapshot: its own rows, or less than `spanMs` of feed time on. */
function withinSpan<T>(
  slot: Slot<T>,
  analysis: SnapshotAnalysis,
  feedMs: number | null,
  spanMs: number,
): boolean {
  if (slot.servedOn.has(analysis)) return true;
  if (feedMs === null || slot.feedMs === null) return false;
  const elapsed = feedMs - slot.feedMs;
  return elapsed >= 0 && elapsed < spanMs;
}

/**
 * Like `memoiseOnCatalogue`, but one body is held across snapshots for
 * `spanMs` of feed time, for a body too costly to rebuild on every snapshot
 * whose inputs move slowly. It is rebuilt when the span has passed on the
 * feed clock (a clock that steps back, or a snapshot with no clock, counts as
 * passed), when the operating date changes, or when the route catalogue's
 * revision changes; a revision change waits until `minRebuildMs` have passed
 * since the last build, so a burst of profile lookups cannot make every poll
 * rebuild. `now` is a monotonic reading, never the wall clock. The envelope is
 * never part of the body.
 */
export function holdOverFeedTime<T>(
  build: (context: RouteContext) => T,
  spanMs: number,
  minRebuildMs: number,
): (view: FleetSnapshotView, now: number) => FeedTimeBody<T> {
  let slot: Slot<T> | null = null;
  forgetWithAnalyses(() => {
    slot = null;
  });
  return (view: FleetSnapshotView, now: number): FeedTimeBody<T> => {
    const analysis = analyseSnapshot(view);
    const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
    const revision = routeCatalogueRevision();
    const feedMs = feedMsOf(view.feedNow);
    const held = slot;
    if (held?.operatingDate === operatingDate && withinSpan(held, analysis, feedMs, spanMs)) {
      const pending = held.revision !== revision;
      if (!pending || now - held.builtAt < minRebuildMs) {
        held.servedOn.add(analysis);
        return { body: held.body, pending, plannedAt: held.plannedAt };
      }
    }
    const profiles = cachedRouteProfiles(view, operatingDate);
    const body = build({ analysis, table: routeTableOf(view), profiles, operatingDate });
    slot = {
      operatingDate,
      revision,
      builtAt: now,
      feedMs,
      plannedAt: view.feedNow,
      servedOn: new WeakSet([analysis]),
      body,
    };
    return { body, pending: false, plannedAt: view.feedNow };
  };
}
