import Link from 'next/link';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import {
  ECONOMICS_COMPONENT_SPECS,
  type DifferenceDirection,
  type EconomicsCell,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import { modelledHeader } from '@/lib/depot/revenue/revenuePageModel';
import type { SortValue } from '@/lib/depot/tableSort';

/*
 * The economics grid's columns and cells. Rank, Depot and the index stay put
 * while the rest scrolls sideways inside the frame (the page never does). Each
 * component cell is a value and a signed difference from the peer median, with
 * a word saying whether that is better or worse.
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

export interface Column {
  readonly key: string;
  readonly header: string;
  readonly className: string;
  readonly right?: boolean;
  readonly sortValue: (row: EconomicsRow) => SortValue;
}

const cellOf = (row: EconomicsRow, key: string): EconomicsCell | undefined =>
  row.cells.find((c) => c.key === key);

export const COLUMNS: readonly Column[] = [
  { key: 'rank', header: 'Rank', className: FROZEN.rank, right: true, sortValue: (r) => r.rank },
  { key: 'depot', header: 'Depot', className: FROZEN.depot, sortValue: (r) => r.name },
  {
    key: 'index',
    header: modelledHeader('Economics index'),
    className: FROZEN.index,
    sortValue: (r) => r.economicsIndex,
  },
  { key: 'peerGroup', header: 'Peer group', className: '', sortValue: (r) => r.peerGroupLabel },
  ...ECONOMICS_COMPONENT_SPECS.map((spec) => ({
    key: spec.key,
    header: modelledHeader(spec.label),
    className: '',
    right: true,
    sortValue: (r: EconomicsRow): SortValue => cellOf(r, spec.key)?.value ?? null,
  })),
  { key: 'fleet', header: 'Fleet', className: '', right: true, sortValue: (r) => r.fleet },
];

function MetricCell({ cell }: { readonly cell: EconomicsCell | undefined }) {
  if (!cell) return null;
  const note =
    cell.noteText === null ? null : (
      <span aria-hidden className="block text-[11px] text-depot-muted">
        {cell.noteText}
      </span>
    );
  if (cell.value === null) {
    return (
      <span title={cell.description}>
        <span aria-hidden className="text-depot-muted">{cell.valueText}</span>
        {note}
        <span className="sr-only">{cell.description}</span>
      </span>
    );
  }
  return (
    <span title={cell.description}>
      <span aria-hidden>{cell.valueText}</span>
      {cell.differenceText === '' ? null : (
        <span aria-hidden className={`ml-2 text-[11px] ${TONE[cell.direction]}`}>
          {`${cell.differenceText} ${WORD[cell.direction]}`.trim()}
        </span>
      )}
      {note}
      <span className="sr-only">{cell.description}</span>
    </span>
  );
}

function IndexCell({ row }: { readonly row: EconomicsRow }) {
  if (row.economicsIndex === null) {
    const reason = row.reasonText ?? 'Not ranked';
    return (
      <span className="block whitespace-normal text-[11px] text-depot-muted" title={reason}>
        not ranked
        {row.reasonShort === null ? null : <span className="block">{row.reasonShort}</span>}
        <span className="sr-only">{`: ${reason}`}</span>
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

export function content(column: Column, row: EconomicsRow, selected: boolean, onSelect: (r: EconomicsRow) => void) {
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
