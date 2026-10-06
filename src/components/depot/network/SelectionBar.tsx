'use client';

import Link from 'next/link';
import { PANEL_HEADING_ID } from './clearSelection';
import { depotLink } from '@/lib/depot/network/mapWords';
import { TABLE_SELECT_NOTE } from '@/lib/depot/network/unitsTable';
import {
  formatIndex,
  rankedIndex,
  unrankedReason,
  type DepotRow,
} from '@/lib/depot/network/overviewModel';

/**
 * The line renders at a fixed minimum height, selected or not, so the table never jumps
 * when the first selection arrives. No rules of its own: the section's one rule is above
 * its label, and the table's header draws the line under this one.
 */
const LINE = 'flex min-h-[34px] min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-1';

function detail(row: DepotRow): string {
  const index = rankedIndex(row);
  return index === null ? `Not ranked: ${unrankedReason(row)}` : `Index ${formatIndex(index)}`;
}

function showOnMap(): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document
    .getElementById('depot-map-heading')
    ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  document.getElementById(PANEL_HEADING_ID)?.focus({ preventScroll: true });
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
        <p className="depot-note">
          {TABLE_SELECT_NOTE}
        </p>
      )}
    </div>
  );
}
