import { buildRequest, cleanName, makeFact, nameFact, ph } from '@/lib/depot/copilot/facts/format';
import { routeNameFact } from '@/lib/depot/copilot/facts/routeDay';
import {
  MAYBE_COVERED,
  RECOMMENDATION_ONLY,
  TIER_WORDS,
  busesText,
  changeText,
  passengersText,
  proposalProvenance,
  revenueText,
} from '@/lib/depot/copilot/facts/serviceText';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import { bandLabel } from '@/lib/depot/service/bands';
import type { Proposal, RouteHourlyBody } from '@/lib/depot/service/types';

const GUIDANCE =
  'Explain in plain language why this one proposal for the route was made: the gap in its band, ' +
  'what the figures rest on, where the buses would come from or why none, the modelled impact as a ' +
  'range, and what would change it. Use only the supplied facts, describe and recommend, and never instruct.';

const MOVES_BUSES = new Set<Proposal['kind']>(['add_buses', 'hold_buses']);

/** Running buses are measured where the proposal rests on measured deployment (tiers A and B). */
const deployedProvenance = (p: Proposal) => (p.tier === 'C' ? 'modelled' : 'derived');

function figureFacts(p: Proposal): CopilotFact[] {
  const gap = p.needed - p.deployed;
  return [
    makeFact('p.band', 'Band', bandLabel(p.band), 'derived'),
    makeFact('p.change', 'Proposed change', changeText(p), proposalProvenance(p.tier)),
    makeFact('p.deployed', 'Buses running', busesText(p.deployed), deployedProvenance(p)),
    makeFact('p.needed', 'Buses needed', busesText(p.needed), 'modelled'),
    ...(p.scheduled === null ? [] : [makeFact('p.scheduled', 'Buses scheduled', busesText(p.scheduled), 'derived')]),
    ...(Math.round(gap) === 0 ? [] : [makeFact('p.gap', 'Gap', busesText(gap), 'modelled')]),
  ];
}

function sourceFacts(p: Proposal): CopilotFact[] {
  if (p.source === null || !MOVES_BUSES.has(p.kind)) return [];
  const { depotName, standingInYard, idleInDayPlan } = p.source;
  return [
    nameFact('p.source', 'Source depot', cleanName(depotName), 'live'),
    ...(standingInYard === null ? [] : [makeFact('p.standing', 'Standing in its yard', busesText(standingInYard), 'derived')]),
    ...(idleInDayPlan === undefined || idleInDayPlan === null
      ? []
      : [makeFact('p.idle', 'Idle in its plan', busesText(idleInDayPlan), 'modelled')]),
  ];
}

function impactFacts(p: Proposal): CopilotFact[] {
  const passengers = passengersText(p);
  if (p.impact === null || passengers === null) return [];
  return [
    makeFact('p.passengers', 'Passengers a day', passengers, 'modelled'),
    makeFact('p.revenue', 'Revenue a day', revenueText(p.impact.revenuePerDay), 'modelled'),
    makeFact('p.cost', 'Cost a day', revenueText(p.impact.costPerDay), 'modelled'),
  ];
}

function whySentences(p: Proposal): string {
  const scheduled =
    p.scheduled === null
      ? 'No scheduled trip is known for that band.'
      : `Scheduled on the timetable known so far: ${ph('p.scheduled')}.`;
  const gap = p.needed - p.deployed;
  const side =
    Math.round(gap) > 0
      ? `On these figures the route is short by ${ph('p.gap')}.`
      : Math.round(gap) < 0
        ? `On these figures the route holds a surplus of ${ph('p.gap')}.`
        : 'On these figures the route runs level with its need.';
  const finding = MOVES_BUSES.has(p.kind) ? '' : ` The finding: ${ph('p.change')}.`;
  return `Band: ${ph('p.band')}. Running in that band: ${ph('p.deployed')}; needed on modelled passenger demand: ${ph('p.needed')}. ${scheduled} ${side}${finding}`;
}

function sourceSentences(p: Proposal): string {
  const covered = p.maybeCoveredByUnrouted ? ` ${MAYBE_COVERED}` : '';
  if (!MOVES_BUSES.has(p.kind)) return `No bus moves for this finding.${covered}`;
  if (p.source === null) return `No source was identified for these buses.${covered}`;
  if (p.kind === 'hold_buses') return `The buses held would return to ${ph('p.source')}.${covered}`;
  const from = `The buses would come from ${ph('p.source')}.`;
  const pool =
    p.source.standingInYard !== null
      ? ` Standing in its yard before the band: ${ph('p.standing')}.`
      : p.source.idleInDayPlan !== undefined && p.source.idleInDayPlan !== null
        ? ` Idle in its modelled plan: ${ph('p.idle')}.`
        : ' The yard was not observed before the band, so the source rests on the modelled plan.';
  return `${from}${pool}${covered}`;
}

const impactSentence = (p: Proposal): string =>
  p.impact === null
    ? 'No modelled impact: this finding is about the timetable, not the bus count.'
    : `Modelled passengers carried: ${ph('p.passengers')}; revenue: ${ph('p.revenue')}; cost: ${ph('p.cost')}.`;

const WHAT_WOULD_CHANGE =
  'Measured passenger counts would replace the modelled demand and could change the need; a full timetable for the route would firm up the scheduled figures.';

/**
 * Why one proposal on a route's day was made: the gap in its band, what the figures rest
 * on, the source of the buses or why there is none, the modelled impact as a range, and
 * what would change it. Recommendation only.
 */
export function buildProposalRationale(proposal: Proposal, body: RouteHourlyBody): CopilotRequest {
  const facts = [
    routeNameFact(body),
    ...figureFacts(proposal),
    ...sourceFacts(proposal),
    ...impactFacts(proposal),
  ];
  return buildRequest({
    task: 'rationale',
    scopeLabel: `proposal for ${cleanName(body.routeName)}`,
    facts,
    guidance: GUIDANCE,
    scriptedDraft: {
      headline: `${ph('route.name')}, proposed change: ${ph('p.change')}`,
      paragraphs: [
        whySentences(proposal),
        TIER_WORDS[proposal.tier],
        sourceSentences(proposal),
        impactSentence(proposal),
        `${WHAT_WOULD_CHANGE} ${RECOMMENDATION_ONLY}`,
      ],
    },
  });
}
