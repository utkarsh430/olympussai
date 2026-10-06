'use client';

import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { DepotRoutesResponse, RouteListItem } from '@/lib/depot/routes/api';
import { LATE_AFTER_MIN } from '@/lib/depot/routes/delayConfig';
import { deadKmWords, delayWords, operatorsView } from '@/lib/depot/routes/routeRowWording';
import type { RouteSort, RouteSortKey, RoutesQuery } from '@/lib/depot/routes/routeQuery';
import { offsetOf, routeRangeSentence, serverPage } from '@/lib/depot/routes/routesPageModel';
import { formatCount } from '@/lib/depot/format';
import type { Provenance } from '@/lib/depot/types';
import { FigureWithNote, OperatorsCell } from './RouteCells';
import { RouteTableControls, type RouteFilters } from './RouteTableControls';

/** Route and Depots stay put while the figures scroll sideways inside the frame. */
const FROZEN = {
  route: 'sticky left-0 z-[5] w-48 min-w-48 max-w-48',
  depots: 'sticky left-48 z-[5] w-56 min-w-56 max-w-56 border-r border-r-depot-line',
} as const;

interface RouteColumn {
  readonly key: RouteSortKey | 'basis';
  readonly header: string;
  readonly title?: string;
  readonly provenance?: Provenance;
  readonly frozen?: string;
  readonly right?: boolean;
  readonly render: (row: RouteListItem) => React.ReactNode;
}

const COLUMNS: readonly RouteColumn[] = [
  {
    key: 'route',
    header: 'Route',
    frozen: FROZEN.route,
    // Rendered by the table itself: the route name is the button that opens its drawer.
    render: (r) => r.routeName,
  },
  {
    key: 'depot',
    header: 'Depots',
    frozen: FROZEN.depots,
    render: (r) => <OperatorsCell view={operatorsView(r)} />,
  },
  { key: 'buses', header: 'Buses now', right: true, render: (r) => formatCount(r.buses) },
  { key: 'class', header: 'Class', render: (r) => r.serviceToken ?? '—' },
  {
    key: 'trips',
    header: 'Trips a day',
    provenance: 'modelled',
    right: true,
    render: (r) =>
      r.tripsBasis === 'bus_count_over_cap' ? 'Not modelled' : formatCount(r.tripsPerDay.value),
  },
  {
    key: 'deadKm',
    header: 'Dead km a trip',
    provenance: 'derived',
    right: true,
    render: (r) => {
      const w = deadKmWords(r);
      return <FigureWithNote value={w.value} note={w.note} />;
    },
  },
  { key: 'median', header: 'Median delay', right: true, render: (r) => delayWords(r.delay).median },
  {
    key: 'late',
    header: 'Late',
    title: `Share of buses with a usable delay running more than ${LATE_AFTER_MIN} minutes late`,
    right: true,
    render: (r) => delayWords(r.delay).late,
  },
  { key: 'basis', header: 'Delay basis', render: (r) => delayWords(r.delay).basis },
  { key: 'profile', header: 'Profile', render: (r) => (r.profiled ? 'Known' : 'Not known') },
];

function ariaSort(sort: RouteSort | null, key: string): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

export interface RouteTableProps {
  /** One server page, filtered and sorted on the server. */
  readonly data: DepotRoutesResponse;
  readonly query: RoutesQuery;
  readonly onQueryChange: (next: RoutesQuery) => void;
  /** Opens the route's drawer; the button is passed so focus can return to it. */
  readonly onOpenRoute: (route: RouteListItem, opener: HTMLButtonElement) => void;
}

/**
 * One page of the route table. Filters, sort and the page are sent to the
 * server as query parameters (`routeQuery.ts`), so sorting is on every field
 * the server sorts by and never reorders only the visible page.
 */
export function RouteTable({ data, query, onQueryChange, onOpenRoute }: RouteTableProps) {
  const sort = query.sort;
  const current = serverPage(data.total, data.offset, data.limit);
  const filters: RouteFilters = { depotId: query.depotId, serviceClass: query.serviceClass, q: query.q };
  const changeFilters = (next: RouteFilters): void => onQueryChange({ ...query, ...next, offset: 0 });
  const setPage = (page: number): void =>
    onQueryChange({ ...query, offset: offsetOf(page, query.limit) });
  const toggleSort = (key: RouteSortKey): void => {
    const direction = sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onQueryChange({ ...query, sort: { key, direction }, offset: 0 });
  };
  const range = { offset: data.offset, shown: data.routes.length, total: data.total };

  return (
    <>
      <RouteTableControls
        filters={filters}
        depots={data.depotOptions}
        classes={data.classOptions}
        onFiltersChange={changeFilters}
        page={current.page}
        pageCount={current.pageCount}
        onPageChange={setPage}
      />
      <p className="depot-prose mb-2 text-xs" role="status">
        {`${routeRangeSentence(range, data.inFeed)}.`}
      </p>
      <div role="region" aria-label="Route table" tabIndex={0} className="depot-table-frame">
        <table className="depot-table">
          <caption className="sr-only">Every route in the live feed</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  title={c.title}
                  aria-sort={c.key === 'basis' ? undefined : ariaSort(sort, c.key)}
                  className={`${c.frozen ? `${c.frozen} !z-20` : ''} ${c.right ? 'depot-align-right' : ''}`}
                >
                  <span className="inline-flex items-center gap-2">
                    {c.key === 'basis' ? (
                      c.header
                    ) : (
                      <button
                        type="button"
                        className="depot-sort-button"
                        onClick={() => toggleSort(c.key as RouteSortKey)}
                      >
                        {c.header}
                        <span aria-hidden className="inline-block w-3 text-holo-glow">
                          {sort?.key === c.key ? (sort.direction === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    )}
                    {c.provenance ? <ProvenanceBadge provenance={c.provenance} /> : null}
                  </span>
                  {c.title ? <span className="sr-only">{c.title}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.routes.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="depot-prose !py-6">
                  No routes match these filters. Choose All depots or All classes, or clear the name, to widen the list.
                </td>
              </tr>
            ) : null}
            {data.routes.map((row) => (
              <tr key={row.routeName} className="group hover:bg-depot-raised">
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={`${c.frozen ? `${c.frozen} bg-depot-page group-hover:bg-depot-raised` : 'whitespace-nowrap'} ${
                      c.right ? 'depot-align-right' : ''
                    }`}
                  >
                    {c.key === 'route' ? (
                      <button
                        type="button"
                        className="depot-link block max-w-[11rem] truncate text-left"
                        title={row.description ?? row.routeName}
                        onClick={(event) => onOpenRoute(row, event.currentTarget)}
                      >
                        {row.routeName}
                      </button>
                    ) : (
                      c.render(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
