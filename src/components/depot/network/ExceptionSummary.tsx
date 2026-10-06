import Link from 'next/link';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatCount } from '@/lib/depot/format';
import { SEVERITY_LABEL } from '@/lib/depot/labels';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import {
  exceptionRows,
  severityTotals,
  type KindSeverity,
} from '@/lib/depot/network/overviewModel';
import type { ExceptionKind, ExceptionSeverity } from '@/lib/depot/exceptions/types';

export const EXCEPTIONS_HREF = `${DEPOTS_ROOT}/exceptions`;

/** Severity is always a word; the colour only repeats it. */
const SEVERITY: Readonly<Record<KindSeverity, { readonly word: string; readonly tone: string }>> = {
  critical: { word: SEVERITY_LABEL.critical, tone: 'text-alert-crimson' },
  warning: { word: SEVERITY_LABEL.warning, tone: 'text-alert-amber' },
  info: { word: SEVERITY_LABEL.info, tone: 'text-depot-muted' },
  // The per-kind split is not in the response for the three depot-rate kinds.
  variable: {
    word: `${SEVERITY_LABEL.critical} or ${SEVERITY_LABEL.warning.toLowerCase()}`,
    tone: 'text-alert-amber',
  },
};

export interface ExceptionSummaryProps {
  readonly counts: Readonly<Record<ExceptionKind, number>>;
  readonly severities: Readonly<Record<ExceptionSeverity, number>>;
}

/**
 * Exceptions on this snapshot, counted by kind, with a way into the exception
 * centre for the depots and buses behind each count.
 */
export function ExceptionSummary({ counts, severities }: ExceptionSummaryProps) {
  const rows = exceptionRows(counts);
  const totals = severityTotals(severities);

  return (
    <section aria-labelledby="depot-exceptions-heading" data-testid="depot-exception-summary">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="depot-exceptions-heading" className="depot-section-label !mb-0 flex gap-2">
          Exceptions <ProvenanceBadge provenance="derived" />
        </h2>
        <Link href={EXCEPTIONS_HREF} className="depot-link text-[11px] uppercase tracking-[0.12em]">
          Open the exception centre
        </Link>
      </div>
      {totals.total === 0 ? (
        <p className="depot-prose">No depot or bus meets an exception rule on this snapshot.</p>
      ) : (
        <>
          <p className="mb-2 text-[13px] tabular-nums text-depot-muted">
            <span className="text-depot-ink">{formatCount(totals.total)}</span> in all:{' '}
            {formatCount(totals.critical)} critical, {formatCount(totals.warning)} warning,{' '}
            {formatCount(totals.info)} info.
          </p>
          <ul className="grid grid-cols-1 border-t border-depot-line sm:grid-cols-2 xl:grid-cols-4">
            {rows.map((row) => (
              <li
                key={row.kind}
                className="flex items-baseline justify-between gap-3 border-b border-depot-line px-1 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-depot-ink">{row.label}</span>
                  <span className={`text-[11px] ${SEVERITY[row.severity].tone}`}>
                    {SEVERITY[row.severity].word}
                  </span>
                </span>
                <span
                  className={`text-[13px] tabular-nums ${row.count === 0 ? 'text-depot-faint' : 'text-depot-ink'}`}
                >
                  {formatCount(row.count)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
