import type { FleetSnapshotView } from '../repositories/types';
import { buildRouteTable } from '../routes/routeTable';
import type { RouteRow } from '../routes/routeTableTypes';
import { cachedRouteProfiles, routeCatalogueRevision } from '../routes/routeCatalogue';
import type { RouteProfile } from '../routes/types';
import { operatingDateOf } from '../sim/seed';
import type { Coverage } from '../types';
import { analyseSnapshot, memoiseBody, type SnapshotAnalysis } from './analysis';

/** The live route table, built once per snapshot's rows. */
export const routeTableOf: (view: FleetSnapshotView) => readonly RouteRow[] = memoiseBody(
  (view, analysis) => buildRouteTable(view.rows, analysis.stateOf, analysis.feedNow),
);

export interface RouteContext {
  readonly analysis: SnapshotAnalysis;
  readonly table: readonly RouteRow[];
  readonly profiles: ReadonlyMap<string, RouteProfile>;
  readonly operatingDate: string;
}

interface Held<T> {
  readonly operatingDate: string;
  readonly revision: number;
  /** Monotonic milliseconds when the body was built. */
  readonly builtAt: number;
  readonly body: T;
}

export interface CatalogueBody<T> {
  readonly body: T;
  /** True when profiles cached since `body` was built wait for the next rebuild. */
  readonly pending: boolean;
}

/**
 * Like `memoiseBody`, for bodies that also read the route catalogue: held per
 * analysis (so per rows array) with the operating date and the catalogue
 * revision they were built for. A new day rebuilds at once; a newly cached
 * profile rebuilds only once `minRebuildMs` have passed since the held body
 * was built, so a burst of profile lookups cannot make every poll rebuild.
 * `now` is a monotonic reading, never the wall clock. The envelope is never
 * part of the body.
 */
export function memoiseOnCatalogue<T>(
  build: (context: RouteContext) => T,
  minRebuildMs: number,
): (view: FleetSnapshotView, now: number) => CatalogueBody<T> {
  const bodies = new WeakMap<SnapshotAnalysis, Held<T>>();
  return (view: FleetSnapshotView, now: number): CatalogueBody<T> => {
    const analysis = analyseSnapshot(view);
    const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
    const revision = routeCatalogueRevision();
    const held = bodies.get(analysis);
    if (held?.operatingDate === operatingDate) {
      if (held.revision === revision) return { body: held.body, pending: false };
      if (now - held.builtAt < minRebuildMs) return { body: held.body, pending: true };
    }
    const profiles = cachedRouteProfiles(view, operatingDate);
    const body = build({ analysis, table: routeTableOf(view), profiles, operatingDate });
    bodies.set(analysis, { operatingDate, revision, builtAt: now, body });
    return { body, pending: false };
  };
}

export function coverageOf<T>(items: readonly T[], counts: (item: T) => boolean): Coverage {
  return { n: items.filter(counts).length, of: items.length };
}

/** Whether a depot runs any of a route's buses. */
export function operatedBy(row: RouteRow, depotId: string): boolean {
  return row.operators.some((o) => o.depotId === depotId);
}
