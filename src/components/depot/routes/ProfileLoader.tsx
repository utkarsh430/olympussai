'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Select } from '@/components/depot/shell/Controls';
import { depotRoutesUrl } from '@/hooks/useDepotRoutes';
import { useFetchedJson } from '@/hooks/useFetchedJson';
import { useRouteProfileLoader, waitFor } from '@/hooks/useRouteProfileLoader';
import type { DepotRoutesResponse } from '@/lib/depot/routes/api';
import {
  loadButtonTitle,
  loaderDepotLabel,
  type LoaderDepot,
} from '@/lib/depot/routes/loaderRow';
import {
  loadButtonLabel,
  progressSentence,
  routesToLoad,
  type LoaderPhase,
} from '@/lib/depot/routes/profileLoader';
import { DEFAULT_ROUTES_QUERY, ROUTE_LIST_MAX_LIMIT } from '@/lib/depot/routes/routeQuery';

export interface ProfileLoaderProps {
  /** In the order to list them, the most useful first press first. */
  readonly depots: readonly LoaderDepot[];
  /** The depot chosen until the person picks one ('' for none). */
  readonly defaultDepotId: string;
  /** The row's sentence while no run has started (why nothing can be planned), if any. */
  readonly lead?: ReactNode;
  /** Runs when a run ends having looked something up: refresh the table and the plan. */
  readonly onFinished: () => void;
  /** The timer, injected for tests. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * The note under the row once the list is read: what is left after a run that stopped
 * short (cancelled, or lookups that failed), or that nothing is left. It never claims a
 * route has details unless its lookup answered.
 */
function remainingLine(depotName: string, left: number, phase: LoaderPhase, looked: boolean): string | null {
  if (left === 0) {
    return looked
      ? `Every listed route of ${depotName} has been looked up.`
      : `Every listed route of ${depotName} already has its details.`;
  }
  if (phase !== 'cancelled' && phase !== 'done') return null;
  const routes = left === 1 ? '1 listed route' : `${left} listed routes`;
  return `${routes} of ${depotName} still to load; press Load to continue.`;
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
 * The user-initiated loader of route details for one depot, as one row: the sentence (or,
 * once pressed, the progress in words), the depot select, the button with its cost in the
 * `title`, and one muted cost line. It never starts by itself, looks routes up one at a
 * time, waits out a 429, can be cancelled, and loads at most 40 a press.
 */
export function ProfileLoader({ depots, defaultDepotId, lead, onFinished, wait = waitFor }: ProfileLoaderProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const depotId = picked ?? defaultDepotId;
  const list = useFetchedJson<DepotRoutesResponse>(depotId ? depotListUrl(depotId) : null);
  // A route is done only once its lookup answered, so a cancelled or failed route is
  // offered again by the next press.
  const markAnswered = useCallback((name: string): void => {
    setDone((prev) => new Set([...prev, name]));
  }, []);
  const loader = useRouteProfileLoader(onFinished, wait, markAnswered);
  const names = useMemo(
    () => routesToLoad((list.data?.routes ?? []).filter((r) => !done.has(r.routeName))),
    [list.data, done],
  );
  const depotName = depots.find((d) => d.value === depotId)?.label ?? '';
  const progress = progressSentence(loader.progress);
  const listed = list.data?.routes ?? [];
  const listLine =
    depotId && list.loading
      ? `Reading ${depotName}'s routes…`
      : depotId && list.error
        ? `${depotName}'s routes could not be read.`
        : depotId && list.data && !loader.running
          ? remainingLine(
              depotName,
              names.length,
              loader.progress.phase,
              listed.some((r) => done.has(r.routeName)),
            )
          : null;

  function start(): void {
    loader.start(names);
  }

  return (
    <div data-testid="route-profile-loader" className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-6 gap-y-2 py-2">
      {/* The progress takes the sentence's place once a run starts; one status line. */}
      <p role="status" data-testid="route-profile-loader-status" className="depot-prose min-w-0">
        {progress || lead || null}
      </p>
      <Select
        label="Depot"
        value={depotId}
        disabled={loader.running}
        onChange={(e) => setPicked(e.target.value)}
      >
        {depotId ? null : <option value="">Choose a depot</option>}
        {depots.map((d) => (
          <option key={d.value} value={d.value}>
            {loaderDepotLabel(d)}
          </option>
        ))}
      </Select>
      {depotId && list.data && names.length > 0 && !loader.running ? (
        <button
          type="button"
          className="depot-filter-button"
          title={loadButtonTitle(depotName, names.length)}
          onClick={start}
        >
          {loadButtonLabel(names.length)}
        </button>
      ) : null}
      {loader.running ? (
        <button type="button" className="depot-filter-button" onClick={loader.cancel}>
          Cancel
        </button>
      ) : null}
      {listLine !== null ? <p className="depot-note min-w-0">{listLine}</p> : null}
    </div>
  );
}
