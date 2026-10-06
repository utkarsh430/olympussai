export type StateKind =
  | 'empty'
  | 'loading'
  | 'error'
  | 'not-ranked'
  | 'not-established'
  | 'no-data';

export interface StatePanelProps {
  readonly kind: StateKind;
  /** The sentence of what is absent and why (for loading: what is loading, read to screen readers). */
  readonly sentence: React.ReactNode;
  /** Error only: what failed, as a heading above the sentence. */
  readonly title?: string;
  /** One muted line of what would change it ("Ranks appear once 20 buses report."). */
  readonly remedy?: string;
  /** A button or link, when a way forward exists. */
  readonly action?: React.ReactNode;
  /** Rows of the content it replaces (36px each), to hold the footprint. */
  readonly rows?: number;
  readonly rowHeight?: number;
  /** Or a minimum height in px, for a map or chart. */
  readonly minHeight?: number;
  readonly testId?: string;
}

const ROW_PX = 36;
const ROW_GAP_PX = 8;
const DEFAULT_LOADING_ROWS = 6;

function footprint(rows: number | undefined, rowHeight: number, minHeight?: number): number | undefined {
  if (minHeight !== undefined) return minHeight;
  return rows === undefined ? undefined : rows * rowHeight + Math.max(0, rows - 1) * ROW_GAP_PX;
}

/**
 * One component for every state a block can be in besides "here is the data" (rulings,
 * section 3): empty, loading, error, not ranked, not established and no data. A
 * surface block with the sentence of what is absent and why, one muted line of what
 * would change it and an action when there is one; it holds the footprint of what it
 * replaces (`rows` or `minHeight`), so the page does not jump. Loading is a static
 * placeholder, no shimmer; error is announced as an alert.
 */
export function StatePanel(props: StatePanelProps) {
  const { kind, sentence, title, remedy, action, rows, rowHeight = ROW_PX, minHeight } = props;
  if (kind === 'loading') {
    const count = rows ?? DEFAULT_LOADING_ROWS;
    return (
      <div
        role="status"
        aria-busy="true"
        data-testid={props.testId ?? 'depot-loading'}
        className="flex flex-col"
        style={{ gap: ROW_GAP_PX, minHeight }}
      >
        <span className="sr-only">{sentence}</span>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} aria-hidden className="depot-skeleton" style={{ height: rowHeight }} />
        ))}
      </div>
    );
  }
  const error = kind === 'error';
  return (
    <div
      role={error ? 'alert' : undefined}
      data-testid={props.testId ?? `depot-state-${kind}`}
      data-state={kind}
      className={error ? 'depot-error-panel' : 'depot-panel px-4 py-5'}
      style={{ minHeight: footprint(rows, rowHeight, minHeight) }}
    >
      {title ? <h2 className="text-[13px] text-alert-crimson">{title}</h2> : null}
      <p className={title ? 'depot-prose mt-1' : 'font-sans text-sm leading-[1.55] text-depot-ink'}>
        {sentence}
      </p>
      {remedy ? <p className="depot-prose mt-1">{remedy}</p> : null}
      {action ? <div className="mt-3 flex flex-wrap items-center gap-4">{action}</div> : null}
    </div>
  );
}
