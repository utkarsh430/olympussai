import Link from 'next/link';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { DepotExceptionLine, ExceptionGroup } from '@/lib/depot/cockpit/exceptionGroups';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatCount, formatFeedDateTime, formatFeedTime } from '@/lib/depot/format';
import { GROUP_PREVIEW_ROWS } from '@/lib/depot/listPaging';

export interface DepotExceptionsProps {
  readonly depotId: string;
  readonly groups: readonly ExceptionGroup[];
  readonly depotLines: readonly DepotExceptionLine[];
}

const SEVERITY_TONE = {
  critical: 'text-alert-crimson',
  warning: 'text-alert-amber',
  info: 'text-depot-muted',
} as const;

function busCount(groups: readonly ExceptionGroup[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}

/**
 * What needs attention, in detail: the depot's own exceptions, then each bus once,
 * under its most severe kind with all its kinds as words. Five per group; "Show all"
 * opens the roster filtered (or the page that owns that list).
 */
export function DepotExceptions({ depotId, groups, depotLines }: DepotExceptionsProps) {
  const total = busCount(groups) + depotLines.length;
  return (
    <section aria-labelledby="depot-exceptions" data-testid="depot-exceptions" className="min-w-0">
      <SectionLabel id="depot-exceptions" label="Exceptions" count={total} note="One row per bus, most severe first" />
      {total === 0 ? (
        <p className="font-sans text-sm text-depot-muted">No exception is raised for this depot on this snapshot.</p>
      ) : null}
      {depotLines.length > 0 ? (
        <ul className="mb-4 min-w-0" aria-label="Depot exceptions">
          {depotLines.map((line) => (
            <li key={line.id} className="min-w-0 border-b border-depot-line py-2">
              <p className="min-w-0 text-[13px] text-depot-ink">
                <span className={`mr-2 font-mono text-[11px] uppercase ${SEVERITY_TONE[line.severity]}`}>{line.severityLabel}</span>
                <span className="mr-2 font-mono text-[11px] uppercase text-depot-muted">{line.label}</span>
                {line.sentence}
              </p>
              {line.windowNote ? <p className="font-sans text-xs text-depot-muted">{line.windowNote}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid min-w-0 gap-x-8 gap-y-4 xl:grid-cols-2">
        {groups.map((group) => (
          <div key={group.kind} className="min-w-0" data-testid={`depot-exception-group-${group.kind}`}>
            <SectionLabel label={group.heading} count={group.rows.length} level={3} />
            <ul className="min-w-0">
              {group.rows.slice(0, GROUP_PREVIEW_ROWS).map((row) => (
                <li key={row.registrationNumber} className="flex h-9 min-w-0 items-center gap-3 border-b border-depot-line font-mono text-[13px]">
                  <span className={`w-16 shrink-0 text-[11px] uppercase ${SEVERITY_TONE[row.severity]}`}>{row.severityLabel}</span>
                  <Link href={rosterBusHref(depotId, row.registrationNumber)} className="depot-link shrink-0 whitespace-nowrap">
                    {row.registrationNumber}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-depot-muted" title={row.kinds}>{row.kinds}</span>
                  <span className="shrink-0 tabular-nums text-depot-faint" title={formatFeedDateTime(row.lastSeen)}>
                    {row.lastSeen === null ? '—' : formatFeedTime(row.lastSeen)}
                  </span>
                </li>
              ))}
            </ul>
            {group.rows.length > GROUP_PREVIEW_ROWS ? (
              <Link href={group.href} className="depot-link mt-2 inline-block text-[13px]">
                {`Show all ${formatCount(group.rows.length)}`}
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
