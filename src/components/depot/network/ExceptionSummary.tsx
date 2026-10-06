import Link from 'next/link';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import { EXCEPTIONS_PATH } from '@/lib/depot/nav';
import {
  busScopeLine,
  depotScopeLine,
  exceptionGroups,
  exceptionKindHref,
  exceptionScope,
} from '@/lib/depot/network/exceptionScope';
import type { ExceptionKindRow } from '@/lib/depot/network/overviewModel';
import type { ExceptionKind, ExceptionSeverity } from '@/lib/depot/exceptions/types';
import { exceptionKindMeaning } from '@/lib/depot/figureTones';

/** The band's own top rule is dropped: the rule sits above the label, as on /exceptions. */
const BAND = 'border-t border-depot-line pt-2 [&>div]:border-t-0';

/**
 * One band of kind figures, each the shared `Figure` as a link into the exceptions page
 * filtered to that kind (the figure is the link; its kind label stays a plain mono label);
 * the band's mono label links to the page itself, in the label's own colour.
 */
function KindBand({ label, rows }: { readonly label: string; readonly rows: readonly ExceptionKindRow[] }) {
  return (
    <div className={BAND} data-testid="depot-exception-band">
      <h3 className="depot-label">
        {/* A plain mono label that leads to the page: underlined on hover and focus only. */}
        <Link href={EXCEPTIONS_PATH} className="hover:underline focus-visible:underline">
          {label}
        </Link>
      </h3>
      <FigureBand label={`${label} exceptions by kind`}>
        {rows.map((row) => (
          <Figure
            key={row.kind}
            label={row.label}
            value={formatCount(row.count)}
            href={exceptionKindHref(row.kind)}
            tone={exceptionKindMeaning(row.kind)}
          />
        ))}
      </FigureBand>
    </div>
  );
}

export interface ExceptionSummaryProps {
  readonly counts: Readonly<Record<ExceptionKind, number>>;
  readonly severities: Readonly<Record<ExceptionSeverity, number>>;
  /** Which figures are compared over the window and which are as of the feed time. */
  readonly windowNote?: string;
}

/**
 * Exceptions as the exceptions page's two compact bands, depots then buses, each figure a
 * link into that page filtered to its kind, with one caption line under them. No severity
 * words beside the counts and no separate "open the page" line: the band labels link there.
 */
export function ExceptionSummary({ counts, severities, windowNote }: ExceptionSummaryProps) {
  const scope = exceptionScope(counts, severities);
  const groups = exceptionGroups(counts);
  const none = scope.depot.total === 0 && scope.bus.total === 0;

  return (
    <section aria-labelledby="depot-exceptions-heading" data-testid="depot-exception-summary">
      <SectionLabel id="depot-exceptions-heading" label="Exceptions" />
      {windowNote ? (
        <p className="depot-note -mt-1 mb-2" data-testid="depot-exception-window">
          {windowNote}
        </p>
      ) : null}
      {none ? (
        <StatePanel kind="empty" compact tone="ok" sentence="No depot or bus meets an exception rule on this snapshot" />
      ) : (
        <>
          <KindBand label="Depots" rows={groups.depot} />
          <div className="-mt-6">
            <KindBand label="Buses" rows={groups.bus} />
          </div>
          <p className="depot-caption -mt-4" data-testid="depot-exception-caption">
            {`${depotScopeLine(scope)} · ${busScopeLine(scope)}`}
          </p>
        </>
      )}
    </section>
  );
}
