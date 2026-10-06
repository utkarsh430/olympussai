'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { SeverityMark } from '@/components/depot/shell/SeverityMark';
import { ShowAllButton } from '@/components/depot/shell/LongLists';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { DepotExceptionLine, ExceptionGroup } from '@/lib/depot/cockpit/exceptionGroups';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatFeedDateTime, formatFeedTimeOn } from '@/lib/depot/format';
import { GROUP_PREVIEW_ROWS } from '@/lib/depot/listPaging';

export interface DepotExceptionsProps {
  readonly depotId: string;
  readonly groups: readonly ExceptionGroup[];
  readonly depotLines: readonly DepotExceptionLine[];
  /** The feed's clock: a bus last heard on an earlier day shows that day with its time. */
  readonly feedNow: string | null;
}

export const NO_EXCEPTION_SENTENCE = 'No exception is raised for this depot on this snapshot.';

function busCount(groups: readonly ExceptionGroup[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}

function DepotLines({ lines }: { readonly lines: readonly DepotExceptionLine[] }) {
  return (
    <ul className="mb-4 min-w-0" aria-label="Depot exceptions">
      {lines.map((line) => (
        <li key={line.id} className="min-w-0 border-b border-depot-line py-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <SeverityMark severity={line.severity} />
            <span className="font-mono text-[11px] uppercase text-depot-muted">{line.label}</span>
            <p className="depot-prose min-w-0">{line.sentence}</p>
          </div>
          {line.windowNote ? <p className="depot-note">{line.windowNote}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function BusGroup({ depotId, group, feedNow }: {
  readonly depotId: string;
  readonly group: ExceptionGroup;
  readonly feedNow: string | null;
}) {
  const [all, setAll] = useState(false);
  const listId = `depot-exception-list-${group.kind}`;
  const rows = all ? group.rows : group.rows.slice(0, GROUP_PREVIEW_ROWS);
  return (
    <div className="min-w-0" data-testid={`depot-exception-group-${group.kind}`}>
      <SectionLabel label={group.heading} count={group.rows.length} note={group.severityLabel} level={3} />
      <ul id={listId} className="min-w-0">
        {rows.map((row) => (
          <li key={row.registrationNumber} className="flex h-9 min-w-0 items-center gap-3 border-b border-depot-line font-mono text-[13px]">
            <Link href={rosterBusHref(depotId, row.registrationNumber)} className="depot-link shrink-0 whitespace-nowrap">
              {row.registrationNumber}
            </Link>
            <span className="min-w-0 flex-1 truncate text-depot-muted" title={row.extra ?? undefined}>{row.extra ?? ''}</span>
            <span className="shrink-0 tabular-nums text-depot-faint" title={row.lastSeen === null ? 'No last-seen time in the feed' : formatFeedDateTime(row.lastSeen)}>
              {row.lastSeen === null ? '—' : formatFeedTimeOn(row.lastSeen, feedNow)}
            </span>
          </li>
        ))}
      </ul>
      {group.rows.length > GROUP_PREVIEW_ROWS ? (
        <div className="mt-2">
          <ShowAllButton total={group.rows.length} expanded={all} onToggle={() => setAll((open) => !open)} controls={listId} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * What needs attention, in detail: the depot's own exceptions, then each bus once,
 * under its most severe kind; the group heading names the buses it lists and its
 * severity, and a row adds only the bus's other kinds. Five per group, then "Show all".
 */
export function DepotExceptions({ depotId, groups, depotLines, feedNow }: DepotExceptionsProps) {
  const total = busCount(groups) + depotLines.length;
  return (
    <section aria-labelledby="depot-exceptions" data-testid="depot-exceptions" className="min-w-0">
      <SectionLabel id="depot-exceptions" label="Exceptions" count={total} note="One row per bus, most severe first" />
      {total === 0 ? <StatePanel kind="empty" compact tone="ok" sentence={NO_EXCEPTION_SENTENCE} /> : null}
      {depotLines.length > 0 ? <DepotLines lines={depotLines} /> : null}
      <div className="grid min-w-0 gap-x-8 gap-y-4 xl:grid-cols-2">
        {groups.map((group) => (
          <BusGroup key={group.kind} depotId={depotId} group={group} feedNow={feedNow} />
        ))}
      </div>
    </section>
  );
}
