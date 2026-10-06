'use client';

import { useEffect, useMemo } from 'react';
import { Select } from '@/components/depot/shell/Controls';
import { Pager } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { busBasisNote } from '@/lib/depot/exceptions/basisWords';
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
  /** Every bus exception is as of the feed time: said once, beside the label. */
  readonly feedNow: string | null;
  readonly onDepotChange: (depotId: string | null) => void;
  readonly onOffsetChange: (offset: number) => void;
}

/**
 * Bus exceptions, paged on the server (25 a page, worst first, filtered there by kind and
 * depot). The shared pager under the table is the only place the count appears; a depot
 * filter shows as a removable chip ("KAUSHAMBI ×") beside the depot select.
 */
export function BusExceptionSection(props: BusExceptionSectionProps) {
  const { page, pending, depots, depotId, feedNow, onDepotChange, onOffsetChange } = props;
  const options = useMemo(() => {
    const byId = new Map(depots.map((d) => [d.id, d.name]));
    if (!byId.has(UNASSIGNED_DEPOT_ID)) byId.set(UNASSIGNED_DEPOT_ID, 'No home depot');
    if (depotId !== null && !byId.has(depotId)) {
      // A depot named by the URL before the network list has loaded: name it from its rows.
      const fromRows = page.items.find((row) => row.depotId === depotId)?.depotName;
      byId.set(depotId, fromRows ?? `Depot ${depotId}`);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'en'));
  }, [depots, depotId, page.items]);
  const depotName =
    depotId === null ? null : (options.find(([id]) => id === depotId)?.[1] ?? depotId);
  const moves = pageMoves(page);

  // A poll can shrink the list below the current page: step back to the last
  // page, or to the first when the filter now matches nothing.
  useEffect(() => {
    if (pending || page.items.length > 0 || page.offset === 0) return;
    onOffsetChange(page.total > 0 && moves.previous !== null ? moves.previous : 0);
  }, [pending, page.items.length, page.total, page.offset, moves.previous, onOffsetChange]);

  return (
    <section aria-labelledby="bus-exceptions-title" className="mt-10">
      <SectionLabel
        id="bus-exceptions-title"
        label="Bus exceptions"
        count={page.total}
        note={busBasisNote(feedNow)}
      />
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
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
        {depotName === null ? null : (
          <button
            type="button"
            data-testid="bus-depot-chip"
            aria-label={`Clear the depot filter ${depotName}: show every depot`}
            onClick={() => onDepotChange(null)}
            className="depot-filter-button font-mono text-[11px] uppercase tracking-wider"
          >
            {depotName} <span aria-hidden>×</span>
          </button>
        )}
        {pending ? (
          <span role="status" className="depot-note">
            Loading this page…
          </span>
        ) : null}
      </div>
      {page.total === 0 && !pending ? (
        <StatePanel
          kind="empty"
          compact
          tone="ok"
          sentence={busRangeSentence({ ...page, shown: 0 }, depotName)}
        />
      ) : (
        <div aria-busy={pending}>
          <BusExceptionTable rows={page.items} kind={page.kind} />
        </div>
      )}
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
