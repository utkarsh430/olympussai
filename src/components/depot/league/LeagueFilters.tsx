'use client';

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

function isPeerGroupFilter(value: string, groups: readonly PeerGroupId[]): value is PeerGroupFilter {
  return value === 'any' || groups.some((group) => group === value);
}

/** Real form controls, each with a visible label. */
export function LeagueFilters({ filters, peerGroups, onChange }: LeagueFiltersProps) {
  return (
    <form
      role="search"
      aria-label="Filter the league table"
      className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="flex flex-col gap-1">
        <span className="depot-label">Peer group</span>
        <select
          className="depot-field"
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
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="depot-label">Depot name</span>
        <input
          type="search"
          className="depot-field w-56 max-w-full"
          value={filters.search}
          placeholder="Search depots"
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
      </label>
      <label className="flex items-center gap-2 pb-1.5">
        <input
          type="checkbox"
          checked={filters.showUnranked}
          onChange={(event) => onChange({ ...filters, showUnranked: event.target.checked })}
        />
        <span className="font-mono text-xs text-depot-muted">Show unranked</span>
      </label>
    </form>
  );
}
