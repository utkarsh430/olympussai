export type StateKind =
  'empty' | 'loading' | 'error' | 'not-ranked' | 'not-established' | 'no-data';

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
  /**
   * "How a yard is found ›": a link to the page's closing disclosure by its id (the
   * disclosure opens on the fragment). The rule itself lives there, not in the panel.
   */
  readonly howLink?: StateHowLink;
  /** One line with a status square, no box: a nil state inside a section. */
  readonly compact?: boolean;
  /** The compact square's colour; the sentence always says the state in words. */
  readonly tone?: 'ok' | 'neutral';
}

export interface StateHowLink {
  readonly label: string;
  readonly targetId: string;
}

const SQUARE: Readonly<Record<'ok' | 'neutral', string>> = {
  ok: 'bg-alert-green',
  neutral: 'bg-depot-muted',
};

function HowLink({ link }: { readonly link: StateHowLink }) {
  return (
    <a href={`#${link.targetId}`} className="depot-link whitespace-nowrap font-sans">
      {link.label} ›
    </a>
  );
}

const ROW_PX = 36;
const ROW_GAP_PX = 8;
const DEFAULT_LOADING_ROWS = 6;

function footprint(
  rows: number | undefined,
  rowHeight: number,
  minHeight?: number,
): number | undefined {
  if (minHeight !== undefined) return minHeight;
  return rows === undefined ? undefined : rows * rowHeight + Math.max(0, rows - 1) * ROW_GAP_PX;
}

/**
 * One component for every state a block can be in besides "here is the data":
 * empty, loading, error, not ranked, not established and no data. A
 * surface block with the sentence of what is absent and why, one muted line of what
 * would change it and an action when there is one; it holds the footprint of what it
 * replaces (`rows` or `minHeight`), so the page does not jump, with the text centred in
 * it; without one it is exactly as tall as its text. `compact` is the one-line form (a
 * status square and the sentence) for a nil state inside a section. Loading is a static
 * placeholder, no shimmer; error is announced as an alert.
 */
export function StatePanel(props: StatePanelProps) {
  const { kind, sentence, title, remedy, action, rows, rowHeight = ROW_PX, minHeight } = props;
  const { howLink, compact = false, tone = 'neutral' } = props;
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
  const testId = props.testId ?? `depot-state-${kind}`;
  if (compact && !error) {
    return (
      <p
        data-testid={testId}
        data-state={kind}
        className="depot-note flex min-w-0 items-center gap-2"
      >
        <span
          aria-hidden
          data-testid="depot-state-square"
          className={`h-1.5 w-1.5 shrink-0 ${SQUARE[tone]}`}
        />
        <span className="min-w-0">{sentence}</span>
        {howLink ? <HowLink link={howLink} /> : null}
      </p>
    );
  }
  const height = footprint(rows, rowHeight, minHeight);
  const centred = height === undefined ? '' : ' flex flex-col justify-center';
  return (
    <div
      role={error ? 'alert' : undefined}
      data-testid={testId}
      data-state={kind}
      className={`${error ? 'depot-error-panel' : 'depot-panel px-4 py-3'}${centred}`}
      style={{ minHeight: height }}
    >
      {title ? <h2 className="text-[13px] text-alert-crimson">{title}</h2> : null}
      <p className={title ? 'depot-prose mt-1' : 'font-sans text-sm leading-5 text-depot-ink'}>
        {sentence}
        {howLink ? ' ' : null}
        {howLink ? <HowLink link={howLink} /> : null}
      </p>
      {remedy ? <p className="depot-note mt-1">{remedy}</p> : null}
      {action ? <div className="mt-3 flex flex-wrap items-center gap-4">{action}</div> : null}
    </div>
  );
}
