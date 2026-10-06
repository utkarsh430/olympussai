'use client';

const PAGE_BUTTON =
  'depot-field px-3 text-xs hover:bg-depot-raised disabled:cursor-not-allowed disabled:opacity-50';

export interface ListPagerProps {
  /** Names the list, e.g. "Route table pages". */
  readonly label: string;
  /** Zero-based page and the number of pages. */
  readonly page: number;
  readonly pageCount: number;
  readonly onPageChange: (page: number) => void;
}

/** Previous and Next around "Page x of y"; each page is fetched from the server. */
export function ListPager({ label, page, pageCount, onPageChange }: ListPagerProps) {
  return (
    <nav aria-label={label} className="flex items-center gap-2">
      <button
        type="button"
        className={PAGE_BUTTON}
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span className="font-mono text-xs tabular-nums text-depot-muted">
        Page {page + 1} of {pageCount}
      </span>
      <button
        type="button"
        className={PAGE_BUTTON}
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
