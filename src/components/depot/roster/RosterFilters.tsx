'use client';

import { BUS_LOCATION_LABEL, BUS_STATE_LABEL } from '@/lib/depot/labels';
import type { BusLocation } from '@/lib/depot/infer/types';
import type { BusOpState } from '@/lib/depot/types';
import { BUS_STATE_ORDER, type RosterFilters as Filters } from '@/lib/depot/roster/rosterModel';

export interface RosterFiltersProps {
  readonly filters: Filters;
  /** Per-state counts on the unfiltered roster. */
  readonly counts: Readonly<Record<BusOpState, number>>;
  readonly onChange: (next: Filters) => void;
}

const LOCATIONS: readonly BusLocation[] = ['in_yard', 'at_other_yard', 'away', 'unknown'];

function isLocation(value: string): value is BusLocation | 'any' {
  return value === 'any' || LOCATIONS.some((location) => location === value);
}

/** Labelled controls: state checkboxes with counts, location, has-route, search. */
export function RosterFilters({ filters, counts, onChange }: RosterFiltersProps) {
  const toggleState = (state: BusOpState, on: boolean): void => {
    const states = on
      ? BUS_STATE_ORDER.filter((s) => s === state || filters.states.includes(s))
      : filters.states.filter((s) => s !== state);
    onChange({ ...filters, states });
  };

  return (
    <form
      role="search"
      aria-label="Filter the roster"
      className="mb-3 flex flex-col gap-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <fieldset className="min-w-0">
        <legend className="depot-label mb-1">State</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {BUS_STATE_ORDER.map((state) => (
            <label key={state} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.states.includes(state)}
                onChange={(event) => toggleState(state, event.target.checked)}
              />
              <span className="font-mono text-xs text-depot-muted">
                {BUS_STATE_LABEL[state]} <span className="tabular-nums">({counts[state]})</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="depot-label">Location</span>
          <select
            className="depot-field"
            value={filters.location}
            onChange={(event) => {
              const next = event.target.value;
              if (isLocation(next)) onChange({ ...filters, location: next });
            }}
          >
            <option value="any">Anywhere</option>
            {LOCATIONS.map((location) => (
              <option key={location} value={location}>
                {BUS_LOCATION_LABEL[location]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="depot-label">Registration or route</span>
          <input
            type="search"
            className="depot-field w-56 max-w-full"
            value={filters.search}
            placeholder="Search buses"
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={filters.hasRouteOnly}
            onChange={(event) => onChange({ ...filters, hasRouteOnly: event.target.checked })}
          />
          <span className="font-mono text-xs text-depot-muted">Has a route</span>
        </label>
      </div>
    </form>
  );
}
