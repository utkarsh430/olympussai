import type { DepotDetailResponse } from '@/lib/depot/api';
import {
  DEPOT_EXCEPTION_PHRASE,
  buildRequest,
  busCount,
  depotCount,
  cleanName,
  count,
  countPhrase,
  index1,
  makeFact,
  nameFact,
  onRoadCount,
  ph,
  share,
} from '@/lib/depot/copilot/facts/format';
import type { CopilotDraft, CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import { formatFeedTime } from '@/lib/depot/format';
import type { Yard } from '@/lib/depot/infer/types';
import { DEPOT_KIND_LABEL } from '@/lib/depot/labels';
import { DEI_COMPONENTS } from '@/lib/depot/score/config';
import { strongestAndWeakest } from '@/lib/depot/score/explain';
import type { DeiComponentKey, PeerGroupId } from '@/lib/depot/score/types';
import { indexWindowFacts, indexWindowSentence } from '@/lib/depot/copilot/facts/window';

const GUIDANCE =
  'Write a short briefing for one depot: where it stands against its peers, the state of its ' +
  'fleet, its yard when one is established, scheduled departures when known, and any exceptions. ' +
  'Use only the supplied facts, say when something is not established, and describe rather than instruct.';

/** A rank in the first part of the peer group reads as strong, in the last part as weak. */
const UPPER_SHARE = 1 / 3;
const LOWER_SHARE = 2 / 3;
/** With fewer peers than this a rank says little about upper or lower. */
const MIN_PEERS_TO_JUDGE = 3;

const PEER_LABEL: Readonly<Record<PeerGroupId, string>> = {
  small: 'smaller depots',
  medium: 'mid-sized depots',
  large: 'larger depots',
  all: 'all depots',
};

const componentLabel = (key: DeiComponentKey): string =>
  DEI_COMPONENTS.find((c) => c.key === key)?.label ?? key;

const exceptionCount = (n: number): string => `${n} ${n === 1 ? 'exception' : 'exceptions'}`;

/**
 * Review I7. A yard the single-snapshot rule gives is evidenced by the buses
 * parked inside it now; a held yard (`heldSince`) is not, so its fact is the
 * time since which it has been held, never this snapshot's parked count.
 */
function yardEvidenceFact(yard: Yard): CopilotFact {
  if (yard.heldSince !== undefined) {
    return makeFact('depot.yard_held_since', 'Yard held since', formatFeedTime(yard.heldSince), 'derived');
  }
  return makeFact(
    'depot.yard_support',
    'Parked buses inside the yard',
    `${count(yard.inCluster)} of ${count(yard.parked)} parked buses`,
    'derived',
  );
}

export function depotFacts(detail: DepotDetailResponse): CopilotFact[] {
  const { depot, score, yard, locationMix, outshed, exceptions } = detail;
  const fleet = depot.fleet;
  const facts: CopilotFact[] = [
    nameFact('depot.name', 'Depot', cleanName(depot.name), 'live'),
    makeFact('depot.kind', 'Kind', DEPOT_KIND_LABEL[depot.kind], 'reference'),
    makeFact('depot.fleet', 'Fleet', busCount(fleet), 'live'),
    makeFact('depot.on_road', 'On the road', busCount(onRoadCount(depot.states)), 'derived'),
    makeFact(
      'depot.on_road_share',
      'On-road share',
      share(onRoadCount(depot.states), fleet),
      'derived',
    ),
    makeFact('depot.dark', 'Dark', busCount(depot.states.dark), 'derived'),
    makeFact('depot.dark_share', 'Dark share', share(depot.states.dark, fleet), 'derived'),
    makeFact('depot.off_road', 'Off the road', busCount(depot.states.offRoad), 'derived'),
    makeFact(
      'depot.off_road_share',
      'Off-road share',
      share(depot.states.offRoad, fleet),
      'derived',
    ),
    makeFact('depot.power_cut', 'Main power off', busCount(depot.powerCut), 'live'),
  ];
  if (score?.ranked && score.index !== null && score.rank !== null && score.peerCount !== null) {
    facts.push(
      makeFact('depot.index', 'Efficiency index', index1(score.index), 'derived'),
      makeFact('depot.rank', 'Rank', `rank ${count(score.rank)} of ${depotCount(score.peerCount)}`, 'derived'),
      makeFact('depot.peer_group', 'Peer group', PEER_LABEL[score.peerGroup ?? 'all'], 'derived'),
      ...indexWindowFacts('depot.index_window', detail.scoreWindow),
    );
    const { strongest, weakest } = strongestAndWeakest(score);
    if (strongest && weakest) {
      facts.push(
        makeFact(
          'depot.strongest_component',
          'Strongest component',
          componentLabel(strongest.key),
          'derived',
        ),
        makeFact(
          'depot.weakest_component',
          'Weakest component',
          componentLabel(weakest.key),
          'derived',
        ),
      );
    }
  }
  if (yard.value) {
    facts.push(
      yardEvidenceFact(yard.value),
      makeFact('depot.in_yard', 'In the yard', busCount(locationMix.in_yard), 'derived'),
      makeFact('depot.away', 'Away from the yard', busCount(locationMix.away), 'derived'),
    );
    if (detail.visitors.length > 0) {
      facts.push(
        makeFact('depot.visitors', 'Visitors', busCount(detail.visitors.length), 'derived'),
      );
    }
  }
  if (outshed.coverage.n > 0) {
    facts.push(
      makeFact(
        'depot.outshed_coverage',
        'Schedule coverage',
        `${count(outshed.coverage.n)} of ${count(outshed.coverage.of)} buses`,
        'derived',
      ),
      makeFact('depot.outshed_departed', 'Departed', busCount(outshed.counts.departed), 'derived'),
      makeFact(
        'depot.outshed_overdue',
        'Overdue to leave',
        busCount(outshed.counts.overdue),
        'derived',
      ),
    );
  }
  facts.push(
    makeFact(
      'depot.exceptions_depot',
      'Depot exceptions',
      exceptionCount(exceptions.depot.length),
      'derived',
    ),
    makeFact(
      'depot.exceptions_bus',
      'Vehicle exceptions',
      exceptionCount(exceptions.bus.length),
      'derived',
    ),
  );
  return facts;
}

function standingParagraph(detail: DepotDetailResponse): string {
  const { score } = detail;
  const name = ph('depot.name');
  if (score?.ranked && score.index !== null && score.rank !== null && score.peerCount !== null) {
    const position = score.peerCount < MIN_PEERS_TO_JUDGE ? 0.5 : score.rank / score.peerCount;
    const where =
      position <= UPPER_SHARE
        ? 'in the upper part of its peer group'
        : position > LOWER_SHARE
          ? 'in the lower part of its peer group'
          : 'in the middle of its peer group';
    const window = indexWindowSentence(
      detail.scoreWindow,
      'depot.index_window',
      'The rank and index cover',
    );
    const base = `${name} sits ${where}, at efficiency ${ph('depot.index')} and ${ph('depot.rank')} among ${ph('depot.peer_group')}.${window}`;
    const { strongest, weakest } = strongestAndWeakest(score);
    if (!strongest || !weakest) return base;
    const s = ph('depot.strongest_component');
    const w = ph('depot.weakest_component');
    // "Weighing on the index" is only true when the weakest component pulls it down.
    if (weakest.contribution >= 0)
      return `${base} Its strongest component is ${s}; the weakest is ${w}.`;
    return position > LOWER_SHARE
      ? `${base} The component weighing on the index hardest is ${w}; its strongest, ${s}, shows what the depot already does well.`
      : `${base} Its strongest component is ${s}; the weakest, ${w}, is the natural place to look for further gains.`;
  }
  if (score === null) return `No efficiency index is available for ${name} on this snapshot.`;
  if (score.reason === 'not_a_depot') {
    return `${name} is listed as ${ph('depot.kind')}, which is not an operating depot, so it is not ranked against depots.`;
  }
  return `${name} has a fleet of ${ph('depot.fleet')}, too small for its rates to be compared fairly, so it is not ranked.`;
}

function fleetParagraph(detail: DepotDetailResponse): string {
  if (detail.depot.fleet === 0) return 'No buses are homed here in the feed.';
  const states = {
    onRoad: onRoadCount(detail.depot.states),
    dark: detail.depot.states.dark,
    offRoad: detail.depot.states.offRoad,
  };
  const power =
    detail.depot.powerCut > 0 ? ` Main power reads off on ${ph('depot.power_cut')}.` : '';
  return (
    `Of ${ph('depot.fleet')} homed here, ${ph('depot.on_road')} ${countPhrase(states.onRoad, 'is on the road', 'are on the road')} (${ph('depot.on_road_share')}), ` +
    `${ph('depot.dark')} ${countPhrase(states.dark, 'is dark', 'are dark')} (${ph('depot.dark_share')}) and ${ph('depot.off_road')} ${countPhrase(states.offRoad, 'is off the road', 'are off the road')} (${ph('depot.off_road_share')}).${power}`
  );
}

function yardParagraph(detail: DepotDetailResponse): string {
  if (!detail.yard.value) {
    return 'No yard is established for this depot, so yard occupancy is not described here.';
  }
  const visitors =
    detail.visitors.length > 0
      ? ` Visitors from other depots in the yard: ${ph('depot.visitors')}.`
      : '';
  const evidence =
    detail.yard.value.heldSince !== undefined
      ? `The yard is kept from earlier snapshots rather than placed by this snapshot. It has been held since ${ph('depot.yard_held_since')}. `
      : `The yard is inferred from where buses park; ${ph('depot.yard_support')} ${countPhrase(detail.yard.value.inCluster, 'falls', 'fall')} inside it. `;
  return (
    evidence +
    `It currently holds ${ph('depot.in_yard')}; ${ph('depot.away')} ${countPhrase(detail.locationMix.away, 'is', 'are')} away from it.${visitors}`
  );
}

function outshedParagraph(detail: DepotDetailResponse): string | null {
  if (detail.outshed.coverage.n === 0) return null;
  const overdue =
    detail.outshed.counts.overdue > 0
      ? `${ph('depot.outshed_overdue')} overdue to leave the yard`
      : 'nothing overdue to leave the yard';
  return `Departure schedules are known for ${ph('depot.outshed_coverage')}. Of those, ${ph('depot.outshed_departed')} already away and ${overdue}.`;
}

function exceptionParagraph(detail: DepotDetailResponse): string {
  const { depot, bus } = detail.exceptions;
  if (depot.length === 0 && bus.length === 0) return 'No exceptions are flagged for this depot.';
  const kinds = [...new Set(depot.map((e) => DEPOT_EXCEPTION_PHRASE[e.kind]))];
  const atDepot =
    depot.length > 0
      ? `Flagged at depot level, for ${kinds.join(' and ')}: ${ph('depot.exceptions_depot')}.`
      : 'Nothing is flagged at depot level.';
  const onVehicles = bus.length > 0 ? ` Flagged on vehicles: ${ph('depot.exceptions_bus')}.` : '';
  return `${atDepot}${onVehicles} A closer look at ${countPhrase(depot.length + bus.length, 'this item', 'these items')} could be worthwhile.`;
}

export function depotDraft(detail: DepotDetailResponse): CopilotDraft {
  const paragraphs = [standingParagraph(detail), fleetParagraph(detail), yardParagraph(detail)];
  const outshed = outshedParagraph(detail);
  if (outshed) paragraphs.push(outshed);
  paragraphs.push(exceptionParagraph(detail));
  return { headline: `Depot briefing: ${ph('depot.name')}`, paragraphs };
}

export function buildDepotBriefing(detail: DepotDetailResponse): CopilotRequest {
  return buildRequest({
    task: 'briefing',
    scopeLabel: cleanName(detail.depot.name),
    facts: depotFacts(detail),
    guidance: GUIDANCE,
    scriptedDraft: depotDraft(detail),
  });
}
