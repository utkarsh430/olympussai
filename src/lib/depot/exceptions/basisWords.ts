import { formatFeedTime } from '../format';
import type { WindowWordsInput } from '../score/windowWords';
import type { DepotException } from './types';

/**
 * Which moment each exception's figure describes, for the exceptions page (round 2,
 * ruling 4): a peer comparison is over the rolling window, a count is as of the feed time.
 * The window itself is worded by the shared window words only, never here.
 */

function asOf(feedNow: string | null): string {
  return feedNow === null ? 'As of the feed time' : `As of ${formatFeedTime(feedNow)}`;
}

/**
 * The one per-line basis mark left (round 3): the section note already says the window and
 * the feed time, so a line says only what differs, a depot scored on fewer snapshots than
 * the network window ("2 snapshots"). Null otherwise.
 */
export function fewSnapshotsLabel(e: DepotException, window: WindowWordsInput | undefined): string | null {
  if (e.samples === undefined || window === undefined || e.samples >= window.samples) return null;
  return `${e.samples} ${e.samples === 1 ? 'snapshot' : 'snapshots'}`;
}

/** Every bus exception is the bus as of the feed time: said once, beside the list's label. */
export function busBasisNote(feedNow: string | null): string {
  return `${asOf(feedNow)}, worst first`;
}
