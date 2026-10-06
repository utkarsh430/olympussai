'use client';

import { useEffect, useMemo } from 'react';
import type { BusExceptionPage } from '@/lib/depot/exceptions/busPage';
import { busRangeSentence, pageMoves } from '@/lib/depot/exceptions/pageModel';
import { UNASSIGNED_DEPOT_ID, type DepotSummary } from '@/lib/depot/types';
import { BusExceptionTable } from './BusExceptionTable';

const ANY = 'any';
const PAGE_BUTTON =
  'depot-field px-3 text-xs hover:bg-depot-raised disabled:cursor-not-allowed disabled:opacity-50';

export interface BusExceptionSectionProps {
  readonly page: BusExceptionPage;
  /** A new page has been asked for and has not arrived yet. */
  readonly pending: boolean;
  readonly depots: readonly Pick<DepotSummary, 'id' | 'name'>[];
  readonly depotId: string | null;
  readonly onDepotChange: (depotId: string | null) => void;
  readonly onOffsetChange: (offset: number) => void;
}

/** Bus exceptions, paged on the server, with the true total for the filter in the status line. */
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
  const depotName = depotId === null ? null : (options.find(([id]) => id === depotId)?.[1] ?? depotId);
  const moves = pageMoves(page);

  // A poll can shrink the list below the current page: step back to the last page.
  useEffect(() => {
    if (!pending && page.items.length === 0 && page.total > 0 && moves.previous !== null) {
      onOffsetChange(moves.previous);
    }
  }, [pending, page.items.length, page.total, moves.previous, onOffsetChange]);

  return (
    <section aria-labelledby="bus-exceptions-title" className="mt-8">
      <h2 id="bus-exceptions-title" className="depot-label mb-2">Bus exceptions</h2>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="depot-label">Depot</span>
          <select
            className="depot-field max-w-full"
            value={depotId ?? ANY}
            onChange={(event) => onDepotChange(event.target.value === ANY ? null : event.target.value)}
          >
            <option value={ANY}>All depots</option>
            {options.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
        <nav aria-label="Bus exception pages" className="flex gap-2">
          <button
            type="button"
            className={PAGE_BUTTON}
            disabled={moves.previous === null || pending}
            onClick={() => moves.previous !== null && onOffsetChange(moves.previous)}
          >
            Previous
          </button>
          <button
            type="button"
            className={PAGE_BUTTON}
            disabled={moves.next === null || pending}
            onClick={() => moves.next !== null && onOffsetChange(moves.next)}
          >
            Next
          </button>
        </nav>
      </div>
      <p className="depot-prose mb-2" role="status">
        {pending
          ? 'Loading this page…'
          : `${busRangeSentence({ ...page, shown: page.items.length }, depotName)}.`}
        {page.kind === null ? '' : ' Press the kind tile again to show every kind.'}
      </p>
      <div aria-busy={pending}>
        <BusExceptionTable rows={page.items} emptyMessage="No bus exceptions on this page." />
      </div>
    </section>
  );
}
