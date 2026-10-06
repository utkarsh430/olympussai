'use client';

import { Checkbox, FilterRow, SearchField, Select } from '@/components/depot/shell/Controls';
import {
  PEER_GROUP_LABEL,
  type LeagueFilters as Filters,
  type PeerGroupFilter,
} from '@/lib/depot/league/leagueModel';
import type { PeerGroupId } from '@/lib/depot/score/types';

export interface LeagueFiltersProps {
  readonly filters: Filters;
  /** Peer groups present in the data, in display order. */
  readonly peerGroups: readonly PeerGroupId[];
  readonly onChange: (next: Filters) => void;
}

function isPeerGroupFilter(
  value: string,
  groups: readonly PeerGroupId[],
): value is PeerGroupFilter {
  return value === 'any' || groups.some((group) => group === value);
}

/** The shared filter row: each label inline at the left of its control. */
export function LeagueFilters({ filters, peerGroups, onChange }: LeagueFiltersProps) {
  return (
    <form role="search" aria-label="Filter the league table" className="mb-3" onSubmit={(event) => event.preventDefault()}>
      <FilterRow label="Filter depots">
        <Select
          label="Peer group"
          value={filters.peerGroup}
          onChange={(event) => {
            const next = event.target.value;
            if (isPeerGroupFilter(next, peerGroups)) onChange({ ...filters, peerGroup: next });
          }}
        >
          <option value="any">All peer groups</option>
          {peerGroups.map((group) => (
            <option key={group} value={group}>
              {PEER_GROUP_LABEL[group]}
            </option>
          ))}
        </Select>
        <SearchField
          label="Depot name"
          value={filters.search}
          placeholder="Search depots"
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
        <Checkbox
          label="Show unranked"
          checked={filters.showUnranked}
          onChange={(event) => onChange({ ...filters, showUnranked: event.target.checked })}
        />
      </FilterRow>
    </form>
  );
}
