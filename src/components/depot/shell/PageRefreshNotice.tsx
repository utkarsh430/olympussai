'use client';

import { useSyncExternalStore } from 'react';
import { formatFeedTime } from '@/lib/depot/format';
import {
  pageRefreshState,
  refreshFailuresSnapshot,
  serverRefreshFailuresSnapshot,
  subscribeRefreshFailures,
  type PageRefreshState,
} from '@/lib/depot/pageRefresh';
import { Notice } from './Notice';

/** Whether any of the open page's own data requests is failing, read from the shared store. */
export function usePageRefresh(): PageRefreshState {
  const failures = useSyncExternalStore(
    subscribeRefreshFailures,
    refreshFailuresSnapshot,
    serverRefreshFailuresSnapshot,
  );
  return pageRefreshState(failures);
}

/** Fixed words: what could not be refreshed and what the figures on screen are. */
export function pageRefreshSentence(since: string | null): string {
  const time = formatFeedTime(since);
  const lead = "This page's figures could not be refreshed.";
  return time === '—'
    ? `${lead} The figures on screen are the last ones received.`
    : `${lead} The figures on screen are the last ones received, feed time ${time}.`;
}

/**
 * The notice the shell shows as soon as a page's own data request fails after a success,
 * above the page. It never waits on the network feed's timing and never carries the
 * server's text; it clears when the request succeeds again. The page's own timed stale
 * notice stands down while this shows, so the page still has one notice.
 */
export function PageRefreshNotice() {
  const page = usePageRefresh();
  return (
    <div role="status" data-testid="depot-page-refresh" data-state={page.failed ? 'shown' : 'clear'}>
      {page.failed ? (
        <Notice status="warning" word="Not refreshed">
          {pageRefreshSentence(page.since)}
        </Notice>
      ) : null}
    </div>
  );
}
