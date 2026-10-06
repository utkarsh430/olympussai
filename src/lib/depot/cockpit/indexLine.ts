import { formatCount, formatFeedTime } from '@/lib/depot/format';
import type { ScoreWindow } from '@/lib/depot/score/types';
import type { CockpitHeader } from './cockpitTypes';

/** The efficiency index as one mono line that says the window it covers. */

const MINUTE_MS = 60_000;

/**
 * "over the last 20 minutes" when the window is full; "since 14:02, 3 snapshots"
 * while it fills; "from the latest snapshot only" for a window of one; null when
 * the response carries no window (an older fixture).
 */
export function scoreWindowText(
  window: ScoreWindow | null | undefined,
  feedNow: string | null,
): string | null {
  if (!window) return null;
  if (window.samples <= 1) return 'from the latest snapshot only';
  const spanMs =
    window.since === null || feedNow === null ? NaN : Date.parse(feedNow) - Date.parse(window.since);
  if (Number.isFinite(spanMs) && spanMs >= (window.lengthMin - 1) * MINUTE_MS) {
    return `over the last ${formatCount(window.lengthMin)} minutes`;
  }
  return `since ${formatFeedTime(window.since)}, ${formatCount(window.samples)} snapshots`;
}

export function indexLine(
  header: CockpitHeader,
  window: ScoreWindow | null | undefined,
  feedNow: string | null,
): string {
  if (!header.ranked || header.index === null) {
    return `Efficiency index: not ranked. ${header.unrankedReason ?? ''}`.trim();
  }
  const parts = [`Efficiency index ${header.index.toFixed(1)}`];
  if (header.rank !== null && header.peerCount !== null) {
    const group = header.peerGroupLabel ? ` in ${header.peerGroupLabel}` : '';
    parts.push(`rank ${header.rank} of ${header.peerCount}${group}`);
  }
  const span = scoreWindowText(window, feedNow);
  if (span !== null) parts.push(span);
  return parts.join(' · ');
}
