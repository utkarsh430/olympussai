import { formatCount } from '../format';
import { MIN_PEER_GROUP } from '../score/config';
import type { EconomicsDepotRow } from './api';
import { rankingShortfallNotice, economicsStatement } from './economicsStatement';
import { MIXED_CLASS_NOTE } from '../sim/revenueConfig';

/*
 * The economics page's layout models: the state panel for a thin ranking and the
 * closing disclosure (the figure band is in economicsLayout).
 */

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
    remedy: `A depot is ranked when its modelled day has a duty and its peer group has at least ${formatCount(MIN_PEER_GROUP)} depots with complete figures; the unranked depots are listed below with their reason.`,
  };
}

/**
 * The closing disclosure's plain paragraphs: what the index is, the model's
 * definitions, the cost's feed and the length coverage. The page adds the three
 * paragraphs that used to stand above the table (with the league link) and the
 * shortfall (with the Routes link) after these.
 */
export function economicsDisclosure(
  revenueParagraphs: readonly string[],
  lengthLine: string | null,
): readonly string[] {
  const statement = economicsStatement();
  return [
    ...statement.preface,
    ...revenueParagraphs,
    MIXED_CLASS_NOTE,
    ...statement.closing,
    lengthLine ?? '',
  ].filter((p) => p !== '');
}
