'use client';

import type { FilterOption } from '@/lib/depot/routes/api';
import type { RoutesQuery } from '@/lib/depot/routes/routeQuery';
import { ListPager } from './ListPager';

export type RouteFilters = Pick<RoutesQuery, 'depotId' | 'serviceClass' | 'q'>;

/** Keeps only the route-name character set the server accepts. */
const searchText = (value: string): string | null =>
  value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || null;

const ANY = 'any';

function Select({
  label,
  anyLabel,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly anyLabel: string;
  readonly value: string | null;
  readonly options: readonly FilterOption[];
  readonly onChange: (value: string | null) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="depot-label">{label}</span>
      <select
        className="depot-field max-w-full"
        value={value ?? ANY}
        onChange={(event) => onChange(event.target.value === ANY ? null : event.target.value)}
      >
        <option value={ANY}>{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface RouteTableControlsProps {
  readonly filters: RouteFilters;
  readonly depots: readonly FilterOption[];
  readonly classes: readonly FilterOption[];
  readonly onFiltersChange: (next: RouteFilters) => void;
  /** Zero-based page and the number of pages. */
  readonly page: number;
  readonly pageCount: number;
  readonly onPageChange: (page: number) => void;
}

/** Depot and class filters on the left, page controls on the right; they wrap when narrow. */
export function RouteTableControls({
  filters,
  depots,
  classes,
  onFiltersChange,
  page,
  pageCount,
  onPageChange,
}: RouteTableControlsProps) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <form
        role="search"
        aria-label="Filter the route table"
        className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <Select
          label="Depot"
          anyLabel="All depots"
          value={filters.depotId}
          options={depots}
          onChange={(depotId) => onFiltersChange({ ...filters, depotId })}
        />
        <Select
          label="Service class"
          anyLabel="All classes"
          value={filters.serviceClass}
          options={classes}
          onChange={(serviceClass) => onFiltersChange({ ...filters, serviceClass })}
        />
        <label className="flex min-w-0 flex-col gap-1">
          <span className="depot-label">Route name contains</span>
          <input
            type="search"
            className="depot-field w-48 max-w-full"
            value={filters.q ?? ''}
            maxLength={64}
            onChange={(event) => onFiltersChange({ ...filters, q: searchText(event.target.value) })}
          />
        </label>
      </form>
      <ListPager label="Route table pages" page={page} pageCount={pageCount} onPageChange={onPageChange} />
    </div>
  );
}
