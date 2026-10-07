import { BREAKPOINT_PX, WIDE_VIEWPORT_PX } from '../shell/geometry';
import { PROPOSAL_COLUMN_WIDTHS, type ProposalTableTier } from './servicePageModel';

/*
 * The network proposals table's columns per width: the route page's set less the figures
 * a network row cannot share (deployed, scheduled, source), plus Route and Depot. What a
 * tier drops is in the expanded row.
 */

export type NetworkProposalColumnKey = 'band' | 'change' | 'route' | 'depot' | 'needed' | 'impact' | 'restsOn';

export const NETWORK_PROPOSAL_COLUMN_WIDTHS: Readonly<Record<NetworkProposalColumnKey, number>> = {
  band: PROPOSAL_COLUMN_WIDTHS.band,
  change: PROPOSAL_COLUMN_WIDTHS.change,
  /** A feed route name in mono, truncated inside the column with the full name in its title. */
  route: 176,
  depot: 128,
  needed: PROPOSAL_COLUMN_WIDTHS.needed,
  impact: PROPOSAL_COLUMN_WIDTHS.impact,
  restsOn: PROPOSAL_COLUMN_WIDTHS.restsOn,
};

const COLUMN_SETS: Readonly<Record<ProposalTableTier, readonly NetworkProposalColumnKey[]>> = {
  full: ['band', 'change', 'route', 'depot', 'needed', 'impact', 'restsOn'],
  wide: ['band', 'change', 'route', 'impact', 'restsOn'],
  narrow: ['band', 'change', 'route', 'restsOn'],
  phone: ['band', 'change', 'restsOn'],
};

const NARROW_FROM_PX = 800;

export const NETWORK_PROPOSAL_TIERS: readonly (readonly [ProposalTableTier, number])[] = [
  ['full', WIDE_VIEWPORT_PX],
  ['wide', BREAKPOINT_PX.lg],
  ['narrow', NARROW_FROM_PX],
  ['phone', 0],
];

export function networkProposalTierFor(viewportPx: number): ProposalTableTier {
  return NETWORK_PROPOSAL_TIERS.find(([, from]) => viewportPx >= from)?.[0] ?? 'phone';
}

export function networkProposalColumnKeys(tier: ProposalTableTier): readonly NetworkProposalColumnKey[] {
  return COLUMN_SETS[tier];
}
