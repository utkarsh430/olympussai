import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { StatePanel } from './StatePanel';

export interface LoadingBlockProps {
  /** Number of placeholder rows. Match the rows the data will occupy. */
  readonly rows?: number;
  /** Height of each row in px; 36 matches a table row. */
  readonly rowHeight?: number;
  readonly label?: string;
}

const DEFAULT_ROWS = 6;
const DEFAULT_ROW_HEIGHT_PX = 36;

/**
 * Static placeholder with the footprint of the data it stands in for: no
 * shimmer, no spinner. Announced once as busy to assistive tech. A `StatePanel`
 * of kind loading, kept under its earlier name and props.
 */
export function LoadingBlock({
  rows = DEFAULT_ROWS,
  rowHeight = DEFAULT_ROW_HEIGHT_PX,
  label = 'Loading depot data',
}: LoadingBlockProps) {
  return <StatePanel kind="loading" sentence={label} rows={rows} rowHeight={rowHeight} />;
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

/** What failed, and a way to try again; never a blank page. A `StatePanel` of kind error. */
export function ErrorPanel({ message, onRetry, title, children }: ErrorPanelProps) {
  return (
    <StatePanel
      kind="error"
      testId="depot-error"
      title={title}
      sentence={message === DEPOT_UNAVAILABLE_MESSAGE ? GENERIC_ERROR_BODY : message}
      action={
        <>
          <button type="button" onClick={onRetry} className="depot-filter-button">
            Retry
          </button>
          {children}
        </>
      }
    />
  );
}

// The stale notice reads the shell feed's clock, so it lives in a client module.
export { StaleNotice, type StaleNoticeProps } from './StaleNotice';

/** One sentence in prose saying what is absent and why. A `StatePanel` of kind empty. */
export function EmptyState({ children }: { readonly children: React.ReactNode }) {
  return <StatePanel kind="empty" testId="depot-empty" sentence={children} />;
}
