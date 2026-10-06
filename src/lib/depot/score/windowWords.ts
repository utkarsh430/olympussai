import { formatFeedTime } from '@/lib/depot/format';
import type { ScoreWindow } from '@/lib/depot/score/types';
import { MS_PER_MINUTE } from '@/lib/depot/units';

/*
 * How every page says which window the efficiency index (and the depot exceptions that
 * compare a depot with its peers) was summed over. One module, so the overview, league,
 * cockpit and exceptions page never word the same window differently. Pure.
 */

/**
 * The response's window. `coveredMin` (minutes the summed samples actually span) is
 * optional: when the server sends it, "over the last N minutes" uses it, so a window
 * that holds one sample never claims twenty minutes.
 */
export interface WindowWordsInput extends ScoreWindow {
  readonly coveredMin?: number;
}

/** A window this close to its configured length is called full (one poll of slack). */
const FULL_SLACK_MIN = 1;

type WindowKind =
  | { readonly kind: 'single'; readonly at: string | null }
  | { readonly kind: 'span'; readonly minutes: number }
  | { readonly kind: 'filling'; readonly since: string; readonly samples: number };

function classify(window: WindowWordsInput | undefined, feedNow: string | null): WindowKind {
  if (!window || window.samples <= 1 || window.since === null) {
    return { kind: 'single', at: window?.since ?? feedNow };
  }
  if (window.coveredMin !== undefined && Number.isFinite(window.coveredMin)) {
    const covered = Math.round(window.coveredMin);
    const minutes = covered >= window.lengthMin - FULL_SLACK_MIN ? window.lengthMin : covered;
    if (minutes >= 1) return { kind: 'span', minutes };
  }
  const now = feedNow === null ? Number.NaN : Date.parse(feedNow);
  const spanMin = (now - Date.parse(window.since)) / MS_PER_MINUTE;
  if (Number.isFinite(spanMin) && spanMin >= window.lengthMin - FULL_SLACK_MIN) {
    return { kind: 'span', minutes: window.lengthMin };
  }
  return { kind: 'filling', since: window.since, samples: window.samples };
}

function snapshotAt(at: string | null): string {
  return at === null ? 'one snapshot' : `one snapshot at ${formatFeedTime(at)}`;
}

/** "over the last 20 minutes", "since 14:02, 3 snapshots" or "from one snapshot at 14:20". */
export function scoreWindowPhrase(
  window: WindowWordsInput | undefined,
  feedNow: string | null,
): string {
  const w = classify(window, feedNow);
  if (w.kind === 'single') return `from ${snapshotAt(w.at)}`;
  if (w.kind === 'span') return `over the last ${w.minutes} minutes`;
  return `since ${formatFeedTime(w.since)}, ${w.samples} snapshots`;
}

/** The full sentence, said once per page: "Efficiency index over the last 20 minutes." */
export function scoreWindowSentence(
  window: WindowWordsInput | undefined,
  feedNow: string | null,
): string {
  return `Efficiency index ${scoreWindowPhrase(window, feedNow)}.`;
}

/** For a column header: "last 20 min", "since 14:02" or "one snapshot at 14:20". */
export function scoreWindowShort(
  window: WindowWordsInput | undefined,
  feedNow: string | null,
): string {
  const w = classify(window, feedNow);
  if (w.kind === 'single') return snapshotAt(w.at);
  if (w.kind === 'span') return `last ${w.minutes} min`;
  return `since ${formatFeedTime(w.since)}`;
}

/** Beside exception totals: the peer comparisons are windowed, the bus counts are not. */
export function exceptionWindowNote(
  window: WindowWordsInput | undefined,
  feedNow: string | null,
): string {
  const asOf = feedNow === null ? 'the feed time' : formatFeedTime(feedNow);
  return `Depot exceptions compare rates ${scoreWindowPhrase(window, feedNow)}; bus counts are as of ${asOf}.`;
}

/** Above the exceptions page's depot list: which figure is windowed, which is as of now. */
export function depotWindowNote(
  window: WindowWordsInput | undefined,
  feedNow: string | null,
): string {
  const asOf = feedNow === null ? 'the feed time' : formatFeedTime(feedNow);
  return `Rates are compared with peers ${scoreWindowPhrase(window, feedNow)}; bus counts are as of ${asOf}.`;
}
