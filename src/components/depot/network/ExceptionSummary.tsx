import Link from 'next/link';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { SeverityMark } from '@/components/depot/shell/SeverityMark';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import {
  busScopeLine,
  depotScopeLine,
  exceptionGroups,
  exceptionKindHref,
  exceptionScope,
} from '@/lib/depot/network/exceptionScope';
import type { ExceptionKindRow } from '@/lib/depot/network/overviewModel';
import type { ExceptionKind, ExceptionSeverity } from '@/lib/depot/exceptions/types';

export const EXCEPTIONS_HREF = `${DEPOTS_ROOT}/exceptions`;

/**
 * One small band of linked counts: the scope's total on the left, then each kind as a
 * link with its count. A kind with one fixed severity carries the shared `SeverityMark`;
 * a depot-rate kind is critical or warning depot by depot, so it names none here.
 */
function KindBand({ heading, rows }: { readonly heading: string; readonly rows: readonly ExceptionKindRow[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-x-6 gap-y-1.5 border-b border-depot-line py-2.5 lg:flex-row lg:items-baseline">
      <h3 className="depot-label shrink-0 lg:w-72">{heading}</h3>
      <ul className="flex min-w-0 flex-wrap gap-x-6 gap-y-1.5">
        {rows.map((row) => (
          <li key={row.kind} className="flex min-w-0 items-baseline gap-2">
            <Link href={exceptionKindHref(row.kind)} className="depot-link flex min-w-0 items-baseline gap-2 font-sans text-[13px]">
              <span className="truncate">{row.label}</span>
              <span className="font-mono tabular-nums text-depot-ink">{formatCount(row.count)}</span>
            </Link>
            {row.severity === 'variable' ? null : <SeverityMark severity={row.severity} />}
          </li>
        ))}
      </ul>
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
 * Exceptions as two small bands, depots then buses, each kind a link into the exceptions
 * page filtered to it. No arrows, no boxes; the window words are the section's note.
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
        <div className="border-t border-depot-line">
          <KindBand heading={depotScopeLine(scope)} rows={groups.depot} />
          <KindBand heading={busScopeLine(scope)} rows={groups.bus} />
        </div>
      )}
      <Link href={EXCEPTIONS_HREF} className="depot-link mt-2 inline-block font-sans text-[13px]">
        Open the exceptions page
      </Link>
    </section>
  );
}
