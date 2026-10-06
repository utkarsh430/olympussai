'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import {
  ECONOMICS_COMPONENT_SPECS,
  type DifferenceDirection,
  type EconomicsCell,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import { sortRows, type SortDirection, type SortValue } from '@/lib/depot/tableSort';

/*
 * The economics table, on the shared `depot-table` classes. Rank, Depot and the
 * index stay put while the rest scrolls sideways inside the frame (the page
 * never does). Each component cell is a value and a signed difference from the
 * peer median, with a word saying whether that is better or worse.
 */

const FROZEN = {
  rank: 'sticky left-0 z-[5] w-14 min-w-14',
  depot: 'sticky left-14 z-[5] w-52 min-w-52 max-w-52',
  index: 'sticky left-[16.5rem] z-[5] w-40 min-w-40 border-r border-r-depot-line',
} as const;

const TONE: Readonly<Record<DifferenceDirection, string>> = {
  better: 'text-alert-green',
  worse: 'text-alert-amber',
  level: 'text-depot-muted',
  unknown: 'text-depot-muted',
};

const WORD: Readonly<Record<DifferenceDirection, string>> = {
  better: 'better',
  worse: 'worse',
  level: 'level',
  unknown: '',
};

const MEDIAN_TICK = 50;

interface Column {
  readonly key: string;
  readonly header: string;
  readonly modelledTag?: boolean;
  readonly className: string;
  readonly right?: boolean;
  readonly sortValue: (row: EconomicsRow) => SortValue;
}

const cellOf = (row: EconomicsRow, key: string): EconomicsCell | undefined =>
  row.cells.find((c) => c.key === key);

const COLUMNS: readonly Column[] = [
  { key: 'rank', header: 'Rank', className: FROZEN.rank, right: true, sortValue: (r) => r.rank },
  { key: 'depot', header: 'Depot', className: FROZEN.depot, sortValue: (r) => r.name },
  {
    key: 'index',
    header: 'Economics index',
    modelledTag: true,
    className: FROZEN.index,
    sortValue: (r) => r.economicsIndex,
  },
  { key: 'peerGroup', header: 'Peer group', className: '', sortValue: (r) => r.peerGroupLabel },
  ...ECONOMICS_COMPONENT_SPECS.map((spec) => ({
    key: spec.key,
    header: spec.label,
    className: '',
    right: true,
    sortValue: (r: EconomicsRow): SortValue => cellOf(r, spec.key)?.value ?? null,
  })),
  { key: 'fleet', header: 'Fleet', className: '', right: true, sortValue: (r) => r.fleet },
];

function MetricCell({ cell }: { readonly cell: EconomicsCell | undefined }) {
  if (!cell || cell.value === null) return <span className="text-depot-faint">—</span>;
  return (
    <span title={cell.description}>
      <span aria-hidden>{cell.valueText}</span>
      <span aria-hidden className={`ml-2 text-[11px] ${TONE[cell.direction]}`}>
        {`${cell.differenceText} ${WORD[cell.direction]}`.trim()}
      </span>
      <span className="sr-only">{cell.description}</span>
    </span>
  );
}

function IndexCell({ row }: { readonly row: EconomicsRow }) {
  if (row.economicsIndex === null) {
    const reason = row.reasonText ?? 'Not ranked';
    return (
      <span className="text-[11px] text-depot-muted" title={reason}>
        not ranked<span className="sr-only">{`: ${reason}`}</span>
      </span>
    );
  }
  const width = Math.min(100, Math.max(0, row.economicsIndex));
  return (
    <span className="flex items-center gap-2">
      <span className="w-10 text-right">{row.economicsIndex.toFixed(1)}</span>
      <span aria-hidden className="depot-bar-track w-16">
        <span className="depot-bar-fill" style={{ width: `${width}%` }} />
        <span className="depot-bar-tick" style={{ left: `${MEDIAN_TICK}%` }} />
      </span>
    </span>
  );
}

function DepotCell({
  row,
  selected,
  onSelect,
}: {
  readonly row: EconomicsRow;
  readonly selected: boolean;
  readonly onSelect: (row: EconomicsRow) => void;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {row.kind === 'unassigned' ? (
        <span className="min-w-0 truncate" title={row.name}>{row.name}</span>
      ) : (
        <Link
          href={depotHref(row.depotId)}
          title={`Open ${row.name}`}
          className="min-w-0 truncate text-holo-glow underline-offset-2 hover:underline"
        >
          {row.name}
        </Link>
      )}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Economics breakdown for ${row.name}`}
        className="ml-auto shrink-0 rounded-[3px] border border-depot-line px-1.5 text-[11px] uppercase tracking-[0.08em] text-depot-muted hover:text-depot-ink aria-pressed:border-holo-glow aria-pressed:text-holo-glow"
        onClick={() => onSelect(row)}
      >
        Score
      </button>
    </span>
  );
}

function content(column: Column, row: EconomicsRow, selected: boolean, onSelect: (r: EconomicsRow) => void) {
  switch (column.key) {
    case 'rank':
      return row.rank ?? '—';
    case 'depot':
      return <DepotCell row={row} selected={selected} onSelect={onSelect} />;
    case 'index':
      return <IndexCell row={row} />;
    case 'peerGroup':
      return row.peerGroupLabel ?? '—';
    case 'fleet':
      return formatCount(row.fleet);
    default:
      return <MetricCell cell={cellOf(row, column.key)} />;
  }
}

interface Sort {
  readonly key: string;
  readonly direction: SortDirection;
}

export interface EconomicsGridProps {
  readonly rows: readonly EconomicsRow[];
  readonly selectedId: string | null;
  readonly onSelect: (row: EconomicsRow) => void;
}

export function EconomicsGrid({ rows, selectedId, onSelect }: EconomicsGridProps) {
  const [sort, setSort] = useState<Sort | null>(null);
  const visible = useMemo(() => {
    const column = sort ? COLUMNS.find((c) => c.key === sort.key) : undefined;
    return sort && column ? sortRows(rows, column.sortValue, sort.direction) : rows;
  }, [rows, sort]);
  const toggle = (key: string): void =>
    setSort((s) => ({ key, direction: s?.key === key && s.direction === 'asc' ? 'desc' : 'asc' }));

  return (
    <div
      role="region"
      aria-label="Depot economics ranking, modelled"
      tabIndex={0}
      className="depot-table-frame"
    >
      <table className="depot-table">
        <caption className="px-2 py-2 text-left">
          <span className="depot-label mr-2">Depot Economics Index ranking within peer groups</span>
          <ProvenanceBadge provenance="modelled" />
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((c) => {
              const active = sort?.key === c.key ? sort.direction : null;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active === null ? 'none' : active === 'asc' ? 'ascending' : 'descending'}
                  className={`${c.className} ${c.className.includes('sticky') ? '!z-20' : ''} ${c.right ? 'depot-align-right' : ''}`}
                >
                  <button type="button" className="depot-sort-button" onClick={() => toggle(c.key)}>
                    {c.header}
                    {c.modelledTag ? <span className="ml-1 text-alert-amber">MODELLED</span> : null}
                    <span aria-hidden className="inline-block w-3 text-holo-glow">
                      {active === null ? '' : active === 'asc' ? '↑' : '↓'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className="depot-prose !py-6">
                No depots match. Turn on Show unranked or clear the search.
              </td>
            </tr>
          ) : null}
          {visible.map((row) => {
            const selected = row.depotId === selectedId;
            return (
              <tr
                key={row.depotId}
                aria-selected={selected}
                className={`group depot-row-selectable ${selected ? 'depot-row-selected' : ''}`}
              >
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={`whitespace-nowrap ${c.className} ${c.right ? 'depot-align-right' : ''} ${
                      c.className.includes('sticky')
                        ? `${selected ? 'bg-depot-raised' : 'bg-depot-page'} group-hover:bg-depot-raised`
                        : ''
                    }`}
                  >
                    {content(c, row, selected, onSelect)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
