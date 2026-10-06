import { formatFeedTime } from '@/lib/depot/format';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

/** Placeholder `formatFeedTime` returns for a time it cannot read. */
const NO_TIME = '—';

/**
 * The server's own sentence for an answer built from a stale snapshot, or
 * undefined when the data is current. It is added to the response outside
 * the cache, so a text cached while the data was fresh never goes out
 * without it once the data is stale. Server text, never model text.
 */
export function staleSentence(view: Readonly<FleetSnapshotView>): string | undefined {
  if (!view.stale) return undefined;
  const time = formatFeedTime(view.feedNow);
  return time === NO_TIME
    ? 'These figures are from the last good data; its feed time is not known.'
    : `These figures are from the last good data, at the feed time of ${time}.`;
}
