import { LEAGUE_PATH } from '@/lib/depot/nav';
import type { ScoreWindow } from '@/lib/depot/score/types';
import { scoreWindowShort, type WindowWordsInput } from '@/lib/depot/score/windowWords';
import type { CockpitHeader } from './cockpitTypes';

/**
 * The efficiency index as the header's meta line ("Index 35.9 · rank 33/38 Large fleets ·
 * since 15:19"), a link to the league. The window is worded by the shared module only.
 */

export interface IndexMeta {
  /** Mono label text: figures and codes, never a sentence. */
  readonly label: string;
  /** The phone form (under 640px): the index and the rank only, never the window. */
  readonly shortLabel: string;
  /** Why the depot is not ranked, as a sentence (sans); null when ranked. */
  readonly reason: string | null;
  readonly href: string;
}

/**
 * With no window on the response, or this depot summed over one snapshot, the shared
 * words say "one snapshot": the meta never claims a span it does not have.
 */
function windowFor(
  window: ScoreWindow | null | undefined,
  depotSamples: number | undefined,
): WindowWordsInput | undefined {
  if (!window) return undefined;
  return depotSamples === undefined ? window : { ...window, samples: depotSamples };
}

export function indexMeta(
  header: CockpitHeader,
  window: ScoreWindow | null | undefined,
  feedNow: string | null,
  depotSamples?: number,
): IndexMeta {
  if (!header.ranked || header.index === null) {
    const label = 'Index not ranked';
    return { label, shortLabel: label, reason: header.unrankedReason, href: LEAGUE_PATH };
  }
  const parts = [`Index ${header.index.toFixed(1)}`];
  if (header.rank !== null && header.peerCount !== null) {
    const group = header.peerGroupLabel ? ` ${header.peerGroupLabel}` : '';
    parts.push(`rank ${header.rank}/${header.peerCount}${group}`);
  }
  const shortLabel =
    header.rank !== null && header.peerCount !== null
      ? `Index ${header.index.toFixed(1)} · rank ${header.rank}/${header.peerCount}`
      : `Index ${header.index.toFixed(1)}`;
  parts.push(scoreWindowShort(windowFor(window, depotSamples), feedNow));
  return { label: parts.join(' · '), shortLabel, reason: null, href: LEAGUE_PATH };
}
