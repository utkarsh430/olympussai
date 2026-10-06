import { formatCount } from '../format';
import { MIN_FLEET_FOR_RANK } from '../score/config';
import { ECONOMICS_Z_CLAMP, type ECONOMICS_WEIGHTS } from '../sim/revenueConfig';
import type { EconomicsDepotRow } from './api';
import { DASH, HUNDREDTH, MINUS, PERCENT, formatComponentValue, roundTo } from './economicsFormat';
import type { EconomicsRow, EconomicsCell } from './economicsRows';
import type { EconomicsComponentKey, EconomicsRankReason } from './types';

/* The economics page's sentences: the status line, a depot's explanation and its breakdown. */

const SEP = ' · ';

function count(depots: readonly EconomicsDepotRow[], reason: EconomicsRankReason): number {
  return depots.filter((d) => d.score.reason === reason).length;
}

/** "4 ranked of 6 operating depots (MODELLED) · 1 not ranked: no route with a known length". */
export function economicsStatusLine(depots: readonly EconomicsDepotRow[]): string {
  const operating = depots.filter((d) => d.kind === 'depot');
  const ranked = operating.filter((d) => d.score.ranked).length;
  const noLength = operating.filter(
    (d) => d.score.reason === 'missing_component' && d.score.missing.includes('earningsPerKm'),
  ).length;
  const tooSmall = operating.filter((d) => d.score.reason === 'fleet_too_small').length;
  const smallGroup = count(operating, 'peer_group_too_small');
  const otherMissing = operating.filter((d) => d.score.reason === 'missing_component').length - noLength;
  const others = depots.length - operating.length;
  const noun = operating.length === 1 ? 'operating depot' : 'operating depots';
  const parts = [
    `${formatCount(ranked)} ranked of ${formatCount(operating.length)} ${noun} (MODELLED)`,
    noLength > 0 ? `${formatCount(noLength)} not ranked: no duty ran in the modelled day` : null,
    smallGroup > 0
      ? `${formatCount(smallGroup)} not ranked: its peer group has too few depots with complete figures`
      : null,
    tooSmall > 0 ? `${formatCount(tooSmall)} not ranked: fewer than ${MIN_FLEET_FOR_RANK} buses` : null,
    otherMissing > 0 ? `${formatCount(otherMissing)} not ranked: a component could not be worked out` : null,
    others > 0
      ? `${formatCount(others)} other ${others === 1 ? 'unit is not an operating depot' : 'units are not operating depots'}`
      : null,
  ];
  return parts.filter((p): p is string => p !== null).join(SEP);
}

/** "rank 1 of 6 in its peer group (All depots)". */
export function peerRankPhrase(row: EconomicsRow): string {
  if (!row.ranked || row.rank === null || row.peerCount === null || row.peerGroupLabel === null) {
    return 'not ranked';
  }
  return `rank ${row.rank} of ${row.peerCount} in its peer group (${row.peerGroupLabel})`;
}

/** One sentence on what moved a depot's economics index most. */
export function explainEconomics(row: EconomicsRow): string {
  if (row.reasonText !== null) return row.reasonText;
  const scored = row.cells.filter((c) => c.value !== null);
  const rounded = (c: EconomicsCell): number => roundTo(c.contribution, HUNDREDTH);
  const [first, ...rest] = scored;
  if (first === undefined) return 'No component could be worked out for this depot.';
  const strongest = rest.reduce((a, b) => (rounded(b) > rounded(a) ? b : a), first);
  const weakest = rest.reduce((a, b) => (rounded(b) < rounded(a) ? b : a), first);
  if (rounded(strongest) === rounded(weakest)) {
    return 'No single measure stands out; every component contributes equally.';
  }
  const lead = rounded(strongest) > 0 ? 'Helped most by' : 'Least held back by';
  return `${lead} ${strongest.label}; held back most by ${weakest.label}.`;
}

export interface BreakdownRow {
  readonly key: EconomicsComponentKey;
  readonly label: string;
  readonly valueText: string;
  readonly peerMedianText: string;
  /** "2 of 8 routes" for earnings per km; null for the other components. */
  readonly coverageText: string | null;
  readonly zText: string;
  readonly weightText: string;
  readonly contributionText: string;
}

function signed(n: number): string {
  const rounded = roundTo(n, HUNDREDTH);
  if (rounded === 0) return '0.00';
  return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(2)}`;
}

export function breakdownRows(
  row: EconomicsRow,
  weights: typeof ECONOMICS_WEIGHTS,
): BreakdownRow[] {
  return row.cells.map((cell) => ({
    key: cell.key,
    label: cell.label,
    valueText: cell.valueText,
    peerMedianText: cell.peerMedian === null ? 'no peer median' : formatComponentValue(cell.key, cell.peerMedian),
    coverageText:
      cell.coverage === null
        ? null
        : `${formatCount(cell.coverage.n)} of ${formatCount(cell.coverage.of)} routes`,
    zText: cell.z === null ? DASH : signed(cell.z),
    weightText: `${Math.round(weights[cell.key] * PERCENT)}%`,
    contributionText: row.ranked ? signed(cell.contribution) : DASH,
  }));
}

/** The one sentence that keeps the two indices apart; the link goes between lead and tail. */
export const INDEX_SEPARATION = {
  lead: 'The Depot Economics Index is MODELLED from planning assumptions and is separate from the Depot Efficiency Index, which is built from live data. The efficiency index is on the ',
  linkText: 'league table',
  tail: '.',
} as const;

/** The footnote under a breakdown: how contributions become the index. */
export const BREAKDOWN_NOTE = `Each component is compared with the peer median, signed so higher is better (lower fuel cost counts as better). The weighted contributions are summed and scaled so a typical peer sits at 50: a total of +${ECONOMICS_Z_CLAMP} reaches 100 and ${MINUS}${ECONOMICS_Z_CLAMP} reaches 0.`;
