import { z } from 'zod';
import { isValidDepotId } from '../ids';
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
  readonly body: T;
}

/**
 * Like `memoiseBody`, for bodies that also read the route catalogue: held per
 * analysis (so per rows array) with the operating date and the catalogue
 * revision they were built for. A newly cached profile, or a new day, rebuilds
 * the body; a stale-then-fresh pair of requests on the same rows shares it.
 * The envelope is never part of the body.
 */
export function memoiseOnCatalogue<T>(
  build: (context: RouteContext) => T,
): (view: FleetSnapshotView) => T {
  const bodies = new WeakMap<SnapshotAnalysis, Held<T>>();
  return (view: FleetSnapshotView): T => {
    const analysis = analyseSnapshot(view);
    const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
    const revision = routeCatalogueRevision();
    const held = bodies.get(analysis);
    if (held?.operatingDate === operatingDate && held.revision === revision) return held.body;
    const profiles = cachedRouteProfiles(view);
    const body = build({ analysis, table: routeTableOf(view), profiles, operatingDate });
    bodies.set(analysis, { operatingDate, revision, body });
    return body;
  };
}

export function coverageOf<T>(items: readonly T[], counts: (item: T) => boolean): Coverage {
  return { n: items.filter(counts).length, of: items.length };
}

/** The one query both route endpoints take: an optional depot filter. */
export interface RouteFilterQuery {
  readonly depotId: string | null;
}

export type ParsedRouteFilter =
  { readonly ok: true; readonly query: RouteFilterQuery } | { readonly ok: false };

const filterSchema = z.object({ depotId: z.string().refine(isValidDepotId).optional() }).strict();

/**
 * Validates the query before any snapshot is read. Strict: an unknown or
 * repeated parameter, or a depot id that is not a feed id, fails, and the
 * caller answers 400 without saying which.
 */
export function parseRouteFilter(searchParams: URLSearchParams): ParsedRouteFilter {
  const keys = [...searchParams.keys()];
  if (new Set(keys).size !== keys.length) return { ok: false };
  const parsed = filterSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return { ok: false };
  return { ok: true, query: { depotId: parsed.data.depotId ?? null } };
}

/** Whether a depot runs any of a route's buses. */
export function operatedBy(row: RouteRow, depotId: string): boolean {
  return row.operators.some((o) => o.depotId === depotId);
}
