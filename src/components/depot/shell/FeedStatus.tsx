'use client';

import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { feedChip, type FeedChipTone } from '@/lib/depot/feedChip';

const TONE: Readonly<Record<FeedChipTone, string>> = {
  live: 'border-alert-green/50 text-alert-green',
  stale: 'border-alert-amber/50 text-alert-amber',
  fixture: 'border-alert-amber/50 text-alert-amber',
  neutral: 'border-depot-line text-depot-muted',
};

/**
 * Top-bar chip for the feed: LIVE or STALE with the feed's own clock, FIXTURE
 * for sample data. How old the data is goes in the tooltip and the
 * screen-reader text; the wording lives in `feedChip`. The age is worked out on
 * each render, which every poll triggers.
 */
export function FeedStatus() {
  const { data, error, loading } = useDepotNetworkContext();
  const chip = feedChip({ data, error, loading, nowMs: Date.now() });

  return (
    <span
      data-testid="depot-feed-status"
      data-source={data?.source ?? 'none'}
      data-tone={chip.tone}
      className={`depot-tag relative ${TONE[chip.tone]}`}
      title={chip.title}
    >
      <span aria-hidden>{chip.text}</span>
      <span className="sr-only">{chip.srText}</span>
    </span>
  );
}
