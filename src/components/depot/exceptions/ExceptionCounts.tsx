import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { formatCount } from '@/lib/depot/format';
import { BUS_EXCEPTION_KINDS, DEPOT_EXCEPTION_KINDS } from '@/lib/depot/exceptions/config';
import { EXCEPTION_KIND_LABEL } from '@/lib/depot/exceptions/describe';
import type { ExceptionKind } from '@/lib/depot/exceptions/types';
import { exceptionKindMeaning } from '@/lib/depot/figureTones';

/** The page's headline figure: buses raising the emergency flag, the one critical bus kind. */
const LEAD_KIND = 'emergency';


/** While a depot's own bus counts have not arrived the figure is a dash, never the network's. */
const PENDING_TITLE = "This depot's bus count is still loading";

interface KindProps {
  /** Per kind, in the page's scope; null while that count is not known for the scope. */
  readonly counts: Readonly<Record<ExceptionKind, number | null>>;
  readonly selected: ExceptionKind | null;
  readonly onToggle: (kind: ExceptionKind) => void;
}

/**
 * The page's hero: two bands of kind figures (depots, buses), each the shared `Figure` as a
 * toggle that filters its own list below; pressing the active figure again clears it. The
 * hairline sits above each band's label, as above every section label; the totals sentence
 * is the bands' caption.
 */
export function ExceptionCounts({
  counts,
  selected,
  onToggle,
  totalsLine,
}: KindProps & { readonly totalsLine: string }) {
  const figures = (kinds: readonly ExceptionKind[]) =>
    kinds.map((kind) => {
      const count = counts[kind];
      return (
        <Figure
          key={kind}
          label={EXCEPTION_KIND_LABEL[kind]}
          value={count === null ? '—' : formatCount(count)}
          title={count === null ? PENDING_TITLE : undefined}
          onPress={() => onToggle(kind)}
          pressed={selected === kind}
          tone={exceptionKindMeaning(kind)}
          lead={kind === LEAD_KIND}
        />
      );
    });
  // The band's own top rule is dropped: the rule sits above the label instead.
  const band = 'border-t border-depot-line pt-2 [&>div]:border-t-0';
  return (
    <section aria-labelledby="exception-counts-title" data-testid="depot-exception-counts" className="mb-2">
      <h2 id="exception-counts-title" className="sr-only">
        Exceptions by kind
      </h2>
      <div className={band} data-testid="depot-exception-band">
        <h3 className="depot-label">Depots</h3>
        <FigureBand label="Depot exceptions by kind">{figures(DEPOT_EXCEPTION_KINDS)}</FigureBand>
      </div>
      <div className={`-mt-6 ${band}`} data-testid="depot-exception-band">
        <h3 className="depot-label">Buses</h3>
        <FigureBand label="Bus exceptions by kind">{figures(BUS_EXCEPTION_KINDS)}</FigureBand>
      </div>
      <p className="depot-caption -mt-4 mb-6">{totalsLine}</p>
    </section>
  );
}
