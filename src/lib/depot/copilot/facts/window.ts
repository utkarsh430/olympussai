import { formatFeedTime } from '@/lib/depot/format';
import { makeFact, ph } from '@/lib/depot/copilot/facts/format';
import type { CopilotFact } from '@/lib/depot/copilot/types';
import type { ScoreWindow } from '@/lib/depot/score/types';

/**
 * Review I7. An efficiency index (and the rank built on it) is summed over a
 * rolling window, not read off one snapshot, so the copilot states the window
 * wherever it states an index or rank. `coveredMin`, the minutes the samples
 * really span, is being added to the response by another unit: optional here,
 * and preferred over the bare sample count when present.
 */
export type IndexWindow = ScoreWindow & { readonly coveredMin?: number };

const NO_TIME = '—';

/** "7 snapshots from 07:42", "the 18 minutes from 07:42 (7 snapshots)", "one snapshot, at 07:42". */
export function indexWindowText(window: IndexWindow | undefined): string | null {
  if (!window) return null;
  const time = window.since === null ? NO_TIME : formatFeedTime(window.since);
  const from = time === NO_TIME ? '' : ` from ${time}`;
  if (window.samples <= 1) return time === NO_TIME ? 'one snapshot' : `one snapshot, at ${time}`;
  const snapshots = `${window.samples} snapshots`;
  if (window.coveredMin !== undefined && window.coveredMin > 0) {
    return `the ${Math.round(window.coveredMin)} minutes${from} (${snapshots})`;
  }
  return `${snapshots}${from}`;
}

/** The window as a fact, or nothing when the response carries none. */
export function indexWindowFacts(id: string, window: IndexWindow | undefined): CopilotFact[] {
  const text = indexWindowText(window);
  return text === null ? [] : [makeFact(id, 'Index window', text, 'derived')];
}

/**
 * The sentence stating the window, placed after the one that states the index:
 * " The rank and index cover {{fact:…}}." Empty when the response carries none.
 */
export function indexWindowSentence(
  window: IndexWindow | undefined,
  id: string,
  subject: string,
): string {
  return indexWindowText(window) === null ? '' : ` ${subject} ${ph(id)}.`;
}
