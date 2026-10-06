'use client';

import { FilterRow, SearchField, Select } from '@/components/depot/shell/Controls';
import type { FilterOption } from '@/lib/depot/routes/api';
import type { RoutesQuery } from '@/lib/depot/routes/routeQuery';

export type RouteFilters = Pick<RoutesQuery, 'depotId' | 'serviceClass' | 'q'>;

/** Keeps only the route-name character set the server accepts. */
const searchText = (value: string): string | null =>
  value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || null;

const ANY = 'any';
const chosen = (value: string): string | null => (value === ANY ? null : value);

export interface RouteTableControlsProps {
  readonly filters: RouteFilters;
  readonly depots: readonly FilterOption[];
  readonly classes: readonly FilterOption[];
  readonly onFiltersChange: (next: RouteFilters) => void;
}

/** The depot, class and name filters on the shared filter row; the pager sits under the table. */
export function RouteTableControls({ filters, depots, classes, onFiltersChange }: RouteTableControlsProps) {
  return (
    <div className="mb-3">
      <FilterRow label="Filter the route table">
        <Select
          label="Depot"
          value={filters.depotId ?? ANY}
          onChange={(e) => onFiltersChange({ ...filters, depotId: chosen(e.target.value) })}
        >
          <option value={ANY}>All depots</option>
          {depots.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          label="Class"
          value={filters.serviceClass ?? ANY}
          onChange={(e) => onFiltersChange({ ...filters, serviceClass: chosen(e.target.value) })}
        >
          <option value={ANY}>All classes</option>
          {classes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <SearchField
          label="Route name contains"
          value={filters.q ?? ''}
          maxLength={64}
          onChange={(e) => onFiltersChange({ ...filters, q: searchText(e.target.value) })}
        />
      </FilterRow>
    </div>
  );
}
