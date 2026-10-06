import { formatFeedTime } from '@/lib/depot/format';

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

export interface ErrorPanelProps {
  readonly message: string;
  readonly onRetry: () => void;
  readonly title?: string;
}

/** What failed, and a way to try again; never a blank page. */
export function ErrorPanel({ message, onRetry, title = 'Depot data unavailable' }: ErrorPanelProps) {
  return (
    <div role="alert" data-testid="depot-error" className="depot-error-panel">
      <p className="depot-label text-alert-crimson">Error</p>
      <h2 className="mt-1 font-mono text-[13px] text-depot-ink">{title}</h2>
      <p className="depot-prose mt-1">{message}</p>
      <button type="button" onClick={onRetry} className="hud-button mt-3">
        Retry
      </button>
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
