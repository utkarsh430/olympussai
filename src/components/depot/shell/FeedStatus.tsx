'use client';

import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { feedChip, type FeedChipTone } from '@/lib/depot/feedChip';
import { usePageRefresh } from './PageRefreshNotice';

const TONE: Readonly<Record<FeedChipTone, string>> = {
  live: 'border-alert-green/45 bg-alert-green/10 text-alert-green',
  stale: 'border-alert-amber/50 bg-alert-amber/10 text-alert-amber',
  fixture: 'border-holo-glow/40 bg-holo-glow/10 text-holo-glow',
  neutral: 'border-depot-line text-depot-muted',
};

/**
 * Top-bar chip for the feed: LIVE or STALE with the feed's own clock, FIXTURE
 * for sample data, CHECK CLOCK when enough reports are stamped ahead of the
 * server's clock that the feed clock may lag (read from the network response's
 * `feedClockAheadRows` and `recordCount`, which `data` already carries), and STALE at
 * the page's own time when the open page's own request is failing (`usePageRefresh`). How old the data is goes in the tooltip and the
 * screen-reader text; the wording lives in `feedChip`. The age is worked out on
 * each render, which every poll triggers.
 */
export function FeedStatus() {
  const { data, error, loading } = useDepotNetworkContext();
  const page = usePageRefresh();
  const chip = feedChip({ data, error, loading, nowMs: Date.now(), page });

  return (
    <span
      data-testid="depot-feed-status"
      data-source={data?.source ?? 'none'}
      data-tone={chip.tone}
      className={`depot-tag relative shrink-0 ${TONE[chip.tone]}`}
      title={chip.title}
    >
      <span aria-hidden>{chip.text}</span>
      <span className="sr-only">{chip.srText}</span>
    </span>
  );
}
