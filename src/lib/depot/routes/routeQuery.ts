import { z } from 'zod';
import { isValidDepotId } from '../ids';
import type { UnchangedReason } from '../optimise/allocateTypes';
import type { SortDirection } from '../tableSort';
import { ALLOCATION_EXCLUSIONS, UNCHANGED_REASONS, type AllocationExclusion } from './api';

/**
 * The query both route endpoints take, validated before any snapshot is read.
 * Browser-safe (no server import), so the page builds its URLs from the same
 * names and bounds the server checks.
 */

export const ROUTE_LIST_DEFAULT_LIMIT = 25;
export const ROUTE_LIST_MAX_LIMIT = 100;
/** Class filter value for routes whose name carries no service class. Tokens are upper case. */
export const NO_CLASS = 'none';

/** Every field the server sorts the route table by. */
export const ROUTE_SORT_KEYS = [
  'route',
  'depot',
  'buses',
  'class',
  'trips',
  'deadKm',
  'median',
  'late',
  'profile',
] as const;
export type RouteSortKey = (typeof ROUTE_SORT_KEYS)[number];

export interface RouteSort {
  readonly key: RouteSortKey;
  readonly direction: SortDirection;
}

export interface ListPage {
  readonly offset: number;
  /** 0 asks for totals and counts only. */
  readonly limit: number;
}

export interface RoutesQuery extends ListPage {
  readonly depotId: string | null;
  /** Null for every class; `NO_CLASS` for names without one. */
  readonly serviceClass: string | null;
  /** Case-insensitive part of a route name. */
  readonly q: string | null;
  /** Null keeps the server's order: most buses first, then name. */
  readonly sort: RouteSort | null;
}

export type AllocationListReason = UnchangedReason | AllocationExclusion;

export interface AllocationQuery extends ListPage {
  readonly depotId: string | null;
  readonly reason: AllocationListReason | null;
  readonly q: string | null;
}

export const DEFAULT_ROUTES_QUERY: RoutesQuery = {
  depotId: null,
  serviceClass: null,
  q: null,
  sort: null,
  offset: 0,
  limit: ROUTE_LIST_DEFAULT_LIMIT,
};

export const DEFAULT_ALLOCATION_QUERY: AllocationQuery = {
  depotId: null,
  reason: null,
  q: null,
  offset: 0,
  limit: ROUTE_LIST_DEFAULT_LIMIT,
};

export type Parsed<T> = { readonly ok: true; readonly query: T } | { readonly ok: false };

const MAX_OFFSET_DIGITS = 6;
const offset = z.string().regex(new RegExp(`^\\d{1,${MAX_OFFSET_DIGITS}}$`)).transform(Number);
const limit = z
  .string()
  .regex(/^\d{1,3}$/)
  .transform(Number)
  .refine((n) => n <= ROUTE_LIST_MAX_LIMIT);
const shared = {
  depotId: z.string().refine(isValidDepotId).optional(),
  // The route-name character set only, so the match can never carry markup or a pattern.
  q: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  offset: offset.optional(),
  limit: limit.optional(),
};

const routesSchema = z
  .object({
    ...shared,
    serviceClass: z.union([z.literal(NO_CLASS), z.string().regex(/^[A-Z0-9]{1,16}$/)]).optional(),
    sort: z.enum(ROUTE_SORT_KEYS).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

const allocationSchema = z
  .object({
    ...shared,
    reason: z.enum([...UNCHANGED_REASONS, ...ALLOCATION_EXCLUSIONS]).optional(),
  })
  .strict();

/** Strict: an unknown or repeated key fails, and the caller answers 400 without saying which. */
function entriesOf(searchParams: URLSearchParams): Record<string, string> | null {
  const keys = [...searchParams.keys()];
  return new Set(keys).size === keys.length ? Object.fromEntries(searchParams) : null;
}

export function parseRoutesQuery(searchParams: URLSearchParams): Parsed<RoutesQuery> {
  const entries = entriesOf(searchParams);
  const parsed = entries === null ? null : routesSchema.safeParse(entries);
  if (!parsed?.success) return { ok: false };
  const { depotId, serviceClass, q, sort, dir } = parsed.data;
  return {
    ok: true,
    query: {
      depotId: depotId ?? null,
      serviceClass: serviceClass ?? null,
      q: q ?? null,
      sort: sort === undefined ? null : { key: sort, direction: dir ?? 'asc' },
      offset: parsed.data.offset ?? 0,
      limit: parsed.data.limit ?? ROUTE_LIST_DEFAULT_LIMIT,
    },
  };
}

export function parseAllocationQuery(searchParams: URLSearchParams): Parsed<AllocationQuery> {
  const entries = entriesOf(searchParams);
  const parsed = entries === null ? null : allocationSchema.safeParse(entries);
  if (!parsed?.success) return { ok: false };
  const { depotId, reason, q } = parsed.data;
  return {
    ok: true,
    query: {
      depotId: depotId ?? null,
      reason: reason ?? null,
      q: q ?? null,
      offset: parsed.data.offset ?? 0,
      limit: parsed.data.limit ?? ROUTE_LIST_DEFAULT_LIMIT,
    },
  };
}

/** The query string for a routes request; defaults are left out. */
export function routesSearch(query: RoutesQuery): string {
  return searchOf([
    ['depotId', query.depotId],
    ['serviceClass', query.serviceClass],
    ['q', query.q],
    ['sort', query.sort?.key ?? null],
    ['dir', query.sort?.direction ?? null],
    ['offset', query.offset === 0 ? null : String(query.offset)],
    ['limit', query.limit === ROUTE_LIST_DEFAULT_LIMIT ? null : String(query.limit)],
  ]);
}

/** The query string for an allocation request; defaults are left out. */
export function allocationSearch(query: AllocationQuery): string {
  return searchOf([
    ['depotId', query.depotId],
    ['reason', query.reason],
    ['q', query.q],
    ['offset', query.offset === 0 ? null : String(query.offset)],
    ['limit', query.limit === ROUTE_LIST_DEFAULT_LIMIT ? null : String(query.limit)],
  ]);
}

function searchOf(pairs: readonly (readonly [string, string | null])[]): string {
  const params = new URLSearchParams(pairs.flatMap(([k, v]) => (v === null ? [] : [[k, v]])));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
