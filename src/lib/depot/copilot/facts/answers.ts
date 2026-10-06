import type {
  DepotDetailResponse,
  DepotDistributionResponse,
  DepotNetworkResponse,
} from '@/lib/depot/api';
import type { CopilotQuery, RankMetric } from '@/lib/depot/copilot/queries';
import { buildDepotBriefing } from '@/lib/depot/copilot/facts/depot';
import {
  DEPOT_EXCEPTION_PHRASE,
  buildRequest,
  busCount,
  cleanName,
  depotCount,
  index1,
  km1,
  makeFact,
  onRoadCount,
  ph,
  share,
} from '@/lib/depot/copilot/facts/format';
import { buildNetworkBriefing } from '@/lib/depot/copilot/facts/network';
import type { CopilotDraft, CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import type { DepotBalance } from '@/lib/depot/optimise/types';
import type { UncoveredReason } from '@/lib/depot/optimise/types';

/** The views a query may need. Only `network` is always present. */
export interface AnswerData {
  readonly network: DepotNetworkResponse;
  readonly details?: Readonly<Record<string, DepotDetailResponse>>;
  readonly distribution?: DepotDistributionResponse;
}

const GUIDANCE =
  'Phrase the result of the query as a short, plain answer using only the supplied facts. ' +
  'Say plainly when something is not available or not established, describe rather than instruct.';
const MODELLED_NOTE =
  'The requirement is modelled until a network timetable is supplied, so these are planning figures rather than measured needs.';
/** Lists in an answer are the leading entries only; this keeps a request far below the fact cap. */
const MAX_LIST_ROWS = 5;
const MAX_TRANSFER_ROWS = 4;

const answer = (
  scopeLabel: string,
  facts: readonly CopilotFact[],
  draft: CopilotDraft,
): CopilotRequest =>
  buildRequest({ task: 'answer', scopeLabel, facts, guidance: GUIDANCE, scriptedDraft: draft });

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function unavailable(scope: string): CopilotRequest {
  return answer(scope, [], {
    headline: 'That answer is not available',
    paragraphs: [
      'The data needed to answer this is not available right now, so nothing can be said about it yet.',
    ],
  });
}

function unsupported(): CopilotRequest {
  return answer('an unsupported question', [], {
    headline: 'That question is outside what can be answered here',
    paragraphs: [
      'This assistant can answer questions about the network as a whole, a named depot, depot rankings, depots in deficit or surplus, proposed transfers, exceptions, comparisons between depots, and departures from the yard.',
      'Questions about people are outside that scope. A question on one of the topics above would be answered from the live data.',
    ],
  });
}

const nameOf = (data: AnswerData, id: string): string | null =>
  data.network.depots.find((d) => d.id === id)?.name ??
  data.distribution?.balances.find((b) => b.depotId === id)?.depotName ??
  data.details?.[id]?.depot.name ??
  null;

// ---- rankings ----------------------------------------------------------

const METRIC_LABEL: Readonly<Record<RankMetric, string>> = {
  index: 'efficiency index',
  onRoad: 'on-road share',
  offRoad: 'off-road rate',
  dark: 'dark rate',
  scheduled: 'schedule coverage',
};
const HIGHER_IS_BETTER: ReadonlySet<RankMetric> = new Set(['index', 'onRoad', 'scheduled']);

function rankAnswer(
  data: AnswerData,
  metric: RankMetric,
  order: 'top' | 'bottom',
  limit: number,
): CopilotRequest {
  const names = new Map(data.network.depots.map((d) => [d.id, d.name] as const));
  const rows = data.network.scores
    .flatMap((s) => {
      const value =
        metric === 'index' ? s.index : (s.components.find((c) => c.key === metric)?.value ?? null);
      return s.ranked && value !== null ? [{ name: names.get(s.depotId) ?? s.depotId, value }] : [];
    })
    .sort((a, b) => (order === 'top' ? b.value - a.value : a.value - b.value))
    .slice(0, Math.min(limit, MAX_LIST_ROWS * 2));
  const label = METRIC_LABEL[metric];
  const direction = order === 'top' ? 'Highest' : 'Lowest';
  if (rows.length === 0) {
    return answer('a depot ranking', [], {
      headline: `${direction} ${label} among ranked depots`,
      paragraphs: ['No depot can be ranked on this snapshot, so there is no list to give.'],
    });
  }
  const facts = rows.flatMap((row, i) => [
    makeFact(`rank.${i + 1}.name`, `Depot ${i + 1}`, cleanName(row.name), 'derived'),
    makeFact(
      `rank.${i + 1}.value`,
      `Value ${i + 1}`,
      metric === 'index' ? index1(row.value) : `${Math.round(row.value * 100)}%`,
      'derived',
    ),
  ]);
  const entries = rows.map((_, i) => `${ph(`rank.${i + 1}.name`)} at ${ph(`rank.${i + 1}.value`)}`);
  const sense = HIGHER_IS_BETTER.has(metric)
    ? 'A higher figure is better on this measure.'
    : 'A higher figure is worse on this measure.';
  return answer('a depot ranking', facts, {
    headline: `${direction} ${label} among ranked depots`,
    paragraphs: [
      `Leading entries by ${label}, ${direction.toLowerCase()} first: ${entries.join('; ')}.`,
      `${sense} Only the leading entries are listed, and units that are not operating depots, such as hired or electric fleets, are left out.`,
    ],
  });
}

// ---- deficit and surplus ----------------------------------------------

function balanceList(data: AnswerData, kind: 'deficit' | 'surplus'): CopilotRequest {
  const dist = data.distribution;
  if (!dist) return unavailable('the modelled balance');
  const rows: readonly DepotBalance[] = dist.balances
    .filter((b) => (kind === 'deficit' ? b.balance < 0 : b.balance > 0))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  const headline =
    kind === 'deficit'
      ? 'Depots in deficit on the modelled requirement'
      : 'Depots in surplus on the modelled requirement';
  if (rows.length === 0) {
    return answer('the modelled balance', [], {
      headline,
      paragraphs: [
        kind === 'deficit'
          ? 'On the modelled requirement no depot is in deficit.'
          : 'On the modelled requirement no depot is in surplus.',
        MODELLED_NOTE,
      ],
    });
  }
  const shown = rows.slice(0, MAX_LIST_ROWS);
  const total = rows.reduce((sum, b) => sum + Math.abs(b.balance), 0);
  const facts: CopilotFact[] = [
    makeFact('list.count', 'Depots', depotCount(rows.length), 'modelled'),
    makeFact('list.total', 'Buses in total', busCount(total), 'modelled'),
    ...shown.flatMap((b, i) => [
      makeFact(`list.${i + 1}.name`, `Depot ${i + 1}`, cleanName(b.depotName), 'live'),
      makeFact(`list.${i + 1}.size`, `Size ${i + 1}`, busCount(Math.abs(b.balance)), 'modelled'),
    ]),
  ];
  const lead =
    kind === 'deficit'
      ? `The modelled requirement puts ${ph('list.count')} short of buses, ${ph('list.total')} in all.`
      : `The modelled requirement puts ${ph('list.count')} above what they need, ${ph('list.total')} of spare buses in all.`;
  const entries = shown.map((_, i) => `${ph(`list.${i + 1}.name`)} by ${ph(`list.${i + 1}.size`)}`);
  return answer('the modelled balance', facts, {
    headline,
    paragraphs: [lead, `Leading entries: ${entries.join('; ')}.`, MODELLED_NOTE],
  });
}

// ---- transfers for one depot -------------------------------------------

const UNCOVERED_PHRASE: Readonly<Record<UncoveredReason, string>> = {
  no_surplus_in_range: 'no surplus lies within range',
  insufficient_surplus: 'the surplus within range is not enough',
  no_position: 'the depot has no known position',
  excluded: 'the depot is excluded from the plan',
};

function transfersAnswer(data: AnswerData, depotId: string): CopilotRequest {
  const dist = data.distribution;
  const name = nameOf(data, depotId);
  if (!dist || name === null) return unavailable('transfers');
  const balance = dist.balances.find((b) => b.depotId === depotId);
  const names = new Map(dist.balances.map((b) => [b.depotId, b.depotName] as const));
  const mine = dist.plan.transfers.filter(
    (t) => t.fromDepotId === depotId || t.toDepotId === depotId,
  );
  const shown = mine.slice(0, MAX_TRANSFER_ROWS);
  const facts: CopilotFact[] = [makeFact('depot.name', 'Depot', cleanName(name), 'live')];
  if (balance && balance.balance !== 0) {
    facts.push(
      makeFact(
        'depot.balance',
        'Modelled balance',
        busCount(Math.abs(balance.balance)),
        'modelled',
      ),
    );
  }
  shown.forEach((t, i) => {
    const other = t.fromDepotId === depotId ? t.toDepotId : t.fromDepotId;
    facts.push(
      makeFact(`t.${i + 1}.buses`, `Buses ${i + 1}`, busCount(t.buses), 'modelled'),
      makeFact(
        `t.${i + 1}.other`,
        `Other depot ${i + 1}`,
        cleanName(names.get(other) ?? nameOf(data, other) ?? other),
        'live',
      ),
      makeFact(`t.${i + 1}.distance`, `Distance ${i + 1}`, km1(t.distanceKm), 'derived'),
    );
  });
  const uncovered = dist.plan.uncovered.find((u) => u.depotId === depotId);
  if (uncovered) {
    facts.push(
      makeFact('t.uncovered', 'Deficit not covered', busCount(uncovered.buses), 'modelled'),
    );
  }
  const standing = !balance
    ? `No modelled balance is on record for ${ph('depot.name')}.`
    : balance.balance > 0
      ? `The modelled requirement puts ${ph('depot.name')} in surplus by ${ph('depot.balance')}.`
      : balance.balance < 0
        ? `The modelled requirement puts ${ph('depot.name')} in deficit by ${ph('depot.balance')}.`
        : `The modelled requirement puts ${ph('depot.name')} in balance.`;
  const lines = shown.map((t, i) => {
    const give = t.fromDepotId === depotId;
    return `${give ? 'Sending' : 'Receiving'} ${ph(`t.${i + 1}.buses`)} ${give ? 'to' : 'from'} ${ph(`t.${i + 1}.other`)}, about ${ph(`t.${i + 1}.distance`)} of estimated road distance.`;
  });
  const paragraphs = [
    standing,
    lines.length > 0
      ? `In the current plan: ${lines.join(' ')}`
      : 'No transfer involving this depot is proposed in the current plan.',
  ];
  if (uncovered) {
    paragraphs.push(
      `${ph('t.uncovered')} of its deficit stays uncovered because ${UNCOVERED_PHRASE[uncovered.reason]}.`,
    );
  }
  paragraphs.push(MODELLED_NOTE);
  return answer(cleanName(name), facts, {
    headline: `Transfers for ${ph('depot.name')}`,
    paragraphs,
  });
}

// ---- exceptions for one depot -----------------------------------------

function exceptionsAnswer(data: AnswerData, depotId: string): CopilotRequest {
  const detail = data.details?.[depotId];
  if (!detail) return unavailable('exceptions');
  const { depot, bus } = detail.exceptions;
  const critical = depot.filter((e) => e.severity === 'critical').length;
  const facts: CopilotFact[] = [
    makeFact('depot.name', 'Depot', cleanName(detail.depot.name), 'live'),
    makeFact(
      'ex.depot',
      'Depot-level exceptions',
      plural(depot.length, 'exception', 'exceptions'),
      'derived',
    ),
    makeFact(
      'ex.bus',
      'Vehicle exceptions',
      plural(bus.length, 'exception', 'exceptions'),
      'derived',
    ),
    makeFact(
      'ex.critical',
      'Rated critical',
      plural(critical, 'exception', 'exceptions'),
      'derived',
    ),
  ];
  const headline = `Exceptions for ${ph('depot.name')}`;
  if (depot.length === 0 && bus.length === 0) {
    return answer(cleanName(detail.depot.name), facts, {
      headline,
      paragraphs: [`No exceptions are flagged for ${ph('depot.name')} on this snapshot.`],
    });
  }
  const kinds = [...new Set(depot.map((e) => DEPOT_EXCEPTION_PHRASE[e.kind]))];
  const paragraphs: string[] = [];
  paragraphs.push(
    depot.length > 0
      ? `Flagged at depot level: ${ph('ex.depot')}, for ${kinds.join(' and ')}.${critical > 0 ? ` Rated critical: ${ph('ex.critical')}.` : ''}`
      : `Nothing is flagged at depot level for ${ph('depot.name')}.`,
  );
  if (bus.length > 0) paragraphs.push(`Flagged on vehicles: ${ph('ex.bus')}.`);
  paragraphs.push('A closer look at these items could be worthwhile.');
  return answer(cleanName(detail.depot.name), facts, { headline, paragraphs });
}

// ---- comparing two depots ---------------------------------------------

function sideFacts(data: AnswerData, side: 'a' | 'b', id: string): CopilotFact[] | null {
  const depot = data.network.depots.find((d) => d.id === id);
  if (!depot) return null;
  const score = data.network.scores.find((s) => s.depotId === id);
  const onRoad = onRoadCount(depot.states);
  const facts = [
    makeFact(`${side}.name`, 'Depot', cleanName(depot.name), 'live'),
    makeFact(`${side}.fleet`, 'Fleet', busCount(depot.fleet), 'live'),
    makeFact(`${side}.on_road_share`, 'On-road share', share(onRoad, depot.fleet), 'derived'),
    makeFact(`${side}.dark_share`, 'Dark share', share(depot.states.dark, depot.fleet), 'derived'),
    makeFact(
      `${side}.off_road_share`,
      'Off-road share',
      share(depot.states.offRoad, depot.fleet),
      'derived',
    ),
  ];
  if (score?.ranked && score.index !== null) {
    facts.push(makeFact(`${side}.index`, 'Efficiency index', index1(score.index), 'derived'));
  }
  return facts;
}

function compareAnswer(data: AnswerData, idA: string, idB: string): CopilotRequest {
  const a = sideFacts(data, 'a', idA);
  const b = sideFacts(data, 'b', idB);
  if (!a || !b) return unavailable('a comparison');
  const scoreOf = (id: string) => data.network.scores.find((s) => s.depotId === id);
  const sa = scoreOf(idA);
  const sb = scoreOf(idB);
  const indexA = sa?.ranked ? sa.index : null;
  const indexB = sb?.ranked ? sb.index : null;
  const line = (s: 'a' | 'b'): string =>
    `${ph(`${s}.name`)} has a fleet of ${ph(`${s}.fleet`)}, with ${ph(`${s}.on_road_share`)} on the road, ${ph(`${s}.dark_share`)} dark and ${ph(`${s}.off_road_share`)} off the road.`;
  let verdict: string;
  if (indexA === null || indexB === null) {
    verdict =
      'At least one of these units is not ranked, so their efficiency indices are not compared.';
  } else if (indexA === indexB) {
    verdict = `Their efficiency indices are level at ${ph('a.index')}.`;
  } else {
    const [lead, trail] = indexA > indexB ? (['a', 'b'] as const) : (['b', 'a'] as const);
    verdict = `${ph(`${lead}.name`)} has the higher efficiency index, ${ph(`${lead}.index`)} against ${ph(`${trail}.index`)}.`;
    if (sa?.peerGroup !== sb?.peerGroup) {
      verdict += ' They sit in different peer groups, so the comparison is indicative.';
    }
  }
  return answer('a comparison of depots', [...a, ...b], {
    headline: `${ph('a.name')} compared with ${ph('b.name')}`,
    paragraphs: [line('a'), line('b'), verdict],
  });
}

// ---- outshedding --------------------------------------------------------

function outshedAnswer(data: AnswerData, depotId: string): CopilotRequest {
  const detail = data.details?.[depotId];
  if (!detail) return unavailable('departures');
  const { coverage, counts, rows } = detail.outshed;
  const late = rows.filter((r) => r.minutesLate !== null && r.minutesLate > 0).length;
  const facts: CopilotFact[] = [
    makeFact('depot.name', 'Depot', cleanName(detail.depot.name), 'live'),
    makeFact(
      'outshed.coverage',
      'Schedule coverage',
      `${coverage.n} of ${coverage.of} buses`,
      'derived',
    ),
    makeFact('outshed.departed', 'Departed', busCount(counts.departed), 'derived'),
    makeFact('outshed.overdue', 'Overdue to leave', busCount(counts.overdue), 'derived'),
    makeFact('outshed.due', 'Due to leave', busCount(counts.due), 'derived'),
    makeFact('outshed.upcoming', 'Not yet due', busCount(counts.upcoming), 'derived'),
    makeFact('outshed.unknown', 'Unknown', busCount(counts.unknown), 'derived'),
    makeFact('outshed.late', 'Departed late', busCount(late), 'derived'),
  ];
  const headline = `Departures from ${ph('depot.name')}`;
  if (coverage.n === 0) {
    return answer(cleanName(detail.depot.name), facts, {
      headline,
      paragraphs: [
        `Departure schedules are not in the feed for ${ph('depot.name')}; coverage stands at ${ph('outshed.coverage')}, so outshedding cannot be assessed.`,
      ],
    });
  }
  const parts = [
    `${ph('outshed.departed')} already away`,
    counts.due > 0 ? `${ph('outshed.due')} due to leave now` : null,
    counts.upcoming > 0 ? `${ph('outshed.upcoming')} not yet due` : null,
    counts.overdue > 0
      ? `${ph('outshed.overdue')} overdue to leave the yard`
      : 'none overdue to leave the yard',
    counts.unknown > 0
      ? `${ph('outshed.unknown')} that cannot be located well enough to say`
      : null,
  ].filter((p): p is string => p !== null);
  const body = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const paragraphs = [
    `Schedules are known for ${ph('outshed.coverage')} at ${ph('depot.name')}.`,
    `Of those, ${body}.`,
  ];
  if (late > 0) paragraphs.push(`Departed later than scheduled: ${ph('outshed.late')}.`);
  return answer(cleanName(detail.depot.name), facts, { headline, paragraphs });
}

// ---- entry point --------------------------------------------------------

export function buildAnswer(query: CopilotQuery, data: AnswerData): CopilotRequest {
  switch (query.kind) {
    case 'networkSummary':
      return { ...buildNetworkBriefing(data.network), task: 'answer' };
    case 'depotSummary': {
      const detail = data.details?.[query.depotId];
      return detail ? { ...buildDepotBriefing(detail), task: 'answer' } : unavailable('that depot');
    }
    case 'rankDepots':
      return rankAnswer(data, query.metric, query.order, query.limit);
    case 'depotsInDeficit':
      return balanceList(data, 'deficit');
    case 'depotsInSurplus':
      return balanceList(data, 'surplus');
    case 'transfersFor':
      return transfersAnswer(data, query.depotId);
    case 'exceptionsFor':
      return exceptionsAnswer(data, query.depotId);
    case 'compareDepots':
      return compareAnswer(data, query.depotA, query.depotB);
    case 'outshedStatus':
      return outshedAnswer(data, query.depotId);
    case 'unsupported':
      return unsupported();
  }
}
