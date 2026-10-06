'use client';

import { useEffect, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { staleNoticeTiming } from '@/lib/depot/feedChip';
import { formatFeedTime } from '@/lib/depot/format';
import { Notice } from './Notice';

export interface StaleStripProps {
  /** The feed time of the last good data (ISO string), or null when unknown. */
  readonly since: string | null;
  /**
   * When the server fetched the data shown (a real instant). Optional: by default it is
   * the shell feed's, which reads the same live snapshot as every depot endpoint.
   */
  readonly fetchedAt?: string | null;
}

/**
 * The shell feed's fetch time, or null outside the shell (a static render or a test with
 * no provider): the age is then unknown and the notice shows, which is the safe side.
 */
function useShellFetchedAt(): string | null {
  try {
    return useDepotNetworkContext().data?.fetchedAt ?? null;
  } catch {
    return null;
  }
}

/** A notice's footprint: one line of 13px text, 8px padding above and below, 24px below. */
const SLOT = 'min-h-[3.75rem]';

/**
 * The stale feed, said once. Pages mount this while their response says stale. For the
 * first `STALE_NOTICE_AFTER_MS` of the data's age the top bar's chip and the provenance
 * line carry it alone and this shows nothing; after that it shows the one shared
 * `Notice`. Its slot keeps the notice's height from the moment it mounts, so nothing
 * below moves when the notice appears. A timer re-renders it when the notice falls due.
 */
export function StaleStrip({ since, fetchedAt }: StaleStripProps) {
  const shellFetchedAt = useShellFetchedAt();
  const [, setTick] = useState(0);
  const timing = staleNoticeTiming(
    fetchedAt === undefined ? shellFetchedAt : fetchedAt,
    Date.now(),
  );

  useEffect(() => {
    if (timing.showInMs === null) return undefined;
    const timer = setTimeout(() => setTick((tick) => tick + 1), timing.showInMs);
    return () => clearTimeout(timer);
  }, [timing.showInMs]);

  const time = formatFeedTime(since);
  return (
    <div
      role="status"
      data-testid="depot-stale"
      data-state={timing.show ? 'shown' : 'reserved'}
      className={SLOT}
    >
      {timing.show ? (
        <Notice status="warning" word="Stale">
          {time === '—' ? 'Showing last good data' : `Showing last good data from ${time}`}
        </Notice>
      ) : null}
    </div>
  );
}
