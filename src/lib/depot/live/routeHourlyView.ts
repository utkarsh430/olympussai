import { z } from 'zod';
import type { DepotApiError } from '../api';
import { isValidRouteName } from '../ids';
import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import { routeCatalogueRevision } from '../routes/routeCatalogue';
import { operatingDateOf } from '../sim/seed';
import type { RouteHourlyBody, RouteHourlyResponse } from '../service/types';
import { analyseSnapshot, feedEnvelope } from './analysis';
import { queryMemo } from './queryMemo';
import { routeHourlyBody } from './routeHourlyBody';

export interface RouteHourlyQuery {
  readonly routeName: string;
  /** The operating date asked for; only the feed's own date is answered today. */
  readonly date: string | null;
}

export type ParsedRouteHourlyQuery =
  { readonly ok: true; readonly query: RouteHourlyQuery } | { readonly ok: false };

export type RouteHourlyViewResult =
  | { readonly status: 200; readonly body: RouteHourlyResponse }
  | { readonly status: 400 | 404; readonly body: DepotApiError };

/** The fixed body for a route the snapshot does not carry. */
export const ROUTE_NOT_FOUND = { error: 'Route not found' } as const;
/** The fixed body for a query that is malformed or asks for a date this server cannot answer. */
export const INVALID_ROUTE_HOURLY_QUERY = { error: 'Invalid query' } as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const FEBRUARY = 2;

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

/** A calendar date, read off its digits (no clock is consulted). */
function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const last = (DAYS_IN_MONTH[month - 1] ?? 0) + (month === FEBRUARY && isLeapYear(year) ? 1 : 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= last;
}

const querySchema = z
  .object({ date: z.string().regex(ISO_DATE).refine(isCalendarDate).optional() })
  .strict();

/** Strict: a bad route name, an unknown or repeated parameter or a malformed date fails, unexplained. */
export function parseRouteHourlyQuery(
  routeName: unknown,
  searchParams: URLSearchParams,
): ParsedRouteHourlyQuery {
  if (!isValidRouteName(routeName)) return { ok: false };
  const keys = [...searchParams.keys()];
  if (new Set(keys).size !== keys.length) return { ok: false };
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return { ok: false };
  return { ok: true, query: { routeName, date: parsed.data.date ?? null } };
}

/*
 * The body depends on the rows (through the analysis, which also fixes what this server
 * had observed when the snapshot arrived), the route, the route catalogue (a newly
 * cached profile changes journey times and lengths) and the bus days recorded, so it is held per analysis under
 * that key and goes with the snapshot. The route is the caller's to choose, so the memo is
 * bounded; a route the snapshot lacks is not held. The envelope is never part of it.
 */
// A bus day recorded between two snapshots changes the body, so the key carries the
// scheduled store's revision: a loaded timetable shows on the next poll.
const bodies = queryMemo<RouteHourlyBody | null>({ keep: (body) => body !== null });

/** How many route bodies are held for this snapshot; read by the tests of the bound. */
export function heldRouteHourlyBodies(view: FleetSnapshotView): number {
  return bodies.size(analyseSnapshot(view));
}

/**
 * One route's day hour by hour: deployed (observed, the feed clock's hour, else the
 * modelled day), scheduled, modelled demand and need, the gap and the proposals, with
 * punctuality by hour. The fixed 404 for a route the snapshot does not carry; the fixed
 * 400 for a date other than the feed's operating date. No upstream call is made.
 */
export async function buildRouteHourlyResponse(
  view: FleetSnapshotView,
  query: RouteHourlyQuery,
  services: ServiceRepositories,
): Promise<RouteHourlyViewResult> {
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  if (query.date !== null && query.date !== operatingDate) {
    return { status: 400, body: INVALID_ROUTE_HOURLY_QUERY };
  }
  const key = `${query.routeName}|${routeCatalogueRevision()}|${await services.scheduled.revision()}`;
  const body = await bodies.hold(analyseSnapshot(view), key, () =>
    routeHourlyBody(view, query.routeName, services),
  );
  if (body === null) return { status: 404, body: ROUTE_NOT_FOUND };
  return { status: 200, body: { ...feedEnvelope(view), ...body } };
}
