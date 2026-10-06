'use client';

import { useEffect, useMemo } from 'react';
import { Select } from '@/components/depot/shell/Controls';
import { Pager } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { BusExceptionPage } from '@/lib/depot/exceptions/busPage';
import { busRangeSentence, pageMoves } from '@/lib/depot/exceptions/pageModel';
import { UNASSIGNED_DEPOT_ID, type DepotSummary } from '@/lib/depot/types';
import { BusExceptionTable } from './BusExceptionTable';

const ANY = 'any';

export interface BusExceptionSectionProps {
  readonly page: BusExceptionPage;
  /** A new page has been asked for and has not arrived yet. */
  readonly pending: boolean;
  readonly depots: readonly Pick<DepotSummary, 'id' | 'name'>[];
  readonly depotId: string | null;
  readonly onDepotChange: (depotId: string | null) => void;
  readonly onOffsetChange: (offset: number) => void;
}

/** Bus exceptions, paged on the server (25 a page), with the true total for the filter in the status line. */
export function BusExceptionSection({
  page,
  pending,
  depots,
  depotId,
  onDepotChange,
  onOffsetChange,
}: BusExceptionSectionProps) {
  const options = useMemo(() => {
    const byId = new Map(depots.map((d) => [d.id, d.name]));
    if (!byId.has(UNASSIGNED_DEPOT_ID)) byId.set(UNASSIGNED_DEPOT_ID, 'No home depot');
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'en'));
  }, [depots]);
  const depotName =
    depotId === null ? null : (options.find(([id]) => id === depotId)?.[1] ?? depotId);
  const moves = pageMoves(page);

  // A poll can shrink the list below the current page: step back to the last
  // page, or to the first when the filter now matches nothing.
  useEffect(() => {
    if (pending || page.items.length > 0 || page.offset === 0) return;
    onOffsetChange(page.total > 0 && moves.previous !== null ? moves.previous : 0);
  }, [pending, page.items.length, page.total, page.offset, moves.previous, onOffsetChange]);

  const status = pending
    ? 'Loading this page…'
    : `${busRangeSentence({ ...page, shown: page.items.length }, depotName)}.`;

  return (
    <section aria-labelledby="bus-exceptions-title" className="mt-8">
      <SectionLabel id="bus-exceptions-title" label="Bus exceptions" count={page.total} note="Worst first" />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Select
          label="Depot"
          value={depotId ?? ANY}
          onChange={(event) => onDepotChange(event.target.value === ANY ? null : event.target.value)}
        >
          <option value={ANY}>All depots</option>
          {options.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <p data-testid="bus-page-status" className="depot-prose min-w-0">
          {status}
        </p>
      </div>
      {page.kind === null ? null : (
        <p className="mb-2 text-[11px] text-depot-muted">Press the kind tile again to show every kind.</p>
      )}
      <div aria-busy={pending}>
        <BusExceptionTable
          rows={page.items}
          kind={page.kind}
          emptyMessage="No bus exceptions on this page."
        />
      </div>
      <Pager
        page={Math.floor(page.offset / page.limit)}
        total={page.total}
        pageSize={page.limit}
        onPage={(next) => {
          if (!pending) onOffsetChange(next * page.limit);
        }}
      />
    </section>
  );
}
