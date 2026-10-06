import { formatFeedTime } from '@/lib/depot/format';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';

export interface LoadingBlockProps {
  /** Number of placeholder rows. Match the rows the data will occupy. */
  readonly rows?: number;
  /** Height of each row in px; 36 matches a table row. */
  readonly rowHeight?: number;
  readonly label?: string;
}

const DEFAULT_ROWS = 6;
const DEFAULT_ROW_HEIGHT_PX = 36;
const ROW_GAP_PX = 8;

/**
 * Static placeholder with the footprint of the data it stands in for: no
 * shimmer, no spinner. Announced once as busy to assistive tech.
 */
export function LoadingBlock({
  rows = DEFAULT_ROWS,
  rowHeight = DEFAULT_ROW_HEIGHT_PX,
  label = 'Loading depot data',
}: LoadingBlockProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid="depot-loading"
      className="flex flex-col"
      style={{ gap: ROW_GAP_PX }}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden className="depot-skeleton" style={{ height: rowHeight }} />
      ))}
    </div>
  );
}

/**
 * The body when a fetch failed and the hook has only its generic reason. The
 * title says what failed; this says what to do, and never repeats it.
 */
export const GENERIC_ERROR_BODY = 'The service did not answer. Try again in a moment.';

export interface ErrorPanelProps {
  /** What happened and when, in plain words; must not repeat the title. */
  readonly message: string;
  readonly onRetry: () => void;
  /**
   * What failed: the page's main data ("Could not load the league") or a block
   * inside a page that did load ("Parking plan unavailable"). Required, so no
   * page can inherit a title that names the wrong thing.
   */
  readonly title: string;
  /** Further ways out beside Retry, for example a link back to Operations. */
  readonly children?: React.ReactNode;
}

/** What failed, and a way to try again; never a blank page. */
export function ErrorPanel({ message, onRetry, title, children }: ErrorPanelProps) {
  return (
    <div role="alert" data-testid="depot-error" className="depot-error-panel">
      <h2 className="text-[13px] text-alert-crimson">{title}</h2>
      <p className="depot-prose mt-1">
        {message === DEPOT_UNAVAILABLE_MESSAGE ? GENERIC_ERROR_BODY : message}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button type="button" onClick={onRetry} className="depot-filter-button">
          Retry
        </button>
        {children}
      </div>
    </div>
  );
}

export interface StaleStripProps {
  /** The feed time of the last good data (ISO string), or null when unknown. */
  readonly since: string | null;
}

/** Amber hairline above content that is older than the latest poll. */
export function StaleStrip({ since }: StaleStripProps) {
  const time = formatFeedTime(since);
  return (
    <p role="status" data-testid="depot-stale" className="depot-stale-strip">
      {time === '—' ? 'Showing last good data' : `Showing last good data from ${time}`}
    </p>
  );
}

/** One sentence in prose saying what is absent and why. */
export function EmptyState({ children }: { readonly children: React.ReactNode }) {
  return (
    <div data-testid="depot-empty" className="depot-panel px-4 py-6">
      <p className="depot-prose">{children}</p>
    </div>
  );
}
