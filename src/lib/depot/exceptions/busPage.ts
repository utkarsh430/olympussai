import { z } from 'zod';
import { isValidDepotId } from '../ids';
import { UNASSIGNED_DEPOT_ID } from '../types';
import type { BusException, BusExceptionKind, ExceptionSeverity } from './types';

/**
 * Server-side paging of the network's bus exceptions. The list runs to
 * thousands of rows, so the page asks for one slice at a time and is told the
 * true total for its filter; nothing on screen describes a capped list.
 */

export const BUS_PAGE_DEFAULT_LIMIT = 25;
export const BUS_PAGE_MAX_LIMIT = 100;
/** Far beyond any real list; it only stops absurd numbers. */
export const BUS_PAGE_MAX_OFFSET = 100_000_000;

export interface BusPageQuery {
  /** Null for every bus kind. */
  readonly kind: BusExceptionKind | null;
  /** A feed depot id or `unassigned`; null for every depot. */
  readonly depotId: string | null;
  readonly offset: number;
  readonly limit: number;
}

export interface BusExceptionPage extends BusPageQuery {
  /** How many bus exceptions match the filter, before paging. */
  readonly total: number;
  readonly items: readonly BusException[];
}

export const DEFAULT_BUS_PAGE_QUERY: BusPageQuery = {
  kind: null,
  depotId: null,
  offset: 0,
  limit: BUS_PAGE_DEFAULT_LIMIT,
};

export type ParsedBusPageQuery =
  | { readonly ok: true; readonly query: BusPageQuery }
  | { readonly ok: false };

const WHOLE_NUMBER = /^[0-9]{1,9}$/;

const wholeNumber = (min: number, max: number) =>
  z.string().regex(WHOLE_NUMBER).transform(Number).pipe(z.number().int().min(min).max(max));

const querySchema = z
  .object({
    kind: z.enum(['long_dark', 'power_cut', 'tamper_code', 'emergency']).optional(),
    depotId: z.string().refine(isValidDepotId).optional(),
    offset: wholeNumber(0, BUS_PAGE_MAX_OFFSET).optional(),
    limit: wholeNumber(1, BUS_PAGE_MAX_LIMIT).optional(),
  })
  .strict();

/**
 * Validates the query before any snapshot is read. Strict: an unknown or
 * repeated parameter, a depot kind, a malformed number or a limit above the
 * maximum all fail, and the caller answers 400 without saying which.
 */
export function parseBusPageQuery(searchParams: URLSearchParams): ParsedBusPageQuery {
  const keys = [...searchParams.keys()];
  if (new Set(keys).size !== keys.length) return { ok: false };
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return { ok: false };
  const { kind, depotId, offset, limit } = parsed.data;
  return {
    ok: true,
    query: {
      kind: kind ?? null,
      depotId: depotId ?? null,
      offset: offset ?? DEFAULT_BUS_PAGE_QUERY.offset,
      limit: limit ?? DEFAULT_BUS_PAGE_QUERY.limit,
    },
  };
}

function matches(row: BusException, query: BusPageQuery): boolean {
  if (query.kind !== null && row.kind !== query.kind) return false;
  return query.depotId === null || (row.depotId ?? UNASSIGNED_DEPOT_ID) === query.depotId;
}

/** One page of the already-sorted list, with the true total for the filter. */
export function pageBusExceptions(
  all: readonly BusException[],
  query: BusPageQuery,
): BusExceptionPage {
  const matching = all.filter((row) => matches(row, query));
  return {
    ...query,
    total: matching.length,
    items: matching.slice(query.offset, query.offset + query.limit),
  };
}

/** Every bus exception by severity, from the full list. */
export function countBusSeverities(
  all: readonly BusException[],
): Record<ExceptionSeverity, number> {
  const counts: Record<ExceptionSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const row of all) counts[row.severity] += 1;
  return counts;
}

/** The query string the client sends; defaults are left out. */
export function busPageSearch(query: BusPageQuery): string {
  const params = new URLSearchParams();
  if (query.kind !== null) params.set('kind', query.kind);
  if (query.depotId !== null) params.set('depotId', query.depotId);
  if (query.offset !== DEFAULT_BUS_PAGE_QUERY.offset) params.set('offset', String(query.offset));
  if (query.limit !== DEFAULT_BUS_PAGE_QUERY.limit) params.set('limit', String(query.limit));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
