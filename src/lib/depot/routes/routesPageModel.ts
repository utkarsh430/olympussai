import { formatCount } from '../format';
import { ROUTE_LIST_DEFAULT_LIMIT } from './routeQuery';

/**
 * The route table's paging as the page sees it. Filtering, sorting and paging
 * happen on the server (`routeListing.ts`); the page only turns a response's
 * offset, limit and total into page numbers and a range sentence.
 */

export const ROUTE_PAGE_SIZE = ROUTE_LIST_DEFAULT_LIMIT;

export interface ServerPage {
  /** Zero-based. */
  readonly page: number;
  /** At least 1, so an empty list still has one (empty) page. */
  readonly pageCount: number;
}

/** Page numbers for a server page; a zero limit (counts only) is one page. */
export function serverPage(total: number, offset: number, limit: number): ServerPage {
  if (limit <= 0) return { page: 0, pageCount: 1 };
  const pageCount = Math.max(1, Math.ceil(total / limit));
  return { page: Math.min(Math.floor(offset / limit), pageCount - 1), pageCount };
}

/** The offset that asks for page `page` (zero-based) of `limit` items. */
export function offsetOf(page: number, limit: number): number {
  return Math.max(0, Math.floor(page)) * limit;
}

/** "Showing 1–25 of 1,204 routes", naming the filter when it narrows the list. */
export function routeRangeSentence(
  page: { readonly offset: number; readonly shown: number; readonly total: number },
  inFeed: number,
): string {
  const filtered = page.total < inFeed;
  const outOf = `out of ${formatCount(inFeed)} in the feed`;
  if (page.shown === 0) return `No routes match these filters, ${outOf}`;
  const range = `Showing ${formatCount(page.offset + 1)}–${formatCount(page.offset + page.shown)} of ${formatCount(page.total)} ${
    page.total === 1 ? 'route' : 'routes'
  }`;
  return filtered ? `${range} that match these filters, ${outOf}` : range;
}
