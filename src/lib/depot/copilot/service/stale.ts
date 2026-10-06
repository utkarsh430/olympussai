import { formatFeedTime } from '@/lib/depot/format';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { CopilotDataSource } from '@/lib/depot/copilot/wire';

/** Placeholder `formatFeedTime` returns for a time it cannot read. */
const NO_TIME = '—';

type SourceView = Pick<FleetSnapshotView, 'source' | 'stale'>;

/**
 * Where the snapshot's figures come from when it is not the live feed: the saved sample
 * (whatever its stale flag) or the last good data. Undefined for the live feed.
 */
export function dataSourceOf(view: Readonly<SourceView>): CopilotDataSource | undefined {
  if (view.source === 'fixture') return 'sample';
  return view.stale ? 'last_good' : undefined;
}

/**
 * The server's own sentence for an answer not built from the live feed, or undefined
 * when it is. The saved sample is called sample data, in the words the pages use for it,
 * never the last good data. It is added to the response outside the cache, so a text
 * cached while the data was fresh never goes out without it. Server text, never model text.
 */
export function staleSentence(view: Readonly<FleetSnapshotView>): string | undefined {
  const source = dataSourceOf(view);
  if (source === undefined) return undefined;
  const time = formatFeedTime(view.feedNow);
  if (source === 'sample') {
    return time === NO_TIME
      ? 'These figures are from sample data, not the live feed; its feed time is not known.'
      : `These figures are from sample data, not the live feed (feed time ${time}).`;
  }
  return time === NO_TIME
    ? 'These figures are from the last good data; its feed time is not known.'
    : `These figures are from the last good data, at the feed time of ${time}.`;
}
