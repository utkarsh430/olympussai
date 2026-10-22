import type { DepotSummary } from '../../types';
import { formatCount } from '../../format';
import type { FuelAudit } from './fuelAudit';
import type { Decision } from './types';
import { summariseHealth, type VehicleHealth } from './vehicleHealth';

/**
 * The operational briefing: the scope's fleet in one line, the decisions that matter in
 * order, and what following the top recommendations would change. Every sentence quotes a
 * record the queue or the fleet index holds, so the briefing changes when they do.
 */
export interface Briefing {
  readonly headline: string;
  readonly situation: readonly string[];
  readonly priorities: readonly { readonly decisionId: string; readonly text: string }[];
  readonly outlook: string;
}

export interface BriefingInput {
  readonly scopeLabel: string;
  readonly depots: readonly DepotSummary[];
  readonly decisions: readonly Decision[];
  readonly health: readonly VehicleHealth[] | null;
  readonly fuel: FuelAudit | null;
}

const TOP = 5;

export function buildBriefing(input: BriefingInput): Briefing {
  const fleet = input.depots.reduce((s, d) => s + d.fleet, 0);
  const moving = input.depots.reduce((s, d) => s + d.states.inService + d.states.onRoad, 0);
  const standing = input.depots.reduce((s, d) => s + d.states.standing, 0);
  const dark = input.depots.reduce((s, d) => s + d.states.dark, 0);
  const offRoad = input.depots.reduce((s, d) => s + d.states.offRoad, 0);
  const critical = input.decisions.filter((d) => d.severity === 'critical').length;
  const high = input.decisions.filter((d) => d.severity === 'high').length;
  const shortage = input.decisions
    .filter((d) => d.category === 'shortage')
    .reduce((s, d) => s + d.weight, 0);
  const health = input.health ? summariseHealth(input.health) : null;

  const situation = [
    `${formatCount(fleet)} buses: ${formatCount(moving)} on the road, ${formatCount(standing)} standing, ${formatCount(offRoad)} off the road and ${formatCount(dark)} without GPS signal.`,
  ];
  if (shortage > 0) {
    situation.push(
      `${formatCount(input.decisions.filter((d) => d.category === 'shortage').length)} depots are short by ${formatCount(shortage)} buses in all for the morning peak.`,
    );
  }
  if (health) {
    situation.push(
      `${formatCount(health.overdue)} buses are past their service; ${formatCount(health.highRiskOnRoad)} high-risk buses are running now.`,
    );
  }
  if (input.fuel && input.fuel.summary.flagged > 0) {
    situation.push(
      `The fuel audit flags ${formatCount(input.fuel.summary.flagged)} journeys over 14 days, an estimated ₹${formatCount(input.fuel.summary.exposureRupees)} to verify.`,
    );
  }

  const priorities = input.decisions.slice(0, TOP).map((d, i) => ({
    decisionId: d.id,
    text: `${i + 1}. ${d.title}. Recommended: ${d.recommendation.title.toLowerCase()} (${d.recommendation.impact.replace(/\.$/, '')}).`,
  }));

  const transfers = input.decisions.find((d) => d.category === 'redistribution');
  const outlook = transfers
    ? `Approving the redistribution plan: ${transfers.recommendation.impact}`
    : input.decisions.length === 0
      ? 'No decision is open in this scope.'
      : `${formatCount(input.decisions.length)} decisions are open; each needs a person's approval before anything moves.`;

  return {
    headline:
      critical + high > 0
        ? `${input.scopeLabel}: ${formatCount(critical)} critical and ${formatCount(high)} high-priority decisions`
        : `${input.scopeLabel}: no critical decision open`,
    situation,
    priorities,
    outlook,
  };
}
