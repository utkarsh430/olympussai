import { EmptyState } from '@/components/depot/shell/DataStates';
import {
  EXCEPTION_KIND_LABEL,
  SEVERITY_LABEL,
  describeDepotException,
} from '@/lib/depot/exceptions/describe';
import type { DepotException, ExceptionSeverity } from '@/lib/depot/exceptions/types';

const SEVERITY_ORDER: readonly ExceptionSeverity[] = ['critical', 'warning', 'info'];

const SEVERITY_CLASS: Readonly<Record<ExceptionSeverity, string>> = {
  critical: 'depot-sev-critical',
  warning: 'depot-sev-warning',
  info: 'depot-sev-info',
};

/** Depot exceptions as sentences with their numbers, grouped by severity (a word, then colour). */
export function DepotExceptionList({
  exceptions,
}: {
  readonly exceptions: readonly DepotException[];
}) {
  if (exceptions.length === 0) {
    return (
      <EmptyState>
        No depot is flagged on this snapshot: none has a dark, off-road or on-road rate far enough
        from its peers, and no depot has a cluster of buses with main power off.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="depot-exception-list">
      {SEVERITY_ORDER.map((severity) => {
        const group = exceptions.filter((e) => e.severity === severity);
        if (group.length === 0) return null;
        return (
          <section key={severity} aria-label={`${SEVERITY_LABEL[severity]} depot exceptions`}>
            <h3 className="depot-label mb-2">{`${SEVERITY_LABEL[severity]} (${group.length})`}</h3>
            <ul className="depot-panel divide-y divide-depot-line">
              {group.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                  <span className={`depot-tag ${SEVERITY_CLASS[severity]}`}>
                    {SEVERITY_LABEL[severity]}
                  </span>
                  <span className="font-mono text-[13px] text-depot-ink">{e.depotName}</span>
                  <span className="depot-label">{EXCEPTION_KIND_LABEL[e.kind]}</span>
                  <p className="depot-prose w-full">{describeDepotException(e)}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
