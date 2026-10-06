'use client';

import { useEffect, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { staleNoticeTiming } from '@/lib/depot/feedChip';
import { formatFeedTime } from '@/lib/depot/format';
import { Notice } from './Notice';
import { usePageRefresh } from './PageRefreshNotice';

export interface StaleNoticeProps {
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
 * `Notice`. While it waits it takes no room: an empty gap held open would itself move the
 * page each time a response turns stale and fresh again, so the notice costs one move,
 * when it appears. A timer re-renders it when the notice falls due.
 */
export function StaleNotice({ since, fetchedAt }: StaleNoticeProps) {
  const shellFetchedAt = useShellFetchedAt();
  // The shell's page notice already says these figures are the last received.
  const covered = usePageRefresh().failed;
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
  if (covered) return <div role="status" data-testid="depot-stale" data-state="covered" />;
  return (
    <div
      role="status"
      data-testid="depot-stale"
      data-state={timing.show ? 'shown' : 'waiting'}
      className={timing.show ? SLOT : undefined}
    >
      {timing.show ? (
        <Notice status="warning" word="Stale">
          {time === '—' ? 'Showing last good data' : `Showing last good data from ${time}`}
        </Notice>
      ) : null}
    </div>
  );
}
