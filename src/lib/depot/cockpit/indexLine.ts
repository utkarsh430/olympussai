import { scoreWindowPhrase } from '@/lib/depot/score/windowWords';
import type { ScoreWindow } from '@/lib/depot/score/types';
import type { CockpitHeader } from './cockpitTypes';

/** The efficiency index as one mono line that says the window it covers. */

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
  // No window on the response (an older fixture): the line says nothing about one.
  if (window) parts.push(scoreWindowPhrase(window, feedNow));
  return parts.join(' · ');
}
