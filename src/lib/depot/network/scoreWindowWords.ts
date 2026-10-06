import { formatFeedTime } from '@/lib/depot/format';
import type { ScoreWindow } from '@/lib/depot/score/types';

/*
 * How the network pages say which window the efficiency index (and the depot
 * exceptions that compare a depot with its peers) was summed over. The index is
 * no longer one snapshot: it moves less, but a reader must still see what it
 * covers, once per page, near the first place it appears.
 */

const MS_PER_MIN = 60_000;
/** A window this close to its configured length is called full (one poll of slack). */
const FULL_SLACK_MIN = 1;

type WindowKind =
  | { readonly kind: 'single' }
  | { readonly kind: 'full'; readonly lengthMin: number }
  | { readonly kind: 'filling'; readonly since: string; readonly samples: number };

function classify(window: ScoreWindow | undefined, feedNow: string | null): WindowKind {
  if (!window || window.samples <= 1 || window.since === null) return { kind: 'single' };
  const since = Date.parse(window.since);
  const now = feedNow === null ? Number.NaN : Date.parse(feedNow);
  const spanMin = (now - since) / MS_PER_MIN;
  if (Number.isFinite(spanMin) && spanMin >= window.lengthMin - FULL_SLACK_MIN) {
    return { kind: 'full', lengthMin: window.lengthMin };
  }
  return { kind: 'filling', since: window.since, samples: window.samples };
}

/** "over the last 20 minutes", "since 14:02, 3 snapshots" or "from the latest snapshot only". */
export function scoreWindowPhrase(window: ScoreWindow | undefined, feedNow: string | null): string {
  const w = classify(window, feedNow);
  if (w.kind === 'single') return 'from the latest snapshot only';
  if (w.kind === 'full') return `over the last ${w.lengthMin} minutes`;
  return `since ${formatFeedTime(w.since)}, ${w.samples} snapshots`;
}

/** The full sentence, said once per page: "Efficiency index over the last 20 minutes." */
export function scoreWindowSentence(window: ScoreWindow | undefined, feedNow: string | null): string {
  return `Efficiency index ${scoreWindowPhrase(window, feedNow)}.`;
}

/** For a column header: "last 20 min", "since 14:02" or "latest snapshot". */
export function scoreWindowShort(window: ScoreWindow | undefined, feedNow: string | null): string {
  const w = classify(window, feedNow);
  if (w.kind === 'single') return 'latest snapshot';
  if (w.kind === 'full') return `last ${w.lengthMin} min`;
  return `since ${formatFeedTime(w.since)}`;
}

/** Beside exception totals: the peer comparisons are windowed, the bus counts are not. */
export function exceptionWindowNote(window: ScoreWindow | undefined, feedNow: string | null): string {
  return `Depot exceptions compare rates ${scoreWindowPhrase(window, feedNow)}; bus counts are as of ${formatFeedTime(feedNow)}.`;
}
