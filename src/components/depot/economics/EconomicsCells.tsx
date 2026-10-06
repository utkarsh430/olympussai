import Link from 'next/link';
import type { Column } from '@/components/depot/shell/DataTable';
import { depotHref } from '@/lib/depot/depotNav';
import { indexFillStyle } from '@/components/depot/league/IndexBar';
import { formatCount } from '@/lib/depot/format';
import { meaningTextClass } from '@/lib/depot/palette';
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
 * signed change against the peer median as a muted suffix. The breakdown opens as
 * the shared table's expanded row: the row is the control (one tab stop, the chevron
 * first), and the index cell's value and bar are also a button for the pointer.
 */

const MEDIAN_TICK = 50;
const DASH = '—';
/** The breakdown's id inside the expanded row, for the index button's `aria-controls`. */
export const BREAKDOWN_ID = 'economics-breakdown';

const cellOf = (row: EconomicsRow, key: string): EconomicsCell | undefined =>
  row.cells.find((c) => c.key === key);

/** The columns whose better direction the page states: higher earnings, lower fuel cost. */
const STATED_DIRECTION: ReadonlySet<string> = new Set(['earningsPerKm', 'costPerKm']);

/**
 * A change against the peer median in green when better and crimson when worse, only on
 * the columns whose direction the page states; level, unknown and load stay muted.
 */
export function differenceClass(cell: Pick<EconomicsCell, 'key' | 'direction'>): string {
  if (!STATED_DIRECTION.has(cell.key)) return 'text-depot-muted';
  if (cell.direction === 'better' || cell.direction === 'worse') {
    return meaningTextClass(cell.direction);
  }
  return 'text-depot-muted';
}

function MetricCell({ cell }: { readonly cell: EconomicsCell | undefined }) {
  if (!cell) return null;
  if (cell.value === null) return <span className="text-depot-muted">{DASH}</span>;
  return (
    <span>
      <span aria-hidden>{cell.bareValue}</span>
      {cell.bareDifference === '' ? null : (
        <span aria-hidden className={`ml-2 text-[11px] ${differenceClass(cell)}`}>
          {cell.bareDifference}
        </span>
      )}
      <span className="sr-only">{cell.description}</span>
    </span>
  );
}

interface IndexButtonProps {
  readonly row: EconomicsRow;
  readonly open: boolean;
  readonly onToggle: (row: EconomicsRow) => void;
}

/** Out of the tab order: the row is the keyboard control, this is the pointer's target. */
function IndexButton({ row, open, onToggle }: IndexButtonProps) {
  const index = row.economicsIndex;
  const width = index === null ? 0 : Math.min(100, Math.max(0, index));
  const spoken =
    index === null ? `not ranked: ${row.reasonText ?? ''}` : `index ${index.toFixed(1)}`;
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-expanded={open}
        aria-label={breakdownButtonName(row.name)}
        aria-controls={open ? BREAKDOWN_ID : undefined}
        onClick={() => onToggle(row)}
        className="flex w-full min-w-0 items-center gap-2 rounded-[3px] text-left hover:text-holo-glow aria-expanded:text-holo-glow"
      >
        {index === null ? (
          <span className="min-w-0 truncate text-[11px] text-depot-muted">
            {row.reasonShort === null ? 'not ranked' : `not ranked · ${row.reasonShort}`}
          </span>
        ) : (
          <>
            <span className="w-10 text-right tabular-nums">{index.toFixed(1)}</span>
            <span aria-hidden className="depot-bar-track w-16">
              <span className="depot-bar-fill" style={indexFillStyle(index, width)} />
              <span className="depot-bar-tick" style={{ left: `${MEDIAN_TICK}%` }} />
            </span>
          </>
        )}
      </button>
      <span className="sr-only">{spoken}</span>
    </>
  );
}

function DepotName({ row }: { readonly row: EconomicsRow }) {
  if (row.kind === 'unassigned') return <span className="block min-w-0 truncate">{row.name}</span>;
  return (
    <Link href={depotHref(row.depotId)} className="depot-table-link block min-w-0 truncate">
      {row.name}
    </Link>
  );
}

/** The table's columns for the open row; memoise on its arguments. */
export function economicsColumns(
  openId: string | null,
  onToggle: (row: EconomicsRow) => void,
): readonly Column<EconomicsRow>[] {
  const metrics = ECONOMICS_COMPONENT_SPECS.map((spec): Column<EconomicsRow> => ({
    key: spec.key,
    header: spec.header,
    unit: spec.headerUnit,
    align: 'right',
    width: ECONOMICS_COLUMN_WIDTHS[spec.key],
    sortValue: (r: EconomicsRow): SortValue => cellOf(r, spec.key)?.value ?? null,
    title: (r) => cellOf(r, spec.key)?.description,
    render: (r) => <MetricCell cell={cellOf(r, spec.key)} />,
  }));
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
      render: (r) => <IndexButton row={r} open={r.depotId === openId} onToggle={onToggle} />,
    },
    ...metrics,
    {
      key: 'fleet',
      header: 'Fleet',
      align: 'right',
      width: ECONOMICS_COLUMN_WIDTHS.fleet,
      sortValue: (r) => r.fleet,
      title: (r) => `${formatCount(r.fleet)} buses`,
      render: (r) => formatCount(r.fleet),
    },
  ];
}
