import { describe, expect, it } from 'vitest';
import type {
  DepotDetailResponse,
  DepotDistributionResponse,
  DepotNetworkResponse,
} from '@/lib/depot/api';
import { buildAnswer, type AnswerData } from '@/lib/depot/copilot/facts/answers';
import { buildDepotBriefing } from '@/lib/depot/copilot/facts/depot';
import { buildNetworkBriefing } from '@/lib/depot/copilot/facts/network';
import { buildRequest } from '@/lib/depot/copilot/facts/format';
import { buildTransferRationale } from '@/lib/depot/copilot/facts/transfer';
import type { CopilotQuery } from '@/lib/depot/copilot/queries';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import type { ExceptionKind } from '@/lib/depot/exceptions/types';
import type { OutshedSummary } from '@/lib/depot/infer/types';
import type { DepotBalance } from '@/lib/depot/optimise/types';
import type { DeiComponent, DepotScore } from '@/lib/depot/score/types';
import type { DepotKind, DepotSummary, Figure, Provenance, StateMix } from '@/lib/depot/types';

// ---- shared bounds ----------------------------------------------------------

const PLACEHOLDER = /\{\{fact:[a-z0-9][a-z0-9_.-]{0,63}\}\}/g;
const MAX_FACTS = 60;
const MAX_FACT_TEXT = 120;

// ---- factories ---------------------------------------------------------------

const fig = (value: number, provenance: Provenance = 'live'): Figure => ({ value, provenance });
const states = (o: Partial<StateMix> = {}): StateMix => ({
  inService: 0,
  onRoad: 0,
  standing: 0,
  dark: 0,
  offRoad: 0,
  ...o,
});

function makeDepot(
  id: string,
  name: string,
  kind: DepotKind = 'depot',
  o: Partial<StateMix> = {},
): DepotSummary {
  const s = states({ inService: 60, onRoad: 10, standing: 20, dark: 6, offRoad: 4, ...o });
  const fleet = s.inService + s.onRoad + s.standing + s.dark + s.offRoad;
  return {
    id,
    name,
    kind,
    fleet,
    states: s,
    status: { live: 0, stationary: 0, noSignal: 0, underMaintenance: 0, unknown: 0 },
    reporting: fleet - s.dark,
    positioned: fleet,
    assigned: s.inService,
    powerCut: 0,
    tamperFlagged: 0,
    centroid: null,
  };
}

const component = (key: DeiComponent['key'], contribution: number): DeiComponent => ({
  key,
  value: 0.4,
  peerMedian: 0.4,
  z: contribution,
  contribution,
});

function makeScore(depotId: string, o: Partial<DepotScore> = {}): DepotScore {
  return {
    depotId,
    peerGroup: 'medium',
    ranked: true,
    reason: 'ok',
    index: 61.25,
    rank: 2,
    peerCount: 12,
    components: [
      component('onRoad', 0.9),
      component('offRoad', 0.1),
      component('dark', -0.7),
      component('scheduled', 0.2),
      component('deviceHealth', 0.0),
    ],
    ...o,
  };
}

const NO_EXCEPTIONS: Record<ExceptionKind, number> = {
  dark_share_high: 0,
  off_road_high: 0,
  on_road_low: 0,
  power_cut_cluster: 0,
  long_dark: 0,
  power_cut: 0,
  tamper_code: 0,
  emergency: 0,
};

function makeNetwork(
  o: {
    names?: readonly string[];
    counts?: Partial<Record<ExceptionKind, number>>;
    scores?: DepotScore[];
    stale?: boolean;
  } = {},
): DepotNetworkResponse {
  const [a = 'KANPUR', b = 'ETAWAH', c = 'AGRA CANTT'] = o.names ?? [];
  const depots = [
    makeDepot('101', a),
    makeDepot('102', b, 'depot', { dark: 30 }),
    makeDepot('103', c),
    makeDepot('900', 'HIRED FLEET', 'hired'),
  ];
  return {
    feedNow: '2026-10-06T14:05:00Z',
    fetchedAt: '2026-10-06T14:05:10Z',
    source: 'live',
    stale: o.stale ?? false,
    depots,
    recordCount: 400,
    coverage: [],
    kpis: {
      fleet: fig(400),
      depots: fig(4),
      reporting: fig(380),
      onRoad: fig(210, 'derived'),
      stationary: fig(100),
      noSignal: fig(20),
      underMaintenance: fig(16),
      assigned: fig(250, 'derived'),
    },
    scores: o.scores ?? [
      makeScore('101', { index: 71.2, rank: 1, peerCount: 3 }),
      makeScore('102', { index: 48, rank: 2, peerCount: 3 }),
      makeScore('103', { index: 30.4, rank: 3, peerCount: 3 }),
      makeScore('900', {
        ranked: false,
        reason: 'not_a_depot',
        index: null,
        rank: null,
        peerCount: null,
        peerGroup: null,
      }),
    ],
    exceptionCounts: { ...NO_EXCEPTIONS, ...o.counts },
    exceptionSeverityCounts: { critical: 0, warning: 0, info: 0 },
  };
}

const EMPTY_OUTSHED: OutshedSummary = {
  rows: [],
  counts: { upcoming: 0, due: 0, departed: 0, overdue: 0, ended: 0, unknown: 0 },
  coverage: { n: 0, of: 100 },
};
const SCHEDULED_OUTSHED: OutshedSummary = {
  rows: [
    {
      registrationNumber: 'UP00X0001',
      routeName: 'R',
      journeyCode: 'J',
      scheduledStart: '2026-10-06T06:00:00Z',
      scheduledEnd: null,
      state: 'departed',
      minutesLate: 7,
      minutesOverdue: null,
      evidence: 'actual_time',
    },
  ],
  counts: { upcoming: 3, due: 1, departed: 40, overdue: 2, ended: 5, unknown: 4 },
  coverage: { n: 55, of: 100 },
};

function makeDetail(
  o: {
    depot?: DepotSummary;
    score?: DepotScore | null;
    yard?: boolean;
    outshed?: OutshedSummary;
    critical?: boolean;
    withExceptions?: boolean;
  } = {},
): DepotDetailResponse {
  const depot = o.depot ?? makeDepot('101', 'KANPUR');
  return {
    feedNow: '2026-10-06T14:05:00Z',
    fetchedAt: '2026-10-06T14:05:10Z',
    source: 'live',
    stale: false,
    depot,
    score: o.score === undefined ? makeScore(depot.id) : o.score,
    yard: {
      value:
        o.yard === false ? null : { lat: 26.4, lng: 80.3, radiusM: 300, parked: 40, inCluster: 33 },
      provenance: 'derived',
    },
    buses: [],
    locationMix: { in_yard: 25, at_other_yard: 2, away: 70, unknown: 3 },
    outshed: o.outshed ?? EMPTY_OUTSHED,
    exceptions: {
      depot: o.withExceptions
        ? [
            {
              id: 'dark_share_high:101',
              depotId: depot.id,
              depotName: depot.name,
              kind: 'dark_share_high',
              severity: o.critical ? 'critical' : 'warning',
              value: 0.3,
              peerMedian: 0.1,
              z: 2,
              affected: 30,
              fleet: 100,
            },
          ]
        : [],
      bus: o.withExceptions
        ? [
            {
              id: 'long_dark:UP1',
              registrationNumber: 'UP1',
              depotId: depot.id,
              depotName: depot.name,
              kind: 'long_dark',
              severity: 'warning',
              lastSeen: null,
              detail: null,
            },
          ]
        : [],
    },
    visitors: [
      {
        registrationNumber: 'UP2',
        homeDepotId: '102',
        homeDepotName: 'ETAWAH',
        state: 'standing',
        position: null,
      },
    ],
  };
}

const balance = (id: string, name: string, bal: number): DepotBalance => ({
  depotId: id,
  depotName: name,
  kind: 'depot',
  fleet: 100,
  offRoad: 4,
  available: 96,
  peakRequirement: 80,
  spareTarget: 8,
  required: 96 - bal,
  balance: bal,
  position: null,
});

function makeDistribution(names: readonly string[] = []): DepotDistributionResponse {
  const [a = 'KANPUR', b = 'ETAWAH', c = 'AGRA CANTT'] = names;
  return {
    feedNow: '2026-10-06T14:05:00Z',
    fetchedAt: '2026-10-06T14:05:10Z',
    source: 'live',
    stale: false,
    operatingDate: '2026-10-06',
    requirementParams: {
      spareRatio: 0.1,
      baseUtilisation: 0.8,
      utilisationSensitivity: 0.5,
      noise: 0.05,
    },
    rebalanceParams: {
      maxTransferKm: 250,
      detourFactor: 1.3,
      lockedDepotIds: [],
      excludedDepotIds: [],
    },
    balances: [
      balance('101', a, 9),
      balance('102', b, -6),
      balance('103', c, -3),
      balance('104', 'GORAKHPUR', 0),
    ],
    plan: {
      transfers: [
        {
          id: '101>102',
          fromDepotId: '101',
          toDepotId: '102',
          buses: 6,
          distanceKm: 142.34,
          busKm: 854,
        },
      ],
      before: { depotsInDeficit: 2, depotsInSurplus: 1, totalDeficit: 9, totalSurplus: 9 },
      after: { depotsInDeficit: 1, depotsInSurplus: 1, totalDeficit: 3, totalSurplus: 3 },
      coveredDeficit: 6,
      totalBusKm: 854,
      uncovered: [{ depotId: '103', buses: 3, reason: 'no_surplus_in_range' }],
    },
  };
}

function makeData(names: readonly string[] = []): AnswerData {
  return {
    network: makeNetwork({ names }),
    details: {
      '101': makeDetail({ withExceptions: true, critical: true, outshed: SCHEDULED_OUTSHED }),
      '102': makeDetail({ depot: makeDepot('102', names[1] ?? 'ETAWAH') }),
    },
    distribution: makeDistribution(names),
  };
}

// ---- every request, checked the same way ---------------------------------------

const QUERIES: readonly CopilotQuery[] = [
  { kind: 'networkSummary' },
  { kind: 'depotSummary', depotId: '101' },
  { kind: 'rankDepots', metric: 'index', order: 'top', limit: 10 },
  { kind: 'rankDepots', metric: 'dark', order: 'bottom', limit: 2 },
  { kind: 'rankDepots', metric: 'onRoad', order: 'top', limit: 1 },
  { kind: 'depotsInDeficit' },
  { kind: 'depotsInSurplus' },
  { kind: 'transfersFor', depotId: '101' },
  { kind: 'transfersFor', depotId: '102' },
  { kind: 'transfersFor', depotId: '103' },
  { kind: 'exceptionsFor', depotId: '101' },
  { kind: 'exceptionsFor', depotId: '102' },
  { kind: 'compareDepots', depotA: '101', depotB: '102' },
  { kind: 'compareDepots', depotA: '101', depotB: '103' },
  { kind: 'outshedStatus', depotId: '101' },
  { kind: 'outshedStatus', depotId: '102' },
  { kind: 'unsupported' },
];

const ALL_ONE: Partial<StateMix> = { inService: 0, onRoad: 1, standing: 0, dark: 1, offRoad: 1 };

/** Every network count exactly one, so each singular verb form is rendered. */
function oneEachNetwork(): DepotNetworkResponse {
  const net = makeNetwork({ counts: { long_dark: 1 } });
  return {
    ...net,
    kpis: {
      ...net.kpis,
      reporting: fig(1),
      onRoad: fig(1, 'derived'),
      noSignal: fig(1),
      underMaintenance: fig(1),
    },
  };
}

/** Every depot count exactly one, a one-bus yard and a single depot-level exception. */
function oneEachDetail(): DepotDetailResponse {
  const base = makeDetail({
    withExceptions: true,
    depot: makeDepot('101', 'KANPUR', 'depot', ALL_ONE),
  });
  const yard = {
    value: { lat: 26.4, lng: 80.3, radiusM: 300, parked: 40, inCluster: 1 },
    provenance: 'derived' as const,
  };
  return { ...base, yard, exceptions: { depot: base.exceptions.depot, bus: [] } };
}

const UNSUPPORTED_REASONS = [undefined, 'out_of_scope', 'people', 'ambiguous_depot'] as const;

function allRequests(data: AnswerData = makeData()): [string, CopilotRequest][] {
  const dist = data.distribution ?? makeDistribution();
  const first = data.details?.['101'] ?? makeDetail();
  const transfer = dist.plan.transfers[0];
  if (!transfer) throw new Error('fixture needs a transfer');
  return [
    ['network, no exceptions', buildNetworkBriefing(data.network)],
    [
      'network, exceptions',
      buildNetworkBriefing(
        makeNetwork({ counts: { dark_share_high: 2, long_dark: 5 }, stale: true }),
      ),
    ],
    [
      'network, vehicle exceptions only',
      buildNetworkBriefing(makeNetwork({ counts: { long_dark: 5 } })),
    ],
    ['network, nothing ranked', buildNetworkBriefing(makeNetwork({ scores: [] }))],
    ['ranked depot', buildDepotBriefing(first)],
    ['strong depot', buildDepotBriefing(makeDetail({ score: makeScore('101', { rank: 1 }) }))],
    ['weak depot', buildDepotBriefing(makeDetail({ score: makeScore('101', { rank: 11 }) }))],
    [
      'unranked unit',
      buildDepotBriefing(
        makeDetail({
          depot: makeDepot('900', 'HIRED FLEET', 'hired'),
          score: makeScore('900', {
            ranked: false,
            reason: 'not_a_depot',
            index: null,
            rank: null,
            peerCount: null,
            peerGroup: null,
          }),
        }),
      ),
    ],
    [
      'too small',
      buildDepotBriefing(
        makeDetail({
          score: makeScore('101', {
            ranked: false,
            reason: 'fleet_too_small',
            index: null,
            rank: null,
            peerCount: null,
            peerGroup: null,
          }),
        }),
      ),
    ],
    ['no score', buildDepotBriefing(makeDetail({ score: null }))],
    ['no yard', buildDepotBriefing(makeDetail({ yard: false }))],
    [
      'empty depot',
      buildDepotBriefing(
        makeDetail({
          depot: makeDepot('101', 'EMPTY', 'depot', {
            inService: 0,
            onRoad: 0,
            standing: 0,
            dark: 0,
            offRoad: 0,
          }),
        }),
      ),
    ],
    ['transfer', buildTransferRationale(transfer, dist)],
    [
      'transfer beyond the maximum distance',
      buildTransferRationale(transfer, {
        ...dist,
        rebalanceParams: { ...dist.rebalanceParams, maxTransferKm: 100 },
      }),
    ],
    ['network, every count one', buildNetworkBriefing(oneEachNetwork())],
    ['depot, every count one', buildDepotBriefing(oneEachDetail())],
    ...UNSUPPORTED_REASONS.map((reason): [string, CopilotRequest] => [
      `unsupported, ${reason ?? 'no reason'}`,
      buildAnswer(
        reason === undefined ? { kind: 'unsupported' } : { kind: 'unsupported', reason },
        data,
      ),
    ]),
    ['transfer without balances', buildTransferRationale(transfer, { ...dist, balances: [] })],
    ...QUERIES.map((q): [string, CopilotRequest] => [
      `${q.kind} ${JSON.stringify(q)}`,
      buildAnswer(q, data),
    ]),
    ['answer without data', buildAnswer({ kind: 'depotsInDeficit' }, { network: data.network })],
    [
      'detail without data',
      buildAnswer({ kind: 'outshedStatus', depotId: '101' }, { network: data.network }),
    ],
  ];
}

const proseOf = (r: CopilotRequest): string =>
  [r.scriptedDraft.headline, ...r.scriptedDraft.paragraphs].join('\n');

describe('scripted drafts', () => {
  it.each(allRequests())(
    '%s renders through renderDraft, the one source of the draft rules',
    (_label, request) => {
      const rendered = renderDraft(request.scriptedDraft, request.facts);
      expect(rendered).toMatchObject({ ok: true });
      if (!rendered.ok) return;
      const ids = new Set(request.facts.map((f) => f.id));
      expect(rendered.usedFactIds.every((id) => ids.has(id))).toBe(true);
      expect(proseOf(request).replace(PLACEHOLDER, ' ')).not.toMatch(/\d/);
    },
  );

  it.each(allRequests())('%s has unique, well-formed, bounded facts', (_label, request) => {
    const ids = request.facts.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(request.facts.length).toBeLessThanOrEqual(MAX_FACTS);
    for (const f of request.facts) {
      expect(f.id).toMatch(/^[a-z0-9][a-z0-9_.-]{0,63}$/);
      expect(f.text.length).toBeLessThanOrEqual(MAX_FACT_TEXT);
      expect(f.label.length).toBeLessThanOrEqual(40);
    }
    expect(request.guidance.length).toBeGreaterThan(0);
  });

  it('never mentions a person and never instructs', () => {
    for (const [, request] of allRequests()) {
      expect(proseOf(request)).not.toMatch(/\b(crew|drivers?|conductors?|you must|do this now)\b/i);
    }
  });
});

describe('network briefing', () => {
  it('says plainly when there are no exceptions', () => {
    const prose = proseOf(buildNetworkBriefing(makeNetwork()));
    expect(prose).toContain('No exceptions are flagged');
    expect(prose).not.toMatch(/network\.depot_exceptions/);
  });

  it('refers to the exception counts when there are some', () => {
    const request = buildNetworkBriefing(
      makeNetwork({ counts: { dark_share_high: 2, long_dark: 5 } }),
    );
    expect(proseOf(request)).toContain('{{fact:network.depot_exceptions}}');
    expect(request.facts.find((f) => f.id === 'network.depot_exceptions')?.text).toBe(
      '2 exceptions',
    );
    expect(request.facts.find((f) => f.id === 'network.bus_exceptions')?.text).toBe('5 exceptions');
  });

  it('formats facts with the depot formatters and carries real provenance', () => {
    const request = buildNetworkBriefing(makeNetwork());
    const by = (id: string) => request.facts.find((f) => f.id === id);
    expect(by('network.fleet')).toMatchObject({ text: '400 buses', provenance: 'live' });
    expect(by('network.on_road_share')?.text).toBe('53%');
    expect(by('network.best_depot')?.text).toBe('KANPUR');
    expect(by('network.best_index')?.text).toBe('71.2');
    expect(by('network.weakest_depot')?.text).toBe('AGRA CANTT');
    expect(request.task).toBe('briefing');
  });

  it('notes stale data and a network that ranks too few depots', () => {
    const stale = proseOf(buildNetworkBriefing(makeNetwork({ stale: true, scores: [] })));
    expect(stale).toContain('marked stale');
    expect(stale).toContain('Too few depots');
  });
});

describe('depot briefing', () => {
  it('names the strongest and weakest component for a ranked depot', () => {
    const request = buildDepotBriefing(makeDetail());
    const by = (id: string) => request.facts.find((f) => f.id === id)?.text;
    expect(by('depot.index')).toBe('61.3');
    expect(by('depot.rank')).toBe('2 of 12');
    expect(by('depot.strongest_component')).toBe('On-road share');
    expect(by('depot.weakest_component')).toBe('Dark rate');
    expect(proseOf(request)).toContain('{{fact:depot.weakest_component}}');
  });

  it('says why an unranked unit is not ranked and offers no weakest component', () => {
    const unit = makeDetail({
      depot: makeDepot('900', 'HIRED FLEET', 'hired'),
      score: makeScore('900', {
        ranked: false,
        reason: 'not_a_depot',
        index: null,
        rank: null,
        peerCount: null,
        peerGroup: null,
      }),
    });
    const request = buildDepotBriefing(unit);
    expect(proseOf(request)).toContain('not ranked');
    expect(
      request.facts.some((f) => f.id === 'depot.weakest_component' || f.id === 'depot.index'),
    ).toBe(false);
    const small = buildDepotBriefing(
      makeDetail({
        score: makeScore('101', {
          ranked: false,
          reason: 'fleet_too_small',
          index: null,
          rank: null,
          peerCount: null,
          peerGroup: null,
        }),
      }),
    );
    expect(proseOf(small)).toContain('too small');
  });

  it('differs between a strong and a weak depot', () => {
    const strong = proseOf(
      buildDepotBriefing(makeDetail({ score: makeScore('101', { rank: 1 }) })),
    );
    const weak = proseOf(buildDepotBriefing(makeDetail({ score: makeScore('101', { rank: 11 }) })));
    expect(strong).toContain('upper part of its peer group');
    expect(weak).toContain('lower part of its peer group');
    expect(weak).toContain('weighing on the index hardest');
    expect(strong).not.toContain('weighing on the index hardest');
  });

  it('says the yard is not established and does not describe occupancy', () => {
    const request = buildDepotBriefing(makeDetail({ yard: false }));
    expect(proseOf(request)).toContain('No yard is established');
    expect(proseOf(request)).not.toContain('depot.in_yard');
    expect(
      request.facts.some((f) => f.id.startsWith('depot.yard') || f.id === 'depot.in_yard'),
    ).toBe(false);
  });

  it('describes the yard when one is established', () => {
    const request = buildDepotBriefing(makeDetail());
    expect(proseOf(request)).toContain('{{fact:depot.in_yard}}');
    expect(request.facts.find((f) => f.id === 'depot.yard_support')?.text).toBe(
      '33 of 40 parked buses',
    );
  });

  it('adds an outshedding section only when coverage is not zero, and states the coverage', () => {
    const none = buildDepotBriefing(makeDetail());
    expect(proseOf(none)).not.toContain('Departure schedules');
    expect(none.facts.some((f) => f.id.startsWith('depot.outshed'))).toBe(false);
    const some = buildDepotBriefing(makeDetail({ outshed: SCHEDULED_OUTSHED }));
    expect(proseOf(some)).toContain('{{fact:depot.outshed_coverage}}');
    expect(some.facts.find((f) => f.id === 'depot.outshed_coverage')?.text).toBe('55 of 100 buses');
  });

  it('reports exceptions when present and says none when absent', () => {
    expect(proseOf(buildDepotBriefing(makeDetail()))).toContain('No exceptions are flagged');
    const flagged = proseOf(buildDepotBriefing(makeDetail({ withExceptions: true })));
    expect(flagged).toContain('{{fact:depot.exceptions_depot}}');
    expect(flagged).toContain('a high share of buses that have gone dark');
  });
});

describe('transfer rationale', () => {
  it('states surplus, deficit, distance and that the requirement is modelled', () => {
    const dist = makeDistribution();
    const transfer = dist.plan.transfers[0];
    if (!transfer) throw new Error('fixture needs a transfer');
    const request = buildTransferRationale(transfer, dist);
    const prose = proseOf(request);
    const by = (id: string) => request.facts.find((f) => f.id === id);
    expect(request.task).toBe('rationale');
    expect(by('transfer.buses')).toMatchObject({ text: '6 buses', provenance: 'modelled' });
    expect(by('transfer.distance_km')?.text).toBe('142.3 km');
    expect(by('transfer.from_surplus')).toMatchObject({ text: '9 buses', provenance: 'modelled' });
    expect(by('transfer.to_deficit')).toMatchObject({ text: '6 buses', provenance: 'modelled' });
    for (const id of ['transfer.from_surplus', 'transfer.to_deficit', 'transfer.distance_km']) {
      expect(prose).toContain(`{{fact:${id}}}`);
    }
    expect(prose).toContain('modelled');
    expect(prose).toContain('would have its deficit closed');
  });
});

describe('answers', () => {
  const data = makeData();
  const by = (r: CopilotRequest, id: string) => r.facts.find((f) => f.id === id)?.text;

  it('ranks only ranked depots, in the requested order, as the leading entries', () => {
    const top = buildAnswer({ kind: 'rankDepots', metric: 'index', order: 'top', limit: 2 }, data);
    expect(top.task).toBe('answer');
    expect(by(top, 'rank.1.name')).toBe('KANPUR');
    expect(by(top, 'rank.2.name')).toBe('ETAWAH');
    expect(by(top, 'rank.3.name')).toBeUndefined();
    expect(proseOf(top)).toContain('leading entries');
    const bottom = buildAnswer(
      { kind: 'rankDepots', metric: 'index', order: 'bottom', limit: 1 },
      data,
    );
    expect(by(bottom, 'rank.1.name')).toBe('AGRA CANTT');
  });

  it('keeps even the longest ranking well under the fact cap', () => {
    const request = buildAnswer(
      { kind: 'rankDepots', metric: 'index', order: 'top', limit: 10 },
      data,
    );
    expect(request.facts.length).toBeLessThanOrEqual(20);
  });

  it('says the requirement is modelled for deficit and surplus lists', () => {
    const deficit = buildAnswer({ kind: 'depotsInDeficit' }, data);
    expect(by(deficit, 'list.count')).toBe('2 depots');
    expect(by(deficit, 'list.total')).toBe('9 buses');
    expect(deficit.facts.every((f) => f.provenance === 'modelled' || f.provenance === 'live')).toBe(
      true,
    );
    expect(proseOf(deficit)).toContain('modelled');
    const surplus = buildAnswer({ kind: 'depotsInSurplus' }, data);
    expect(by(surplus, 'list.1.name')).toBe('KANPUR');
    const empty = buildAnswer(
      { kind: 'depotsInDeficit' },
      { ...data, distribution: { ...makeDistribution(), balances: [] } },
    );
    expect(proseOf(empty)).toContain('no depot is in deficit');
  });

  it('lists transfers for a depot, including a deficit left uncovered', () => {
    const giver = buildAnswer({ kind: 'transfersFor', depotId: '101' }, data);
    expect(proseOf(giver)).toContain('Sending {{fact:t.1.buses}} to {{fact:t.1.other}}');
    const receiver = buildAnswer({ kind: 'transfersFor', depotId: '102' }, data);
    expect(proseOf(receiver)).toContain('Receiving');
    const uncovered = buildAnswer({ kind: 'transfersFor', depotId: '103' }, data);
    expect(proseOf(uncovered)).toContain('no surplus lies within range');
    expect(proseOf(uncovered)).toContain('No transfer involving this depot');
  });

  it('answers exceptions, comparisons and departures from the right views', () => {
    const exceptions = buildAnswer({ kind: 'exceptionsFor', depotId: '101' }, data);
    expect(proseOf(exceptions)).toContain('Rated critical');
    expect(proseOf(buildAnswer({ kind: 'exceptionsFor', depotId: '102' }, data))).toContain(
      'No exceptions are flagged',
    );
    const compare = buildAnswer({ kind: 'compareDepots', depotA: '101', depotB: '102' }, data);
    expect(proseOf(compare)).toContain('{{fact:a.name}} has the higher efficiency index');
    expect(
      proseOf(buildAnswer({ kind: 'compareDepots', depotA: '101', depotB: '900' }, data)),
    ).toContain('not ranked');
    const outshed = buildAnswer({ kind: 'outshedStatus', depotId: '101' }, data);
    expect(proseOf(outshed)).toContain('{{fact:outshed.late}}');
    const unscheduled = buildAnswer({ kind: 'outshedStatus', depotId: '102' }, data);
    expect(proseOf(unscheduled)).toContain('cannot be assessed');
    expect(proseOf(unscheduled)).toContain('{{fact:outshed.coverage}}');
  });

  it('gives a short, polite draft for an unsupported question', () => {
    const request = buildAnswer({ kind: 'unsupported' }, data);
    const prose = proseOf(request);
    expect(request.facts).toEqual([]);
    expect(prose).toContain('can answer questions about');
    expect(prose.length).toBeLessThan(600);
  });

  it('words an unsupported answer by its reason', () => {
    const prose = (reason?: 'out_of_scope' | 'people' | 'ambiguous_depot'): string =>
      proseOf(
        buildAnswer(
          reason === undefined ? { kind: 'unsupported' } : { kind: 'unsupported', reason },
          data,
        ),
      );
    expect(prose('ambiguous_depot')).toContain(
      "That name matches more than one depot. Use the depot's full name.",
    );
    expect(prose('ambiguous_depot')).not.toMatch(/people/i);
    expect(prose('people')).toContain('Questions about people are outside that scope.');
    for (const generic of [prose(), prose('out_of_scope')]) {
      expect(generic).toContain('can answer questions about');
      expect(generic).not.toMatch(/people|matches more than one/i);
    }
  });

  it('says an answer is unavailable instead of inventing one', () => {
    const request = buildAnswer(
      { kind: 'transfersFor', depotId: '101' },
      { network: data.network },
    );
    expect(request.facts).toEqual([]);
    expect(proseOf(request)).toContain('not available');
  });
});

function paragraphsOf(request: CopilotRequest): readonly string[] {
  const rendered = renderDraft(request.scriptedDraft, request.facts);
  if (!rendered.ok) throw new Error(rendered.reason);
  return rendered.paragraphs;
}

describe('pinned scripted phrasing', () => {
  const data = makeData();
  const dist = makeDistribution();
  const transfer = dist.plan.transfers[0];
  if (!transfer) throw new Error('fixture needs a transfer');
  const caveat =
    'The requirement is modelled until a network timetable is supplied, so these figures are a planning estimate rather than a measured need.';
  const unassessed = `${caveat} The move cannot be assessed from the available modelled balances, so the network team may wish to review it before relying on it.`;
  const closing = (d: DepotDistributionResponse) =>
    paragraphsOf(buildTransferRationale(transfer, d)).at(-1);

  it('writes the fleet paragraph and the standing sentence', () => {
    const p = paragraphsOf(buildDepotBriefing(makeDetail()));
    expect(p[0]).toContain(
      'a rank of 2 of 12 within mid-sized depots. Its strongest component is On-road share; the weakest, Dark rate, is the natural place to look for further gains.',
    );
    expect(p[1]).toBe(
      'Of 100 buses homed here, 70 are on the road (70%), 6 are dark (6%) and 4 are off the road (4%).',
    );
  });

  it('writes the network opening and conditions the place-to-start sentence', () => {
    const p = paragraphsOf(buildNetworkBriefing(data.network));
    expect(p[0]).toBe(
      'As of 14:05, 380 buses are reporting a position and 210 buses are running, 53% of the fleet.',
    );
    expect(p[2]).toContain('That gap makes AGRA CANTT the natural place to start.');
  });

  it('writes list leads, the uncovered deficit and the outshed counts', () => {
    expect(paragraphsOf(buildAnswer({ kind: 'depotsInSurplus' }, data))[0]).toBe(
      'The modelled requirement shows spare buses at 1 depot, 9 buses in all.',
    );
    expect(paragraphsOf(buildAnswer({ kind: 'transfersFor', depotId: '103' }, data))).toContain(
      'Left uncovered in the current plan: 3 buses, because no surplus lies within range.',
    );
    expect(paragraphsOf(buildAnswer({ kind: 'outshedStatus', depotId: '101' }, data))[1]).toContain(
      '5 buses whose scheduled window is already over',
    );
  });

  it('makes the transfer closing paragraph depend on the modelled balances', () => {
    expect(closing(dist)).toBe(
      `${caveat} On the modelled figures the surplus at KANPUR covers the move and ETAWAH has a deficit it would ease; the network team may wish to confirm it.`,
    );
    expect(closing({ ...dist, balances: [] })).toBe(unassessed);
    const giver = (balance: number) =>
      dist.balances.map((b) => (b.depotId === '101' ? { ...b, balance } : b));
    expect(closing({ ...dist, balances: giver(0) })).toBe(unassessed);
    expect(closing({ ...dist, balances: giver(4) })).toBe(unassessed);
    const request = buildTransferRationale(transfer, dist);
    expect(request.facts.find((f) => f.id === 'transfer.from_name')?.text).toBe('KANPUR');
    expect(request.facts.find((f) => f.id === 'transfer.to_name')?.text).toBe('ETAWAH');
    expect(paragraphsOf(request)[1]).toContain(
      "within the planner's configured maximum of 250.0 km.",
    );
  });

  it('says the move is beyond the maximum, never supported, when the distance exceeds it', () => {
    const far = { ...dist, rebalanceParams: { ...dist.rebalanceParams, maxTransferKm: 100 } };
    expect(closing(far)).toBe(
      `${caveat} The modelled balances alone would suit the move, but the distance is beyond the planner's maximum, so the network team may wish to review it before relying on it.`,
    );
    expect(closing(far)).not.toContain('covers the move');
    const edge = { ...dist, rebalanceParams: { ...dist.rebalanceParams, maxTransferKm: 142.34 } };
    expect(closing(edge)).toContain('covers the move');
  });

  it('singles out no component on a tie and fails loudly on a duplicate fact id', () => {
    const keys = ['onRoad', 'offRoad', 'dark', 'scheduled', 'deviceHealth'] as const;
    const tied = makeScore('101', { components: keys.map((k) => component(k, 0.2)) });
    const request = buildDepotBriefing(makeDetail({ score: tied }));
    expect(request.facts.some((f) => f.id.endsWith('_component'))).toBe(false);
    const fact = { id: 'a.b', label: 'x', text: 'y', provenance: 'live' } as const;
    expect(() =>
      buildRequest({
        task: 'answer',
        scopeLabel: 's',
        facts: [fact, fact],
        guidance: 'g',
        scriptedDraft: { headline: 'H', paragraphs: ['P'] },
      }),
    ).toThrow(/Duplicate copilot fact id/);
  });
});

describe('hostile text in data', () => {
  const HOSTILE = '{{fact:x}} <b>7 three</b>\nhttp://evil.test `rm`';

  it('stays inert in every builder', () => {
    const data = makeData([HOSTILE, HOSTILE, HOSTILE]);
    const requests = allRequests({
      ...data,
      details: {
        '101': makeDetail({
          depot: makeDepot('101', HOSTILE),
          withExceptions: true,
          outshed: SCHEDULED_OUTSHED,
        }),
      },
    });
    const extra = buildDepotBriefing(makeDetail({ depot: makeDepot('101', HOSTILE) }));
    for (const [label, request] of [
      ...requests,
      ['hostile depot', extra] as [string, CopilotRequest],
    ]) {
      expect(proseOf(request), label).not.toContain('evil');
      expect(proseOf(request), label).not.toContain('<b>');
      const rendered = renderDraft(request.scriptedDraft, request.facts);
      expect(rendered, label).toMatchObject({ ok: true });
      for (const f of request.facts) {
        expect(f.text, f.id).not.toMatch(/[\n\r\t]/);
        expect(f.text.length).toBeLessThanOrEqual(MAX_FACT_TEXT);
      }
    }
  });

  it('is substituted in sanitised form and never re-scanned', () => {
    const rendered = renderDraft(
      buildDepotBriefing(makeDetail({ depot: makeDepot('101', HOSTILE) })).scriptedDraft,
      buildDepotBriefing(makeDetail({ depot: makeDepot('101', HOSTILE) })).facts,
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    // The sanitiser strips braces, angle brackets and backticks from fact text,
    // so the inner placeholder survives only as inert words and is never expanded.
    expect(rendered.headline).toContain('fact:x b7 three/b http://evil.test rm');
    expect(rendered.headline).not.toMatch(/[{}<>`]/);
    expect(rendered.usedFactIds).not.toContain('x');
  });
});

describe('singular and plural counts agree with their verb', () => {
  it('says "this item" for one exception and "these items" for several', () => {
    const one = paragraphsOf(buildDepotBriefing(oneEachDetail())).join(' ');
    expect(one).toContain('A closer look at this item could be worthwhile.');
    const many = paragraphsOf(buildDepotBriefing(makeDetail({ withExceptions: true }))).join(' ');
    expect(many).toContain('A closer look at these items could be worthwhile.');
  });

  const fleetLine = (o: Partial<StateMix>): string | undefined =>
    paragraphsOf(
      buildDepotBriefing(makeDetail({ depot: makeDepot('101', 'KANPUR', 'depot', o) })),
    )[1];

  it('says "is" for a single bus and "are" otherwise in the fleet paragraph', () => {
    const one = fleetLine({ inService: 0, onRoad: 1, dark: 1, offRoad: 1 });
    expect(one).toContain('1 is on the road');
    expect(one).toContain('1 is dark');
    expect(one).toContain('1 is off the road');
    const many = fleetLine({ inService: 0, onRoad: 2, dark: 3, offRoad: 4 });
    expect(many).toContain('2 are on the road');
    expect(many).toContain('3 are dark');
    expect(many).toContain('4 are off the road');
  });

  it('agrees in the yard sentence', () => {
    const yardLine = (inCluster: number): string | undefined => {
      const detail = makeDetail();
      const yard = {
        value: { lat: 26.4, lng: 80.3, radiusM: 300, parked: 40, inCluster },
        provenance: 'derived' as const,
      };
      return paragraphsOf(buildDepotBriefing({ ...detail, yard })).find((p) =>
        p.includes('The yard is inferred'),
      );
    };
    expect(yardLine(1)).toContain('1 of 40 parked buses falls inside it');
    expect(yardLine(33)).toContain('33 of 40 parked buses fall inside it');
  });

  const withKpis = (k: { reporting: number; onRoad: number; noSignal: number; maint: number }) => {
    const net = makeNetwork();
    return paragraphsOf(
      buildNetworkBriefing({
        ...net,
        kpis: {
          ...net.kpis,
          reporting: fig(k.reporting),
          onRoad: fig(k.onRoad, 'derived'),
          noSignal: fig(k.noSignal),
          underMaintenance: fig(k.maint),
        },
      }),
    );
  };

  it('agrees in the network opening', () => {
    const one = withKpis({ reporting: 1, onRoad: 1, noSignal: 1, maint: 1 });
    expect(one[0]).toContain('1 bus is reporting a position and 1 bus is running');
    expect(one[1]).toContain('1 bus is showing no signal');
    expect(one[1]).toContain('1 bus is under maintenance');
    const many = withKpis({ reporting: 5, onRoad: 4, noSignal: 3, maint: 2 });
    expect(many[0]).toContain('5 buses are reporting a position and 4 buses are running');
    expect(many[1]).toContain('3 buses are showing no signal');
    expect(many[1]).toContain('2 buses are under maintenance');
  });

  it('agrees in the vehicle-only exception sentence', () => {
    const line = (n: number) =>
      paragraphsOf(buildNetworkBriefing(makeNetwork({ counts: { long_dark: n } }))).at(-1);
    expect(line(1)).toContain('1 exception is flagged on vehicles');
    expect(line(5)).toContain('5 exceptions are flagged on vehicles');
  });
});
