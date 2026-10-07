import { z } from 'zod';
import type { DepotApiError } from '../api';
import { isValidDepotId } from '../ids';
import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import { routeCatalogueRevision } from '../routes/routeCatalogue';
import { isServiceBandKey, nextPeakBand } from '../service/networkHours';
import type { NetworkHourlyBody, NetworkHourlyResponse, ServiceBandKey } from '../service/types';
import { analyseSnapshot, feedEnvelope } from './analysis';
import { networkHourlyBody } from './networkHourlyBody';
import { networkDayOf, type NetworkDay } from './networkHourlyDay';
import { queryMemo } from './queryMemo';

export interface NetworkHourlyQuery {
  /** The band asked for; null for the peak now or next by the feed clock. */
  readonly band: ServiceBandKey | null;
  readonly depotId: string | null;
  readonly page: number;
}

export type ParsedNetworkHourlyQuery =
  { readonly ok: true; readonly query: NetworkHourlyQuery } | { readonly ok: false };

export type NetworkHourlyViewResult =
  | { readonly status: 200; readonly body: NetworkHourlyResponse }
  | { readonly status: 404; readonly body: DepotApiError };

/** The fixed body for a depot the snapshot does not carry (one running no route answers, empty). */
export const DEPOT_NOT_FOUND = { error: 'Depot not found' } as const;

/** More pages than any network has routes for: a larger number is a typo or a probe. */
const MAX_PAGE = 200;

const querySchema = z
  .object({
    band: z.string().refine(isServiceBandKey).optional(),
    depot: z.string().refine(isValidDepotId).optional(),
    page: z.string().regex(/^\d{1,3}$/).transform(Number).refine((n) => n <= MAX_PAGE).optional(),
  })
  .strict();

/** Strict: an unknown, repeated or malformed parameter fails, unexplained. */
export function parseNetworkHourlyQuery(searchParams: URLSearchParams): ParsedNetworkHourlyQuery {
  const keys = [...searchParams.keys()];
  if (new Set(keys).size !== keys.length) return { ok: false };
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return { ok: false };
  const { band, depot, page } = parsed.data;
  return {
    ok: true,
    query: { band: (band as ServiceBandKey | undefined) ?? null, depotId: depot ?? null, page: page ?? 0 },
  };
}

/*
 * The network's day depends on the rows (through the analysis, which also fixes what this
 * server had observed when the snapshot arrived) and the route catalogue (a newly cached
 * profile changes journey times, lengths, dead km and corridors), so it is held per
 * analysis under the catalogue's revision; each band, depot and page is a selection from
 * it, held beside it in a bounded memo. The envelope is never part of either.
 */
// Once bus days are recorded between snapshots, both keys must also carry the scheduled store's revision.
const networkDays = queryMemo<NetworkDay>({ limit: 2 });
const bodies = queryMemo<NetworkHourlyBody>();

/** How many band bodies are held for this snapshot; read by the tests of the bound. */
export function heldNetworkHourlyBodies(view: FleetSnapshotView): number {
  return bodies.size(analyseSnapshot(view));
}

/**
 * The network's day hour by hour for one band, optionally one depot, one page of routes:
 * the band tallies, the route strips, the proposals and the hourly reallocation. The fixed
 * 404 for a depot the snapshot does not carry. No upstream call is made.
 */
export async function buildNetworkHourlyResponse(
  view: FleetSnapshotView,
  query: NetworkHourlyQuery,
  services: ServiceRepositories,
): Promise<NetworkHourlyViewResult> {
  const analysis = analyseSnapshot(view);
  const revision = routeCatalogueRevision();
  const day = await networkDays.hold(analysis, `${revision}`, () => networkDayOf(view, services));
  if (query.depotId !== null && !analysis.depotsById.has(query.depotId)) {
    return { status: 404, body: DEPOT_NOT_FOUND };
  }
  const band = query.band ?? nextPeakBand(day.currentHour);
  const key = `${band}|${query.depotId ?? ''}|${query.page}|${revision}`;
  const body = await bodies.hold(analysis, key, () =>
    Promise.resolve(networkHourlyBody(day, { band, depotId: query.depotId, page: query.page })),
  );
  return { status: 200, body: { ...feedEnvelope(view), ...body } };
}
