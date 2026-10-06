'use client';

import { BUS_STATE_SQUARE } from '@/components/depot/shell/BusStateMark';
import { Checkbox, Select } from '@/components/depot/shell/Controls';
import { formatCount } from '@/lib/depot/format';
import { BUS_LOCATION_LABEL, BUS_STATE_LABEL } from '@/lib/depot/labels';
import {
  BUS_STATE_ORDER,
  ROSTER_FLAG_LABEL,
  ROSTER_STATE_WORD,
  type RosterFilters as Filters,
} from '@/lib/depot/roster/rosterModel';
import { MAX_SEARCH_LENGTH, ROSTER_LOCATIONS } from '@/lib/depot/roster/rosterQuery';
import type { BusLocation } from '@/lib/depot/infer/types';
import type { BusOpState } from '@/lib/depot/types';

export interface RosterFiltersProps {
  readonly filters: Filters;
  readonly counts: Readonly<Record<BusOpState, number>>;
  readonly onChange: (next: Filters) => void;
}

function isLocation(value: string): value is BusLocation {
  return (ROSTER_LOCATIONS as readonly string[]).includes(value);
}

/**
 * One row: state toggles with counts, location, search, "Has a route", and nothing
 * else: the count is the section label's and the pager's. A flag set by a link (main power off, not heard, tamper)
 * shows as one more pressed toggle that clears it.
 */
export function RosterFilters({ filters, counts, onChange }: RosterFiltersProps) {
  const toggleState = (state: BusOpState): void => {
    const on = !filters.states.includes(state);
    const states = on
      ? BUS_STATE_ORDER.filter((s) => s === state || filters.states.includes(s))
      : filters.states.filter((s) => s !== state);
    onChange({ ...filters, states });
  };

  return (
    <form
      role="search"
      aria-label="Filter the roster"
      className="mb-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
      onSubmit={(event) => event.preventDefault()}
    >
      <div role="group" aria-label="State" className="flex min-w-0 flex-wrap gap-1">
        {BUS_STATE_ORDER.map((state) => (
          <button
            key={state}
            type="button"
            aria-pressed={filters.states.includes(state)}
            title={BUS_STATE_LABEL[state]}
            onClick={() => toggleState(state)}
            className="depot-filter-button inline-flex items-center gap-1.5"
          >
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 ${BUS_STATE_SQUARE[state]}`} />
            {ROSTER_STATE_WORD[state]} <span className="tabular-nums">{formatCount(counts[state])}</span>
          </button>
        ))}
        {filters.flag !== 'any' ? (
          <button
            type="button"
            aria-pressed="true"
            title="Clear this filter"
            onClick={() => onChange({ ...filters, flag: 'any' })}
            className="depot-filter-button"
          >
            {`${ROSTER_FLAG_LABEL[filters.flag]} ×`}
          </button>
        ) : null}
      </div>
      <Select
        label="Location"
        hideLabel
        value={filters.location}
        onChange={(event) => {
          const value = event.target.value;
          onChange({ ...filters, location: isLocation(value) ? value : 'any' });
        }}
      >
        <option value="any">Any location</option>
        {ROSTER_LOCATIONS.map((location) => (
          <option key={location} value={location}>
            {BUS_LOCATION_LABEL[location]}
          </option>
        ))}
      </Select>
      <label className="min-w-0">
        <span className="sr-only">Search registration or route</span>
        <input
          type="search"
          className="depot-field w-48 max-w-full"
          placeholder="Registration or route"
          maxLength={MAX_SEARCH_LENGTH}
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
      </label>
      <Checkbox
        label="Has a route"
        checked={filters.hasRouteOnly}
        onChange={(event) => onChange({ ...filters, hasRouteOnly: event.target.checked })}
      />
    </form>
  );
}
