import Link from 'next/link';
import type { Column } from '@/components/depot/shell/DataTable';
import { DisclosureChevron } from '@/components/depot/shell/DisclosureChevron';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import {
  ECONOMICS_COLUMN_WIDTHS,
  ECONOMICS_COMPONENT_SPECS,
  breakdownButtonName,
  type EconomicsCell,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import type { SortValue } from '@/lib/depot/tableSort';

/*
 * The economics table's columns for the shared DataTable. Units and direction
 * live in the headers and the sign note, so a cell is a bare number with the
 * signed change against the peer median as a muted suffix. The breakdown opens
 * from the index cell: its value and bar are the button, and a chevron shows at
 * the row's end on hover and focus (the league page does the same).
 */

const MEDIAN_TICK = 50;
const DASH = '—';
/** Shown on the hovered or focused row, always on the selected one. */
const ROW_END_REVEAL = 'opacity-0 [tr:focus-within_&]:opacity-100 [tr:hover_&]:opacity-100';

const cellOf = (row: EconomicsRow, key: string): EconomicsCell | undefined =>
  row.cells.find((c) => c.key === key);

function MetricCell({ cell }: { readonly cell: EconomicsCell | undefined }) {
  if (!cell) return null;
  if (cell.value === null) return <span className="text-depot-muted">{DASH}</span>;
  return (
    <span>
      <span aria-hidden>{cell.bareValue}</span>
      {cell.bareDifference === '' ? null : (
        <span aria-hidden className="ml-2 text-[11px] text-depot-muted">
          {cell.bareDifference}
        </span>
      )}
      <span className="sr-only">{cell.description}</span>
    </span>
  );
}

interface SelectProps {
  readonly row: EconomicsRow;
  readonly selected: boolean;
  readonly onSelect: (row: EconomicsRow) => void;
}

function IndexButton({ row, selected, onSelect }: SelectProps) {
  const index = row.economicsIndex;
  const width = index === null ? 0 : Math.min(100, Math.max(0, index));
  const spoken = index === null ? `not ranked: ${row.reasonText ?? ''}` : `index ${index.toFixed(1)}`;
  return (
    <>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={breakdownButtonName(row.name)}
        aria-controls={selected ? 'economics-breakdown' : undefined}
        onClick={() => onSelect(row)}
        className="flex w-full min-w-0 items-center gap-2 rounded-[3px] text-left hover:text-holo-glow focus-visible:outline focus-visible:outline-1 focus-visible:outline-holo-glow aria-pressed:text-holo-glow"
      >
        {index === null ? (
          <span className="min-w-0 truncate text-[11px] text-depot-muted">
            {row.reasonShort === null ? 'not ranked' : `not ranked · ${row.reasonShort}`}
          </span>
        ) : (
          <>
            <span className="w-10 text-right tabular-nums">{index.toFixed(1)}</span>
            <span aria-hidden className="depot-bar-track w-16">
              <span className="depot-bar-fill" style={{ width: `${width}%` }} />
              <span className="depot-bar-tick" style={{ left: `${MEDIAN_TICK}%` }} />
            </span>
          </>
        )}
      </button>
      <span className="sr-only">{spoken}</span>
    </>
  );
}

function FleetCell({ row, selected }: { readonly row: EconomicsRow; readonly selected: boolean }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {formatCount(row.fleet)}
      <span className={selected ? '' : ROW_END_REVEAL}>
        <DisclosureChevron open={selected} />
      </span>
    </span>
  );
}

function DepotName({ row }: { readonly row: EconomicsRow }) {
  if (row.kind === 'unassigned') return <span className="block min-w-0 truncate">{row.name}</span>;
  return (
    <Link
      href={depotHref(row.depotId)}
      className="block min-w-0 truncate text-holo-glow underline-offset-2 hover:underline"
    >
      {row.name}
    </Link>
  );
}

/** The table's columns for the current selection; memoise on its arguments. */
export function economicsColumns(
  selectedId: string | null,
  onSelect: (row: EconomicsRow) => void,
): readonly Column<EconomicsRow>[] {
  const metrics = ECONOMICS_COMPONENT_SPECS.map(
    (spec): Column<EconomicsRow> => ({
      key: spec.key,
      header: spec.header,
      unit: spec.headerUnit,
      align: 'right',
      width: ECONOMICS_COLUMN_WIDTHS[spec.key],
      sortValue: (r: EconomicsRow): SortValue => cellOf(r, spec.key)?.value ?? null,
      title: (r) => cellOf(r, spec.key)?.description,
      render: (r) => <MetricCell cell={cellOf(r, spec.key)} />,
    }),
  );
  return [
    {
      key: 'rank',
      header: 'Rank',
      align: 'right',
      width: ECONOMICS_COLUMN_WIDTHS.rank,
      sortValue: (r) => r.rank,
      title: (r) => (r.rank === null ? (r.reasonText ?? 'Not ranked') : undefined),
      render: (r) => (r.rank === null ? DASH : String(r.rank)),
    },
    {
      key: 'depot',
      header: 'Depot',
      width: ECONOMICS_COLUMN_WIDTHS.depot,
      sortValue: (r) => r.name,
      title: (r) => r.name,
      render: (r) => <DepotName row={r} />,
    },
    {
      key: 'index',
      header: 'Economics index',
      width: ECONOMICS_COLUMN_WIDTHS.index,
      sortValue: (r) => r.economicsIndex,
      title: (r) => r.reasonText ?? undefined,
      render: (r) => (
        <IndexButton row={r} selected={r.depotId === selectedId} onSelect={onSelect} />
      ),
    },
    ...metrics,
    {
      key: 'fleet',
      header: 'Fleet',
      align: 'right',
      width: ECONOMICS_COLUMN_WIDTHS.fleet,
      sortValue: (r) => r.fleet,
      title: (r) => `${formatCount(r.fleet)} buses`,
      render: (r) => <FleetCell row={r} selected={r.depotId === selectedId} />,
    },
  ];
}
