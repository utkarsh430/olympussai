import type { DepotBusView } from '../api';
import { compareText } from '../exceptions/depotExceptions';
import type { FleetSnapshotView, DepotRepositories } from '../repositories/types';
import type { RevenueResponse } from '../revenue/api';
import { analyseRevenue } from '../revenue/analysis';
import type { RevenueAnalysis, RouteFacts } from '../revenue/types';
import { cachedRouteProfiles, routeCatalogueRevision } from '../routes/routeCatalogue';
import type { RouteProfile } from '../routes/types';
import { MIXED_CLASS_NOTE, REVENUE_MODEL_PARAMS } from '../sim/revenueConfig';
import { operatingDateOf } from '../sim/seed';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { buildDepotDetail } from './depotView';

type RevenueBody = Omit<RevenueResponse, keyof ReturnType<typeof feedEnvelope>>;

export type RevenueSource = Pick<DepotRepositories, 'revenue'>;

/** Route facts for the routes these buses run; a route with no cached profile has no length. */
export function routeFactsFor(
  buses: readonly DepotBusView[],
  profiles: ReadonlyMap<string, RouteProfile>,
): RouteFacts[] {
  const names = new Set(buses.flatMap((b) => (b.routeName === null ? [] : [b.routeName])));
  return [...names].map((routeName) => ({
    routeName,
    scheduledDurationMin: profiles.get(routeName)?.scheduledDurationMin ?? null,
    lengthKm: profiles.get(routeName)?.lengthKm ?? null,
  }));
}

/** The modelled day for one depot's buses, analysed. Used by the depot page and the network ranking. */
export async function analyseDepotRevenue(
  repositories: RevenueSource,
  buses: readonly DepotBusView[],
  profiles: ReadonlyMap<string, RouteProfile>,
  operatingDate: string,
): Promise<RevenueAnalysis> {
  const days = await repositories.revenue.ridershipDay(
    buses,
    routeFactsFor(buses, profiles),
    operatingDate,
  );
  return analyseRevenue(days);
}

interface Held<T> {
  readonly operatingDate: string;
  readonly revision: number;
  readonly byKey: Map<string, Promise<T>>;
}

/**
 * Holds an asynchronous body per analysis (so per rows array), keyed within it,
 * and for the operating date and route-catalogue revision it was built for: a
 * new day or a newly cached profile starts afresh. The promise is held, so
 * concurrent pollers share one build (the source is not part of the key); one that fails is dropped so the next
 * request tries again. The envelope is never part of a held body.
 */
export function holdPerSnapshot<T, S>(
  build: (
    view: FleetSnapshotView,
    analysis: SnapshotAnalysis,
    profiles: ReadonlyMap<string, RouteProfile>,
    operatingDate: string,
    key: string,
    source: S,
  ) => Promise<T>,
): (view: FleetSnapshotView, key: string, source: S) => Promise<T> {
  const held = new WeakMap<SnapshotAnalysis, Held<T>>();
  return (view, key, source) => {
    const analysis = analyseSnapshot(view);
    const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
    const revision = routeCatalogueRevision();
    let slot = held.get(analysis);
    if (slot?.operatingDate !== operatingDate || slot.revision !== revision) {
      slot = { operatingDate, revision, byKey: new Map() };
      held.set(analysis, slot);
    }
    const existing = slot.byKey.get(key);
    if (existing) return existing;
    const own = slot;
    const pending = build(view, analysis, cachedRouteProfiles(view), operatingDate, key, source);
    own.byKey.set(key, pending);
    pending.catch(() => {
      if (own.byKey.get(key) === pending) own.byKey.delete(key);
    });
    return pending;
  };
}

function byRevenueThenName(
  a: { readonly revenue: number; readonly routeName: string },
  b: { readonly revenue: number; readonly routeName: string },
): number {
  return b.revenue - a.revenue || compareText(a.routeName, b.routeName);
}

const heldBody = holdPerSnapshot<RevenueBody, RevenueSource>(
  async (view, _analysis, profiles, operatingDate, depotId, source): Promise<RevenueBody> => {
    // The caller has already confirmed the depot exists.
    const detail = buildDepotDetail(view, depotId);
    const buses = detail?.buses ?? [];
    const analysis = await analyseDepotRevenue(
      source,
      buses,
      profiles,
      operatingDate,
    );
    return {
      depot: { id: depotId, name: detail?.depot.name ?? depotId },
      operatingDate,
      summary: analysis.depot,
      routes: [...analysis.perRoute].sort(byRevenueThenName),
      notes: [MIXED_CLASS_NOTE],
      model: { provenance: 'modelled', params: REVENUE_MODEL_PARAMS },
    };
  },
);

/**
 * One depot's revenue and ridership for the feed's operating date, or null when
 * the snapshot has no such depot. Every figure is MODELLED (the feed carries no
 * ticketing); a route length from a real profile is DERIVED. Earnings per
 * kilometre are withheld for a route whose length is not known. The envelope is
 * built from this request's view on every call, never held with the body.
 */
export async function buildRevenueResponse(
  view: FleetSnapshotView,
  depotId: string,
  repositories: RevenueSource,
): Promise<RevenueResponse | null> {
  if (!analyseSnapshot(view).depotsById.has(depotId)) return null;
  const body = await heldBody(view, depotId, repositories);
  return { ...feedEnvelope(view), ...body };
}
