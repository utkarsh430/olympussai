import { formatCount, formatFeedTime } from '@/lib/depot/format';
import type { DepotScore } from '@/lib/depot/score/types';
import type { DepotSummary } from '@/lib/depot/types';
import { differenceDirection, formatRate, type DifferenceDirection } from './leagueModel';

/**
 * The league page's sentences, built from the data so the counts on screen
 * always add up: a unit is any home-depot value in the feed, an operating
 * depot is a unit of kind `depot`, and only operating depots can be ranked.
 */

const DASH = '—';
const SEP = ' · ';
const MINUS = '−';
const ROUND_TO_TENTH = 10;

export type DifferenceUnit = 'pp' | 'pts';

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "118 ranked of 119 operating depots · 1 not ranked (fewer than 10 buses) · 24 other units not ranked". */
export function leagueStatusLine(
  depots: readonly Pick<DepotSummary, 'id' | 'kind'>[],
  scores: readonly Pick<DepotScore, 'depotId' | 'ranked'>[],
  minFleetForRank: number,
): string {
  const rankedIds = new Set(scores.filter((s) => s.ranked).map((s) => s.depotId));
  const operating = depots.filter((d) => d.kind === 'depot');
  const ranked = operating.filter((d) => rankedIds.has(d.id)).length;
  const tooSmall = operating.length - ranked;
  const others = depots.length - operating.length;
  const parts = [
    `${formatCount(ranked)} ranked of ${plural(operating.length, 'operating depot', 'operating depots')}`,
    tooSmall > 0
      ? `${formatCount(tooSmall)} not ranked (fewer than ${minFleetForRank} buses)`
      : null,
    others > 0 ? `${plural(others, 'other unit', 'other units')} not ranked` : null,
  ];
  return parts.filter((p): p is string => p !== null).join(SEP);
}

/**
 * The one note above the table: ranked of operating depots, and how to open a breakdown.
 * The window words are in the provenance line and the row count in the pager.
 */
export function leagueSectionNote(
  depots: readonly Pick<DepotSummary, 'id' | 'kind'>[],
  scores: readonly Pick<DepotScore, 'depotId' | 'ranked'>[],
): string {
  const rankedIds = new Set(scores.filter((s) => s.ranked).map((s) => s.depotId));
  const operating = depots.filter((d) => d.kind === 'depot');
  const ranked = operating.filter((d) => rankedIds.has(d.id)).length;
  return `${formatCount(ranked)} of ${formatCount(operating.length)} ranked${SEP}the index cell opens how a score is made up`;
}

export interface WindowMark {
  /** The quiet word beside the depot's name. */
  readonly word: string;
  readonly title: string;
}

/**
 * A depot scored on fewer snapshots than the window holds is new to the window: its rank
 * is not yet settled, so its row says so. Null when it has the whole window or either
 * count is missing.
 */
export function windowMark(
  samples: number | undefined,
  windowSamples: number | undefined,
): WindowMark | null {
  if (samples === undefined || windowSamples === undefined || samples >= windowSamples) return null;
  const snapshots = samples === 1 ? '1 snapshot' : `${formatCount(samples)} snapshots`;
  return {
    word: 'new',
    title: `Scored on ${snapshots} so far, of ${formatCount(windowSamples)} in the window.`,
  };
}

/** "rank 1 of 41 in its peer group (Small fleets)". */
export function peerRankPhrase(rank: number, peerCount: number, groupLabel: string): string {
  return `rank ${rank} of ${peerCount} in its peer group (${groupLabel})`;
}

function roundTenth(n: number): number {
  return Math.round(n * ROUND_TO_TENTH) / ROUND_TO_TENTH;
}

/** "+22.5 pp", "−5.0 pp", "0.0 pp"; the raw sign, never the direction of good. */
export function formatSignedDifference(delta: number | null, unit: DifferenceUnit): string {
  if (delta === null) return DASH;
  const rounded = roundTenth(delta);
  if (rounded === 0) return `0.0 ${unit}`;
  return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(1)} ${unit}`;
}

export interface MetricCellInput {
  readonly label: string;
  readonly value: number | null;
  readonly peerMedian: number | null;
  readonly deltaPoints: number | null;
  readonly higherIsBetter: boolean;
}

export interface MetricCellWording {
  /** "92.4%". */
  readonly value: string;
  /** "+22.5 pp": the raw difference from the peer median. */
  readonly difference: string;
  readonly direction: DifferenceDirection;
  /** For the cell's `title` and screen-reader text: says better or worse in words. */
  readonly description: string;
}

/**
 * One league cell. The sign shows the raw difference; the word (derived from
 * `higherIsBetter`) shows whether that is good, because for the dark and
 * off-road rates a positive difference is worse.
 */
export function metricCellWording(cell: MetricCellInput): MetricCellWording {
  const direction = differenceDirection(cell.deltaPoints, cell.higherIsBetter);
  const value = formatRate(cell.value);
  const median = formatRate(cell.peerMedian);
  const size =
    cell.deltaPoints === null ? '' : `${Math.abs(roundTenth(cell.deltaPoints)).toFixed(1)} pp`;
  const comparison: Readonly<Record<DifferenceDirection, string>> = {
    better: `${size} better than the peer median of ${median}`,
    worse: `${size} worse than the peer median of ${median}`,
    level: `level with the peer median of ${median}`,
    unknown: 'no peer median to compare with',
  };
  return {
    value,
    difference: formatSignedDifference(cell.deltaPoints, 'pp'),
    direction,
    description: `${cell.label} ${value}, ${comparison[direction]}`,
  };
}

/** "Computed 12:37" from the feed clock, so live drift between visits is explained. */
export function computedStamp(feedNow: string | null): string {
  const time = formatFeedTime(feedNow);
  return time === DASH ? 'Computed at an unknown time' : `Computed ${time}`;
}
