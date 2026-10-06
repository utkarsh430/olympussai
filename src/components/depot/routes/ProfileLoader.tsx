'use client';

import { useMemo, useState } from 'react';
import { Select } from '@/components/depot/shell/Controls';
import { depotRoutesUrl } from '@/hooks/useDepotRoutes';
import { useFetchedJson } from '@/hooks/useFetchedJson';
import { useRouteProfileLoader, waitFor } from '@/hooks/useRouteProfileLoader';
import type { DepotRoutesResponse, FilterOption } from '@/lib/depot/routes/api';
import {
  loadButtonLabel,
  progressSentence,
  routesToLoad,
  UPSTREAM_COST,
} from '@/lib/depot/routes/profileLoader';
import { DEFAULT_ROUTES_QUERY, ROUTE_LIST_MAX_LIMIT } from '@/lib/depot/routes/routeQuery';

export interface ProfileLoaderProps {
  readonly depots: readonly FilterOption[];
  /** Runs when a run ends having looked something up: refresh the table and the plan. */
  readonly onFinished: () => void;
  /** The timer, injected for tests. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** One depot's routes, those without a profile first (the server sorts on the profile). */
function depotListUrl(depotId: string): string {
  return depotRoutesUrl({
    ...DEFAULT_ROUTES_QUERY,
    depotId,
    sort: { key: 'profile', direction: 'asc' },
    limit: ROUTE_LIST_MAX_LIMIT,
  });
}

/**
 * The user-initiated loader of route details for one depot: never starts by itself,
 * looks routes up one at a time, pauses on a 429, can be cancelled, says its progress.
 */
export function ProfileLoader({ depots, onFinished, wait = waitFor }: ProfileLoaderProps) {
  const [depotId, setDepotId] = useState<string>('');
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const list = useFetchedJson<DepotRoutesResponse>(depotId ? depotListUrl(depotId) : null);
  const loader = useRouteProfileLoader(onFinished, wait);
  const names = useMemo(
    () => routesToLoad((list.data?.routes ?? []).filter((r) => !done.has(r.routeName))),
    [list.data, done],
  );
  const depotName = depots.find((d) => d.value === depotId)?.label ?? '';
  const sentence = progressSentence(loader.progress);

  function start(): void {
    setDone((prev) => new Set([...prev, ...names]));
    loader.start(names);
  }

  return (
    <div data-testid="route-profile-loader" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <Select
          label="Depot"
          value={depotId}
          disabled={loader.running}
          onChange={(e) => setDepotId(e.target.value)}
        >
          <option value="">Choose a depot</option>
          {depots.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
        {depotId && list.data && names.length > 0 && !loader.running ? (
          <button type="button" className="depot-filter-button" onClick={start}>
            {loadButtonLabel(depotName, names.length)}
          </button>
        ) : null}
        {loader.running ? (
          <button type="button" className="depot-filter-button" onClick={loader.cancel}>
            Cancel
          </button>
        ) : null}
        <p className="min-w-0 text-[13px] text-depot-muted">{UPSTREAM_COST}</p>
      </div>
      {depotId && list.loading ? (
        <p className="text-[13px] text-depot-muted">Reading {depotName}&apos;s routes…</p>
      ) : null}
      {depotId && list.error ? (
        <p className="text-[13px] text-alert-amber">{depotName}&apos;s routes could not be read.</p>
      ) : null}
      {depotId && list.data && names.length === 0 && !loader.running ? (
        <p className="text-[13px] text-depot-muted">
          Every listed route of {depotName} already has its details.
        </p>
      ) : null}
      <p role="status" data-testid="route-profile-loader-status" className="text-[13px] text-depot-ink">
        {sentence}
      </p>
    </div>
  );
}
