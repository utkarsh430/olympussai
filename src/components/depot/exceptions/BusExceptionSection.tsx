'use client';

import { useEffect, useMemo, useRef } from 'react';
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
  const depotName =
    depotId === null ? null : (options.find(([id]) => id === depotId)?.[1] ?? depotId);
  const moves = pageMoves(page);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // Which paging button last had focus, so focus can be rescued if it disables.
  const focused = useRef<'previous' | 'next' | null>(null);

  // A poll can shrink the list below the current page: step back to the last
  // page, or to the first when the filter now matches nothing.
  useEffect(() => {
    if (pending || page.items.length > 0 || page.offset === 0) return;
    onOffsetChange(page.total > 0 && moves.previous !== null ? moves.previous : 0);
  }, [pending, page.items.length, page.total, page.offset, moves.previous, onOffsetChange]);

  // A button that disables under the pointer or keyboard (the last page, the
  // first page) would drop focus to the page: move it to the status line, which
  // says where the person now is.
  useEffect(() => {
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    const lastButton = focused.current === 'next' ? nextRef.current : previousRef.current;
    const disabled = focused.current === 'next' ? moves.next === null : moves.previous === null;
    if (focused.current !== null && disabled && (lost || active === lastButton)) {
      focused.current = null;
      statusRef.current?.focus();
    }
  }, [moves.previous, moves.next]);

  return (
    <section aria-labelledby="bus-exceptions-title" className="mt-8">
      <h2 id="bus-exceptions-title" className="depot-label mb-2">
        Bus exceptions
      </h2>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="depot-label">Depot</span>
          <select
            className="depot-field max-w-full"
            value={depotId ?? ANY}
            onChange={(event) =>
              onDepotChange(event.target.value === ANY ? null : event.target.value)
            }
          >
            <option value={ANY}>All depots</option>
            {options.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Bus exception pages" className="flex gap-2">
          <button
            type="button"
            className={PAGE_BUTTON}
            ref={previousRef}
            disabled={moves.previous === null}
            onFocus={() => (focused.current = 'previous')}
            onBlur={(event) => event.relatedTarget && (focused.current = null)}
            onClick={() => !pending && moves.previous !== null && onOffsetChange(moves.previous)}
          >
            Previous
          </button>
          <button
            type="button"
            className={PAGE_BUTTON}
            ref={nextRef}
            disabled={moves.next === null}
            onFocus={() => (focused.current = 'next')}
            onBlur={(event) => event.relatedTarget && (focused.current = null)}
            onClick={() => !pending && moves.next !== null && onOffsetChange(moves.next)}
          >
            Next
          </button>
        </nav>
      </div>
      <p
        ref={statusRef}
        tabIndex={-1}
        data-testid="bus-page-status"
        className="depot-prose mb-1 outline-none"
        role="status"
      >
        {pending
          ? 'Loading this page…'
          : `${busRangeSentence({ ...page, shown: page.items.length }, depotName)}.`}
      </p>
      {page.kind === null ? null : (
        <p className="mb-2 text-[11px] text-depot-muted">
          Press the kind tile again to show every kind.
        </p>
      )}
      <div aria-busy={pending}>
        <BusExceptionTable rows={page.items} emptyMessage="No bus exceptions on this page." />
      </div>
    </section>
  );
}
