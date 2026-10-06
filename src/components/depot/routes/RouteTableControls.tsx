'use client';

import type { FilterOption, RouteFilters } from '@/lib/depot/routes/routesPageModel';

const ANY = 'any';
const PAGE_BUTTON =
  'depot-field px-3 text-xs hover:bg-depot-raised disabled:cursor-not-allowed disabled:opacity-50';

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
      </form>
      <nav aria-label="Route table pages" className="flex items-center gap-2">
        <button
          type="button"
          className={PAGE_BUTTON}
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span className="font-mono text-xs tabular-nums text-depot-muted">
          Page {page + 1} of {pageCount}
        </span>
        <button
          type="button"
          className={PAGE_BUTTON}
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </nav>
    </div>
  );
}
