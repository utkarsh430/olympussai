import Link from 'next/link';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { ExceptionLine } from '@/lib/depot/cockpit/cockpitModel';
import { rosterBusHref } from '@/lib/depot/depotNav';
import type { ExceptionSeverity } from '@/lib/depot/exceptions/types';

export interface DepotExceptionsProps {
  readonly depotId: string;
  /** Already ordered: critical first, depot-wide before bus within a severity. */
  readonly lines: readonly ExceptionLine[];
}

// Literal class names so Tailwind's content scan keeps them.
const SEVERITY_CLASS: Readonly<Record<ExceptionSeverity, string>> = {
  critical: 'depot-sev-critical',
  warning: 'depot-sev-warning',
  info: 'depot-sev-info',
};

/**
 * What needs attention at this depot on this snapshot, one sentence each, in the
 * exception centre's own wording. Severity is a word in a tag; its colour only
 * reinforces it. A bus line links to that bus in the roster.
 */
export function DepotExceptions({ depotId, lines }: DepotExceptionsProps) {
  return (
    <section
      aria-labelledby="depot-cockpit-exceptions-heading"
      data-testid="depot-cockpit-exceptions"
      className="animate-rise"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-cockpit-exceptions-heading" className="depot-section-label !mb-0">
          Exceptions
        </h2>
        <ProvenanceBadge provenance="derived" />
      </div>
      {lines.length === 0 ? (
        <EmptyState>No exceptions for this depot on this snapshot.</EmptyState>
      ) : (
        <ul className="divide-y divide-depot-line rounded-md border border-depot-line">
          {lines.map((line) => (
            <li
              key={line.id}
              className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2"
            >
              <span className={`depot-tag ${SEVERITY_CLASS[line.severity]}`}>
                {line.severityLabel}
              </span>
              {line.registrationNumber ? (
                <Link
                  href={rosterBusHref(depotId, line.registrationNumber)}
                  className="depot-link whitespace-nowrap text-[13px]"
                >
                  {line.registrationNumber}
                </Link>
              ) : (
                <span className="depot-label">{line.subject}</span>
              )}
              <span className="min-w-0 flex-1 basis-64 font-sans text-sm text-depot-muted">
                {line.sentence}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
