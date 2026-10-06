'use client';

import Link from 'next/link';
import { depotLink } from '@/lib/depot/network/mapWords';
import {
  formatIndex,
  rankedIndex,
  unrankedReason,
  type DepotRow,
} from '@/lib/depot/network/overviewModel';

/**
 * Both lines always render at a fixed minimum height, selected or not, so the
 * map and the table never jump when the first selection arrives.
 */
const LINE =
  'flex min-h-[34px] min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-y border-depot-line py-1';

function detail(row: DepotRow): string {
  const index = rankedIndex(row);
  return index === null ? `Not ranked: ${unrankedReason(row)}` : `Index ${formatIndex(index)}`;
}

function showOnMap(): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document
    .getElementById('depot-map-heading')
    ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  document.getElementById('depot-panel-heading')?.focus({ preventScroll: true });
}

/** "Selected: KAUSHAMBI" with Clear, right above the map. */
export function SelectionLine({
  row,
  onClear,
}: {
  readonly row: DepotRow | null;
  readonly onClear: () => void;
}) {
  return (
    <div className={`${LINE} mb-2`} data-testid="depot-map-selection">
      {row ? (
        <>
          <span className="min-w-0 truncate text-[13px] text-depot-ink">
            <span className="text-depot-muted">Selected: </span>
            {row.depot.name}
          </span>
          <span className="text-[13px] tabular-nums text-depot-muted">{detail(row)}</span>
          <button type="button" onClick={onClear} className="depot-filter-button ml-auto">
            Clear selection
          </button>
        </>
      ) : (
        <span className="font-sans text-[13px] text-depot-muted">No depot selected.</span>
      )}
    </div>
  );
}

/** Says what a click in the table or the lists did, right where the click happened. */
export function SelectionBar({ row }: { readonly row: DepotRow | null }) {
  const href = row ? depotLink(row.depot) : null;
  return (
    <div className={`${LINE} mb-2`} data-testid="depot-table-selection">
      {row ? (
        <>
          <span className="min-w-0 truncate text-[13px] text-depot-ink">
            <span className="text-depot-muted">Selected: </span>
            {row.depot.name}
          </span>
          <span className="text-[13px] tabular-nums text-depot-muted">{detail(row)}</span>
          <span className="ml-auto flex items-center gap-3">
            {href ? (
              <Link href={href} className="depot-link text-[13px]">
                Open depot
              </Link>
            ) : null}
            <button type="button" onClick={showOnMap} className="depot-filter-button">
              Show on map
            </button>
          </span>
        </>
      ) : (
        <span className="font-sans text-[13px] text-depot-muted">
          Select a row to see the depot on the map and in the summary beside it.
        </span>
      )}
    </div>
  );
}
