'use client';

import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { formatFeedTime } from '@/lib/depot/format';
import type { UpstreamSource } from '@/models/canonical';

const SOURCE_LABEL: Readonly<Record<UpstreamSource, string>> = {
  live: 'LIVE',
  cache: 'CACHE',
  fixture: 'FIXTURE',
};

const SOURCE_TONE: Readonly<Record<UpstreamSource, string>> = {
  live: 'border-alert-green/50 text-alert-green',
  cache: 'border-alert-amber/50 text-alert-amber',
  fixture: 'border-alert-amber/50 text-alert-amber',
};

const NEUTRAL_TONE = 'border-depot-line text-depot-muted';

/**
 * Top-bar chip for the feed: LIVE / CACHE / FIXTURE, "stale" when the server
 * says so or the last poll failed, and the feed's own clock as HH:MM. Says
 * "Feed connecting" before the first response and "Feed unavailable" if there
 * is still nothing to show.
 */
export function FeedStatus() {
  const { data, error, loading } = useDepotNetworkContext();

  let tone = NEUTRAL_TONE;
  let text = 'Feed connecting';
  if (data) {
    const stale = data.stale || error !== null;
    tone = SOURCE_TONE[data.source];
    text = [SOURCE_LABEL[data.source], stale ? 'stale' : null, formatFeedTime(data.feedNow)]
      .filter((part): part is string => part !== null)
      .join(' · ');
  } else if (!loading && error) {
    text = 'Feed unavailable';
  }

  return (
    <span
      data-testid="depot-feed-status"
      data-source={data?.source ?? 'none'}
      className={`depot-tag ${tone}`}
      title={error ?? undefined}
    >
      {text}
    </span>
  );
}
