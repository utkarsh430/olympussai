import Link from 'next/link';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatCount } from '@/lib/depot/format';
import { SEVERITY_LABEL } from '@/lib/depot/labels';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import {
  busScopeLine,
  depotScopeLine,
  exceptionGroups,
  exceptionKindHref,
  exceptionScope,
} from '@/lib/depot/network/exceptionScope';
import type { ExceptionKindRow, KindSeverity } from '@/lib/depot/network/overviewModel';
import type { ExceptionKind, ExceptionSeverity } from '@/lib/depot/exceptions/types';

export const EXCEPTIONS_HREF = `${DEPOTS_ROOT}/exceptions`;

/** Severity is always a word; the colour only repeats it. */
const SEVERITY: Readonly<Record<KindSeverity, { readonly word: string; readonly tone: string }>> = {
  critical: { word: SEVERITY_LABEL.critical, tone: 'text-alert-crimson' },
  warning: { word: SEVERITY_LABEL.warning, tone: 'text-alert-amber' },
  info: { word: SEVERITY_LABEL.info, tone: 'text-depot-muted' },
  // A depot-rate kind is critical or warning by how far the depot sits from its peers.
  variable: {
    word: `${SEVERITY_LABEL.critical} or ${SEVERITY_LABEL.warning.toLowerCase()}`,
    tone: 'text-alert-amber',
  },
};

function KindList({
  heading,
  rows,
}: {
  readonly heading: string;
  readonly rows: readonly ExceptionKindRow[];
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-[13px] tabular-nums text-depot-ink">{heading}</h3>
      <ul className="border-t border-depot-line">
        {rows.map((row) => (
          <li
            key={row.kind}
            className="flex min-w-0 flex-wrap items-baseline gap-x-3 border-b border-depot-line py-1.5"
          >
            <Link
              href={exceptionKindHref(row.kind)}
              className="depot-link flex min-w-0 items-baseline gap-2 text-[13px]"
            >
              <span className="truncate">{row.label}</span>
              <span className="tabular-nums text-depot-ink">{formatCount(row.count)}</span>
              <span aria-hidden>→</span>
            </Link>
            <span className={`text-[11px] ${SEVERITY[row.severity].tone}`}>
              {SEVERITY[row.severity].word}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ExceptionSummaryProps {
  readonly counts: Readonly<Record<ExceptionKind, number>>;
  readonly severities: Readonly<Record<ExceptionSeverity, number>>;
}

/**
 * Exceptions on this snapshot, split by scope (depots, buses), each kind a
 * link into the exceptions page filtered to it. Rules, not a box.
 */
export function ExceptionSummary({ counts, severities }: ExceptionSummaryProps) {
  const scope = exceptionScope(counts, severities);
  const groups = exceptionGroups(counts);
  const none = scope.depot.total === 0 && scope.bus.total === 0;

  return (
    <section aria-labelledby="depot-exceptions-heading" data-testid="depot-exception-summary">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="depot-exceptions-heading" className="depot-section-label !mb-0 flex gap-2">
          Exceptions <ProvenanceBadge provenance="derived" />
        </h2>
        <Link href={EXCEPTIONS_HREF} className="depot-link text-[13px]">
          Open the exceptions page
        </Link>
      </div>
      {none ? (
        <p className="depot-prose">No depot or bus meets an exception rule on this snapshot.</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
          <KindList heading={depotScopeLine(scope)} rows={groups.depot} />
          <KindList heading={busScopeLine(scope)} rows={groups.bus} />
        </div>
      )}
    </section>
  );
}
