export interface PagerProps {
  readonly page: number;
  readonly pageCount: number;
  /** The count sentence that states what is shown and the true total. */
  readonly summary: string;
  readonly onPage: (page: number) => void;
}

/** Previous and Next with the page position and the count sentence beside them. */
export function Pager({ page, pageCount, summary, onPage }: PagerProps) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4">
      <button
        type="button"
        className="depot-filter-button"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <button
        type="button"
        className="depot-filter-button"
        disabled={page >= pageCount - 1}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
      <p role="status" className="depot-prose">
        Page {page + 1} of {pageCount}. {summary}
      </p>
    </div>
  );
}
