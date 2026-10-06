import type { DepotNetworkResponse } from '@/lib/depot/api';
import {
  buildRequest,
  busCount,
  cleanName,
  countPhrase,
  depotCount,
  index1,
  makeFact,
  nameFact,
  ph,
  share,
} from '@/lib/depot/copilot/facts/format';
import type { CopilotDraft, CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import { formatFeedTime } from '@/lib/depot/format';
import { indexWindowFacts, indexWindowSentence } from '@/lib/depot/copilot/facts/window';
import type { BusExceptionKind, DepotExceptionKind } from '@/lib/depot/exceptions/types';

const DEPOT_KINDS: readonly DepotExceptionKind[] = [
  'dark_share_high',
  'off_road_high',
  'on_road_low',
  'power_cut_cluster',
];
const BUS_KINDS: readonly BusExceptionKind[] = [
  'long_dark',
  'power_cut',
  'tamper_code',
  'emergency',
];

const GUIDANCE =
  'Write a short briefing for the whole network: its scale, how much of the fleet is running, ' +
  'how much has no signal or is in maintenance, the strongest and weakest ranked depots, and ' +
  'any exceptions. Use only the supplied facts and describe rather than instruct.';

const exceptionCount = (n: number): string => `${n} ${n === 1 ? 'exception' : 'exceptions'}`;

interface RankedDepot {
  readonly name: string;
  readonly index: number;
}

function rankedDepots(network: DepotNetworkResponse): RankedDepot[] {
  const names = new Map(network.depots.map((d) => [d.id, d.name] as const));
  return network.scores
    .flatMap((s) =>
      s.ranked && s.index !== null
        ? [{ name: names.get(s.depotId) ?? s.depotId, index: s.index }]
        : [],
    )
    .sort((a, b) => b.index - a.index);
}

function networkFacts(network: DepotNetworkResponse): CopilotFact[] {
  const { kpis } = network;
  const fleet = kpis.fleet.value;
  const sum = (kinds: readonly (DepotExceptionKind | BusExceptionKind)[]): number =>
    kinds.reduce((total, kind) => total + (network.exceptionCounts[kind] ?? 0), 0);
  const facts: CopilotFact[] = [
    makeFact('network.fleet', 'Fleet', busCount(fleet), kpis.fleet.provenance),
    makeFact(
      'network.depots',
      'Depots and units',
      depotCount(kpis.depots.value),
      kpis.depots.provenance,
    ),
    makeFact(
      'network.reporting',
      'Reporting',
      busCount(kpis.reporting.value),
      kpis.reporting.provenance,
    ),
    makeFact('network.on_road', 'On the road', busCount(kpis.onRoad.value), kpis.onRoad.provenance),
    makeFact('network.on_road_share', 'On-road share', share(kpis.onRoad.value, fleet), 'derived'),
    makeFact(
      'network.no_signal',
      'No signal',
      busCount(kpis.noSignal.value),
      kpis.noSignal.provenance,
    ),
    makeFact(
      'network.no_signal_share',
      'No-signal share',
      share(kpis.noSignal.value, fleet),
      'derived',
    ),
    makeFact(
      'network.under_maintenance',
      'Under maintenance',
      busCount(kpis.underMaintenance.value),
      kpis.underMaintenance.provenance,
    ),
    makeFact(
      'network.maintenance_share',
      'Maintenance share',
      share(kpis.underMaintenance.value, fleet),
      'derived',
    ),
    makeFact(
      'network.depot_exceptions',
      'Depot exceptions',
      exceptionCount(sum(DEPOT_KINDS)),
      'derived',
    ),
    makeFact(
      'network.bus_exceptions',
      'Vehicle exceptions',
      exceptionCount(sum(BUS_KINDS)),
      'derived',
    ),
  ];
  const feedTime = formatFeedTime(network.feedNow);
  if (network.feedNow !== null && feedTime !== '—') {
    facts.push(makeFact('network.feed_time', 'Feed time', feedTime, 'live'));
  }
  const ranked = rankedDepots(network);
  const best = ranked[0];
  const weakest = ranked[ranked.length - 1];
  if (best && weakest && ranked.length >= 2) {
    facts.push(
      nameFact('network.best_depot', 'Highest-ranked depot', cleanName(best.name), 'derived'),
      makeFact('network.best_index', 'Highest index', index1(best.index), 'derived'),
      nameFact('network.weakest_depot', 'Lowest-ranked depot', cleanName(weakest.name), 'derived'),
      makeFact('network.weakest_index', 'Lowest index', index1(weakest.index), 'derived'),
      ...indexWindowFacts('network.index_window', network.scoreWindow),
    );
  }
  return facts;
}

function exceptionParagraph(depotCountN: number, busCountN: number): string {
  if (depotCountN === 0 && busCountN === 0) {
    return 'No exceptions are flagged on this snapshot, either for depots or for vehicles.';
  }
  if (depotCountN === 0) {
    return `No depot-level exceptions are flagged, though ${ph('network.bus_exceptions')} ${countPhrase(busCountN, 'is', 'are')} flagged on vehicles.`;
  }
  const vehicles =
    busCountN === 0
      ? 'nothing is flagged on vehicles'
      : `${ph('network.bus_exceptions')} ${countPhrase(busCountN, 'is', 'are')} flagged on vehicles`;
  return (
    `At depot level the snapshot flags ${ph('network.depot_exceptions')}; ${vehicles}. ` +
    'Starting with the depot-level exceptions would be a sensible order.'
  );
}

/** Below this spread in the index, naming a place to start would overstate the difference. */
const MIN_INDEX_GAP = 5;

function rankSentence(ranked: readonly RankedDepot[]): string {
  const best = ranked[0];
  const weakest = ranked[ranked.length - 1];
  if (best && weakest && best.index - weakest.index >= MIN_INDEX_GAP) {
    return ` That gap makes ${ph('network.weakest_depot')} the natural place to start.`;
  }
  return ' The ranked depots sit close together on the index.';
}

function networkDraft(network: DepotNetworkResponse): CopilotDraft {
  const fleet = network.kpis.fleet.value;
  if (fleet === 0) {
    return {
      headline: 'Network briefing: no buses in the feed',
      paragraphs: ['The feed lists no buses at the moment, so there is nothing to brief on yet.'],
    };
  }
  const hasTime = network.feedNow !== null && formatFeedTime(network.feedNow) !== '—';
  const lead = hasTime ? `As of ${ph('network.feed_time')}, ` : 'On the latest feed, ';
  const { kpis } = network;
  const ranked = rankedDepots(network);
  const paragraphs = [
    `${lead}${ph('network.reporting')} ${countPhrase(kpis.reporting.value, 'is', 'are')} reporting a position and ${ph('network.on_road')} ${countPhrase(kpis.onRoad.value, 'is', 'are')} running, ${ph('network.on_road_share')} of the fleet.`,
    `${ph('network.no_signal')} ${countPhrase(kpis.noSignal.value, 'has', 'have')} lost signal (${ph('network.no_signal_share')}) and ${ph('network.under_maintenance')} ${countPhrase(kpis.underMaintenance.value, 'is', 'are')} in maintenance (${ph('network.maintenance_share')}).`,
    ranked.length >= 2
      ? `Among ranked depots, ${ph('network.best_depot')} leads at efficiency ${ph('network.best_index')}, while ${ph('network.weakest_depot')} sits lowest at efficiency ${ph('network.weakest_index')}.${indexWindowSentence(network.scoreWindow, 'network.index_window', 'The index here covers')}${rankSentence(ranked)}`
      : 'Too few depots have enough buses to be ranked against each other on this snapshot.',
    exceptionParagraph(
      DEPOT_KINDS.reduce((n, k) => n + (network.exceptionCounts[k] ?? 0), 0),
      BUS_KINDS.reduce((n, k) => n + (network.exceptionCounts[k] ?? 0), 0),
    ),
  ];
  return {
    headline: `Network briefing: ${ph('network.fleet')} and ${ph('network.depots')}`,
    paragraphs,
  };
}

export function buildNetworkBriefing(network: DepotNetworkResponse): CopilotRequest {
  return buildRequest({
    task: 'briefing',
    scopeLabel: 'the whole network',
    facts: networkFacts(network),
    guidance: GUIDANCE,
    scriptedDraft: networkDraft(network),
  });
}
