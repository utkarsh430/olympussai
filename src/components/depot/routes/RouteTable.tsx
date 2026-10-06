'use client';

import { useRef } from 'react';
import { Pager } from '@/components/depot/shell/LongLists';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { TableOverflowCue, useColumnsToTheRight } from '@/components/depot/shell/TableOverflowCue';
import type { DepotRoutesResponse, RouteListItem } from '@/lib/depot/routes/api';
import { LATE_AFTER_MIN } from '@/lib/depot/routes/delayConfig';
import { deadKmWords, delayWords, medianCell, operatorsView } from '@/lib/depot/routes/routeRowWording';
import type { RouteSort, RouteSortKey, RoutesQuery } from '@/lib/depot/routes/routeQuery';
import {
  columnsAtWidth,
  frozenLeft,
  routeTableWidth,
  visibleRouteColumns,
  type RouteColumnSpec,
  type RouteWidthTier,
} from '@/lib/depot/routes/routeTableColumns';
import { offsetOf, serverPage } from '@/lib/depot/routes/routesPageModel';
import { formatCount } from '@/lib/depot/format';
import { FigureWithNote, OperatorsCell } from './RouteCells';
import { RouteTableControls, type RouteFilters } from './RouteTableControls';

const HEADER_TITLE: Partial<Record<RouteSortKey, string>> = {
  median: 'Median delay of the buses with a usable delay, in minutes',
  late: `Share of buses with a usable delay running more than ${LATE_AFTER_MIN} minutes late`,
};

/** One cell's content; the route name is drawn by the table as its drawer button. */
function cell(key: RouteSortKey, r: RouteListItem): React.ReactNode {
  switch (key) {
    case 'depot':
      return <OperatorsCell view={operatorsView(r)} />;
    case 'buses':
      return formatCount(r.buses);
    case 'class':
      return r.serviceToken ?? '—';
    case 'trips':
      return r.tripsBasis === 'bus_count_over_cap' ? 'Not modelled' : formatCount(r.tripsPerDay.value);
    case 'deadKm': {
      const w = deadKmWords(r);
      return <FigureWithNote value={w.value} note={w.note} />;
    }
    case 'median':
      return <FigureWithNote value={medianCell(r.delay)} note={delayWords(r.delay).basis} />;
    case 'late':
      return <FigureWithNote value={delayWords(r.delay).late.replace(/%$/, '')} note={delayWords(r.delay).basis} />;
    case 'profile':
      return r.profiled ? 'Known' : 'Not known';
    default:
      return r.routeName;
  }
}

/** A column drawn only from its tier up (literal classes, so Tailwind sees them). */
const TIER_CELL: Readonly<Record<RouteWidthTier, string>> = {
  base: '',
  lg: 'hidden lg:table-cell',
  wide: 'hidden min-[1440px]:table-cell',
};
/** The table's minimum width per tier: the sum of the columns that tier draws. */
const TIER_MIN_WIDTH =
  'min-w-[var(--route-w-base)] lg:min-w-[var(--route-w-lg)] min-[1440px]:min-w-[var(--route-w-wide)]';
/** Table links: cyan, underlined on hover and focus only (critique round 5, §5). */
export const TABLE_LINK =
  'depot-table-link text-holo-glow decoration-holo-glow/40 underline-offset-2 hover:underline focus-visible:underline';

function tierWidths(columns: readonly RouteColumnSpec[]): React.CSSProperties {
  const px = (tier: RouteWidthTier): string => `${routeTableWidth(columnsAtWidth(columns, tier))}px`;
  return {
    '--route-w-base': px('base'),
    '--route-w-lg': px('lg'),
    '--route-w-wide': px('wide'),
  } as React.CSSProperties;
}

function ariaSort(sort: RouteSort | null, key: string): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

function frozenStyle(columns: readonly RouteColumnSpec[], c: RouteColumnSpec): React.CSSProperties {
  return c.frozen ? { position: 'sticky', left: frozenLeft(columns, c.key) } : {};
}

export interface RouteTableProps {
  /** One server page, filtered and sorted on the server. */
  readonly data: DepotRoutesResponse;
  /** The rows are the previous query's while the new one loads: dimmed and marked busy. */
  readonly busy?: boolean;
  readonly query: RoutesQuery;
  readonly onQueryChange: (next: RoutesQuery) => void;
  /** Opens the route's drawer; the button is passed so focus can return to it. */
  readonly onOpenRoute: (route: RouteListItem, opener: HTMLButtonElement) => void;
}

/**
 * One page of the route table. Filters, sort and the page are sent to the server as query
 * parameters (`routeQuery.ts`), so sorting is on every field the server sorts by and never
 * reorders only the visible page. Widths and tags come from `routeTableColumns`.
 */
export function RouteTable({ data, busy = false, query, onQueryChange, onOpenRoute }: RouteTableProps) {
  const filtered = Boolean(query.depotId || query.serviceClass || query.q);
  const sort = query.sort;
  const frame = useRef<HTMLDivElement>(null);
  const moreColumns = useColumnsToTheRight(frame, true);
  const columns = visibleRouteColumns(data.routes);
  const current = serverPage(data.total, data.offset, data.limit);
  const filters: RouteFilters = { depotId: query.depotId, serviceClass: query.serviceClass, q: query.q };
  const changeFilters = (next: RouteFilters): void => onQueryChange({ ...query, ...next, offset: 0 });
  const setPage = (page: number): void => onQueryChange({ ...query, offset: offsetOf(page, query.limit) });
  const toggleSort = (key: RouteSortKey): void => {
    const direction = sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onQueryChange({ ...query, sort: { key, direction }, offset: 0 });
  };
  return (
    <>
      <RouteTableControls
        filters={filters}
        depots={data.depotOptions}
        classes={data.classOptions}
        onFiltersChange={changeFilters}
      />
      <div className="relative min-w-0">
        <div
          ref={frame}
          role="region"
          aria-label="Route table"
          aria-busy={busy || undefined}
          data-testid="route-table-frame"
          tabIndex={0}
          className={`depot-table-frame ${busy ? 'opacity-60' : ''}`}
        >
          <table className={`depot-table depot-table-fixed ${TIER_MIN_WIDTH}`} style={tierWidths(columns)}>
            <caption className="sr-only">Every route in the feed</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    title={HEADER_TITLE[c.key]}
                    aria-sort={ariaSort(sort, c.key)}
                    style={{ width: c.widthPx, ...frozenStyle(columns, c) }}
                    className={`${TIER_CELL[c.from]} ${c.frozen ? '!z-20' : ''} ${c.key === 'depot' ? 'border-r border-r-depot-line' : ''} ${c.align === 'right' ? 'depot-align-right' : ''}`}
                  >
                    {/* The tag sits right after its label, in the same right-aligned cell. */}
                    <span className="inline-flex items-center gap-1.5">
                      <button type="button" className="depot-sort-button" onClick={() => toggleSort(c.key)}>
                        {c.header}
                        {c.unit ? <span className="text-depot-faint"> {c.unit}</span> : null}
                        <span aria-hidden className="inline-block w-3 text-holo-glow">
                          {sort?.key === c.key ? (sort.direction === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                      {c.tag ? <ProvenanceBadge provenance={c.tag} pill /> : null}
                    </span>
                    {HEADER_TITLE[c.key] ? <span className="sr-only">{HEADER_TITLE[c.key]}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.routes.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="depot-prose !h-auto !whitespace-normal !py-6">
                    No routes match these filters. Choose All depots or All classes, or clear the
                    name, to widen the list.
                  </td>
                </tr>
              ) : null}
              {data.routes.map((row) => (
                <tr key={row.routeName} className="group hover:bg-depot-raised">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={frozenStyle(columns, c)}
                      className={`${TIER_CELL[c.from]} ${c.frozen ? 'z-[5] bg-depot-page group-hover:bg-depot-raised' : ''} ${
                        c.key === 'depot' ? 'border-r border-r-depot-line' : ''
                      } ${c.align === 'right' ? 'depot-align-right' : ''}`}
                    >
                      {c.key === 'route' ? (
                        <button
                          type="button"
                          className={`${TABLE_LINK} block max-w-full truncate text-left`}
                          title={row.description ?? row.routeName}
                          onClick={(event) => onOpenRoute(row, event.currentTarget)}
                        >
                          {row.routeName}
                        </button>
                      ) : (
                        cell(c.key, row)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {moreColumns ? <TableOverflowCue /> : null}
      </div>
      {/* The pager is the list's only count, so a filtered list always shows it (R2-m20). */}
      {data.total > data.limit || (filtered && data.total > 0) ? (
        <Pager page={current.page} total={data.total} pageSize={data.limit} onPage={setPage} />
      ) : null}
    </>
  );
}
