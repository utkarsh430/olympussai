/**
 * Arithmetic for the long-list rule (rulings, section 3): five rows per group and
 * "Show all N", or pages of 25 where the list is the page's purpose. Pure, so the
 * range words and the edges are tested without a browser.
 */

export const GROUP_PREVIEW_ROWS = 5;
export const PAGE_ROWS = 25;

/** The rows a capped list shows: all of them once expanded, else the first `limit`. */
export function visibleRows<T>(rows: readonly T[], expanded: boolean, limit: number): readonly T[] {
  return expanded || rows.length <= limit ? rows : rows.slice(0, limit);
}

export interface PageRange {
  /** Zero-based page, clamped into range. */
  readonly page: number;
  readonly pageCount: number;
  /** Zero-based slice bounds. */
  readonly start: number;
  readonly end: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  /** "Rows 26 to 50 of 132", "No rows". */
  readonly words: string;
}

export function pageRange(page: number, total: number, size: number = PAGE_ROWS): PageRange {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeSize = Math.max(1, Math.floor(size));
  const pageCount = Math.max(1, Math.ceil(safeTotal / safeSize));
  const current = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const start = current * safeSize;
  const end = Math.min(safeTotal, start + safeSize);
  const words = safeTotal === 0 ? 'No rows' : `Rows ${start + 1} to ${end} of ${safeTotal}`;
  return {
    page: current,
    pageCount,
    start,
    end,
    hasPrevious: current > 0,
    hasNext: current < pageCount - 1,
    words,
  };
}
