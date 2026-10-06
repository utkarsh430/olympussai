'use client';

import { useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { DEPOT_GROUP_CAP, capGroups } from '@/lib/depot/exceptions/pageModel';
import { formatCount } from '@/lib/depot/format';
import type { MoveRow } from '@/lib/depot/routes/allocationGroups';
import { MOVES_COLUMNS, MOVES_TABLE_PX } from '@/lib/depot/routes/movesColumns';
import { DepotLink } from './RouteCells';

/** Route stays put while the figures scroll sideways inside the frame. */
const FROZEN = 'sticky left-0 z-[5] border-r border-r-depot-line bg-depot-page';

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
        <table className="depot-table depot-table-fixed" style={{ minWidth: MOVES_TABLE_PX }}>
          <caption className="sr-only">
            Recommended moves, largest saving first. Trips and savings are modelled; dead kilometres
            are derived.
          </caption>
          <thead>
            <tr>
              {MOVES_COLUMNS.map((h) => (
                <th
                  key={h.key}
                  scope="col"
                  style={{ width: h.widthPx }}
                  className={`${h.key === 'route' ? `${FROZEN} !z-20 !bg-depot-surface` : ''} ${h.right ? 'depot-align-right' : ''}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {h.label}
                    {h.tag ? <ProvenanceBadge provenance={h.tag} pill /> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.routeName}>
                <td className={FROZEN} title={row.routeName}>
                  <span className="block truncate">{row.routeName}</span>
                </td>
                <td title={row.fromDepotName}>
                  <DepotLink depotId={row.fromDepotId} name={row.fromDepotName} linked={row.fromLinked} />
                </td>
                <td title={row.toDepotName}>
                  <DepotLink depotId={row.toDepotId} name={row.toDepotName} linked={row.toLinked} />
                </td>
                <td className="depot-align-right">{row.trips}</td>
                <td className="depot-align-right">{row.deadNow}</td>
                <td className="depot-align-right">{row.deadAfter}</td>
                <td className="depot-align-right">{row.saving}</td>
                <td className="text-[11px] text-depot-muted" title={row.note ?? undefined}>
                  {row.note ?? ''}
                </td>
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
