'use client';

import { useMemo, useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { RouteListItem } from '@/lib/depot/routes/api';
import { deadKmWords, delayWords, operatorsView } from '@/lib/depot/routes/routeRowWording';
import { LATE_AFTER_MIN } from '@/lib/depot/routes/routeTable';
import {
  NO_ROUTE_FILTERS,
  classOptions,
  depotOptions,
  filterRoutes,
  pageOf,
  routeRangeSentence,
  sortRoutes,
  type RouteFilters,
  type RouteSort,
  type RouteSortKey,
} from '@/lib/depot/routes/routesPageModel';
import { formatCount } from '@/lib/depot/format';
import type { Provenance } from '@/lib/depot/types';
import { FigureWithNote, OperatorsCell } from './RouteCells';
import { RouteTableControls } from './RouteTableControls';

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
    render: (r) => (
      <span className="block max-w-[11rem] truncate" title={r.description ?? r.routeName}>
        {r.routeName}
      </span>
    ),
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
    render: (r) => formatCount(r.tripsPerDay.value),
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
  /** Every route in the feed, in the server's order (most buses first). */
  readonly routes: readonly RouteListItem[];
}

/** Every route, filtered and sorted as a whole, then shown one page at a time. */
export function RouteTable({ routes }: RouteTableProps) {
  const [filters, setFilters] = useState<RouteFilters>(NO_ROUTE_FILTERS);
  const [sort, setSort] = useState<RouteSort | null>(null);
  const [page, setPage] = useState(0);

  const depots = useMemo(() => depotOptions(routes), [routes]);
  const classes = useMemo(() => classOptions(routes), [routes]);
  const ordered = useMemo(
    () => sortRoutes(filterRoutes(routes, filters), sort),
    [routes, filters, sort],
  );
  // pageOf clamps, so a poll or filter that shrinks the list lands on its last page.
  const current = pageOf(ordered, page);

  const changeFilters = (next: RouteFilters): void => {
    setFilters(next);
    setPage(0);
  };
  const toggleSort = (key: RouteSortKey): void => {
    setSort((s) => ({ key, direction: s?.key === key && s.direction === 'asc' ? 'desc' : 'asc' }));
    setPage(0);
  };

  return (
    <>
      <RouteTableControls
        filters={filters}
        depots={depots}
        classes={classes}
        onFiltersChange={changeFilters}
        page={current.page}
        pageCount={current.pageCount}
        onPageChange={setPage}
      />
      <p className="depot-prose mb-2 text-xs" role="status">
        {`${routeRangeSentence({ ...current, shown: current.items.length }, routes.length)}.`}
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
            {current.items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="depot-prose !py-6">
                  No routes match these filters. Choose All depots or All classes to widen the list.
                </td>
              </tr>
            ) : null}
            {current.items.map((row) => (
              <tr key={row.routeName} className="group hover:bg-depot-raised">
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={`${c.frozen ? `${c.frozen} bg-depot-page group-hover:bg-depot-raised` : 'whitespace-nowrap'} ${
                      c.right ? 'depot-align-right' : ''
                    }`}
                  >
                    {c.render(row)}
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
