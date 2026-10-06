import { formatCount } from '../format';
import { MIN_FLEET_FOR_RANK, MIN_PEER_GROUP } from '../score/config';
import type { EconomicsDepotRow } from './api';
import { rankingShortfallNotice, economicsStatement } from './economicsStatement';
import { MIXED_CLASS_NOTE } from '../sim/revenueConfig';

/*
 * The economics page's layout models: the figure-and-reason rows that replace the
 * status line, the state panel for a thin ranking, and the closing disclosure.
 */

const MAX_STATUS_ROWS = 3;

interface Reason {
  readonly count: number;
  readonly text: string;
}

export interface StatusRow {
  readonly figure: string;
  readonly text: string;
}

/** Ranked first, then each reason for not ranking, biggest first; at most three rows. */
export function economicsStatusRows(depots: readonly EconomicsDepotRow[]): readonly StatusRow[] {
  const operating = depots.filter((d) => d.kind === 'depot');
  const ranked = operating.filter((d) => d.score.ranked).length;
  const others = depots.length - operating.length;
  const noun = operating.length === 1 ? 'operating depot' : 'operating depots';
  const reasons: Reason[] = [
    {
      count: operating.filter(
        (d) => d.score.reason === 'missing_component' && d.score.missing.includes('earningsPerKm'),
      ).length,
      text: 'no duty ran in the modelled day',
    },
    {
      count: operating.filter((d) => d.score.reason === 'peer_group_too_small').length,
      text: 'peer group too small',
    },
    {
      count: operating.filter((d) => d.score.reason === 'fleet_too_small').length,
      text: `fewer than ${MIN_FLEET_FOR_RANK} buses`,
    },
    {
      count: operating.filter(
        (d) => d.score.reason === 'missing_component' && !d.score.missing.includes('earningsPerKm'),
      ).length,
      text: 'a component could not be worked out',
    },
  ]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const asRow = (r: Reason): StatusRow => ({
    figure: formatCount(r.count),
    text: `not ranked: ${r.text}`,
  });
  const head: StatusRow = {
    figure: formatCount(ranked),
    text:
      `ranked of ${formatCount(operating.length)} ${noun}` +
      (others > 0
        ? `; ${formatCount(others)} other ${others === 1 ? 'unit is' : 'units are'} not operating depots`
        : ''),
  };
  const room = MAX_STATUS_ROWS - 1;
  if (reasons.length <= room) return [head, ...reasons.map(asRow)];
  const restCount = reasons.slice(room - 1).reduce((n, r) => n + r.count, 0);
  return [
    head,
    ...reasons.slice(0, room - 1).map(asRow),
    asRow({ count: restCount, text: 'other reasons' }),
  ];
}

export interface NotRankedPanel {
  readonly sentence: string;
  readonly remedy: string;
}

/** Why few depots are ranked and what would change it; null when at least half are ranked. */
export function notRankedPanel(depots: readonly EconomicsDepotRow[]): NotRankedPanel | null {
  if (rankingShortfallNotice(depots) === null) return null;
  const operating = depots.filter((d) => d.kind === 'depot');
  const ranked = operating.filter((d) => d.score.ranked).length;
  const lead =
    ranked === 0
      ? `No depot is ranked among the ${formatCount(operating.length)} operating ${operating.length === 1 ? 'depot' : 'depots'}.`
      : `Only ${formatCount(ranked)} of ${formatCount(operating.length)} operating ${operating.length === 1 ? 'depot is' : 'depots are'} ranked.`;
  return {
    sentence: lead,
    remedy: `A depot is ranked when a duty ran in its modelled day and its peer group has at least ${formatCount(MIN_PEER_GROUP)} depots with complete figures. The unranked depots are listed below with their reason.`,
  };
}

/** The closing disclosure: what the index is, the length coverage, the model's definitions and the cost's feed. */
export function economicsDisclosure(
  depots: readonly EconomicsDepotRow[],
  revenueParagraphs: readonly string[],
  lengthLine: string | null,
): readonly string[] {
  const statement = economicsStatement();
  const shortfall = rankingShortfallNotice(depots);
  return [
    ...statement.preface,
    ...revenueParagraphs,
    MIXED_CLASS_NOTE,
    ...statement.closing,
    lengthLine ?? '',
    shortfall ? `${shortfall.lead}${shortfall.linkText}${shortfall.tail}` : '',
  ].filter((p) => p !== '');
}
