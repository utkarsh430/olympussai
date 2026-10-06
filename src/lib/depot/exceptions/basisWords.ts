import { formatFeedTime } from '../format';
import { scoreWindowShort, type WindowWordsInput } from '../score/windowWords';
import { EXCEPTION_BASIS } from './config';
import type { DepotException } from './types';

/**
 * Which moment each exception's figure describes, for the exceptions page (round 2,
 * ruling 4): a peer comparison is over the rolling window, a count is as of the feed time.
 * The window itself is worded by the shared window words only, never here.
 */

function asOf(feedNow: string | null): string {
  return feedNow === null ? 'As of the feed time' : `As of ${formatFeedTime(feedNow)}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "Last 20 min", "Last 20 min · 2 snapshots" (a depot scored on fewer snapshots than the
 * network window), or "As of 14:20". An older response with no `basis` falls back to the
 * kind's basis.
 */
export function depotBasisLabel(
  e: DepotException,
  window: WindowWordsInput | undefined,
  feedNow: string | null,
): string {
  const basis = e.basis ?? EXCEPTION_BASIS[e.kind];
  if (basis === 'feed_time') return asOf(feedNow);
  const span = capitalise(scoreWindowShort(window, feedNow));
  const few = e.samples !== undefined && window !== undefined && e.samples < window.samples;
  if (!few) return span;
  return `${span} · ${e.samples} ${e.samples === 1 ? 'snapshot' : 'snapshots'}`;
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
