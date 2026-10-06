'use client';

import { useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { DEPOT_GROUP_CAP, capGroups } from '@/lib/depot/exceptions/pageModel';
import { formatCount } from '@/lib/depot/format';
import type { MoveRow } from '@/lib/depot/routes/allocationGroups';
import type { Provenance } from '@/lib/depot/types';
import { DepotLink } from './RouteCells';

/** Route stays put while the figures scroll sideways inside the frame. */
const FROZEN = 'sticky left-0 z-[5] w-48 min-w-48 max-w-48 border-r border-r-depot-line bg-depot-page';

interface Header {
  readonly key: string;
  readonly label: string;
  readonly provenance?: Provenance;
  readonly right?: boolean;
  readonly className?: string;
}

const HEADERS: readonly Header[] = [
  { key: 'route', label: 'Route', className: `${FROZEN} !z-20 !bg-depot-surface` },
  { key: 'from', label: 'From depot' },
  { key: 'to', label: 'To depot' },
  { key: 'trips', label: 'Trips a day', provenance: 'modelled', right: true },
  { key: 'now', label: 'Dead km a trip now', provenance: 'derived', right: true },
  { key: 'after', label: 'Dead km a trip after', provenance: 'derived', right: true },
  { key: 'saving', label: 'Saving, km a day', provenance: 'modelled', right: true },
  { key: 'note', label: 'Note' },
];

export interface MovesTableProps {
  /** Already ordered, largest saving first. */
  readonly rows: readonly MoveRow[];
}

/** The recommended moves, the first 25 until the reader asks for the rest. */
export function MovesTable({ rows }: MovesTableProps) {
  const [showAll, setShowAll] = useState(false);
  const { shown, hidden } = capGroups(rows, showAll);
  return (
    <div>
      <div role="region" aria-label="Recommended moves" tabIndex={0} className="depot-table-frame">
        <table className="depot-table">
          <caption className="sr-only">
            Recommended moves, largest saving first. Trips and savings are modelled; dead kilometres
            are derived.
          </caption>
          <thead>
            <tr>
              {HEADERS.map((h) => (
                <th
                  key={h.key}
                  scope="col"
                  className={`${h.className ?? ''} ${h.right ? 'depot-align-right' : ''}`}
                >
                  <span className="inline-flex items-center gap-2">
                    {h.label}
                    {h.provenance ? <ProvenanceBadge provenance={h.provenance} /> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.routeName}>
                <td className={FROZEN} title={row.routeName}>
                  <span className="block max-w-[10.5rem] truncate">{row.routeName}</span>
                </td>
                <td className="whitespace-nowrap">
                  <DepotLink depotId={row.fromDepotId} name={row.fromDepotName} linked={row.fromLinked} />
                </td>
                <td className="whitespace-nowrap">
                  <DepotLink depotId={row.toDepotId} name={row.toDepotName} linked={row.toLinked} />
                </td>
                <td className="depot-align-right">{row.trips}</td>
                <td className="depot-align-right">{row.deadNow}</td>
                <td className="depot-align-right">{row.deadAfter}</td>
                <td className="depot-align-right">{row.saving}</td>
                <td className="min-w-[12rem] text-[11px] text-depot-muted">{row.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > DEPOT_GROUP_CAP ? (
        <button
          type="button"
          className="depot-filter-button mt-2"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? `Show the first ${DEPOT_GROUP_CAP}`
            : `Show all ${formatCount(rows.length)} moves (${formatCount(hidden)} more)`}
        </button>
      ) : null}
    </div>
  );
}
