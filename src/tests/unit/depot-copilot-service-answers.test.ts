import { describe, expect, it } from 'vitest';
import type { DepotNetworkResponse } from '@/lib/depot/api';
import { buildAnswer, type AnswerData } from '@/lib/depot/copilot/facts/answers';
import { factEdges } from '@/lib/depot/copilot/factText';
import type { CopilotQuery } from '@/lib/depot/copilot/queries';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import { answerTable } from '@/lib/depot/copilot/service/interpret';
import type { HourBasis, Proposal, RouteHourlyBody } from '@/lib/depot/service/types';
import { networkHoursFixture } from './depot-copilot-network-hours.fixtures';
import { FIXTURE_PROPOSALS, routeHourlyFixture } from './depot-service-fixtures';

const PLACEHOLDER = /\{\{fact:[a-z0-9][a-z0-9_.-]{0,63}\}\}/g;
const BARE_NUMBER = /^[\p{N}.,\s—-]+$/u;
const PROVENANCE = ['live', 'derived', 'modelled', 'reference'];

const network = {
  depots: [
    { id: '101', name: 'KANPUR' },
    { id: '102', name: 'ETAWAH' },
  ],
} as unknown as DepotNetworkResponse;

const routeDay = routeHourlyFixture();
const data = (o: Partial<AnswerData> = {}): AnswerData => ({
  network,
  routeDay,
  networkHours: networkHoursFixture(),
  ...o,
});

const withBasis = (body: RouteHourlyBody, hour: number, basis: HourBasis): RouteHourlyBody => ({
  ...body,
  hours: body.hours.map((h) => (h.hour === hour ? { ...h, deployedBasis: basis } : h)),
});
const withProposals = (proposals: readonly Proposal[]): RouteHourlyBody => ({ ...routeDay, proposals });
const KINDS: readonly Proposal['kind'][] = [
  'add_buses',
  'hold_buses',
  'trips_not_run',
  'service_span_gap',
  'headway_gap',
  'revise_running_time',
];

/** Every answer the new kinds can give, across the fixture's shapes. */
function cases(): [string, CopilotRequest][] {
  const ask = (q: CopilotQuery, o?: Partial<AnswerData>): CopilotRequest => buildAnswer(q, data(o));
  const hour = (h: number, o?: Partial<AnswerData>): CopilotRequest =>
    ask({ kind: 'routeHour', routeName: routeDay.routeName, hour: h }, o);
  return [
    ...Array.from({ length: 24 }, (_, h): [string, CopilotRequest] => [`route at ${h}`, hour(h)]),
    ...(['observed', 'current', 'modelled'] as const).map((b): [string, CopilotRequest] => [
      `route at 8, ${b}`,
      hour(8, { routeDay: withBasis(routeDay, 8, b) }),
    ]),
    ['route hour, covered by unrouted', hour(8, { routeDay: withProposals(FIXTURE_PROPOSALS.map((p) => ({ ...p, maybeCoveredByUnrouted: true }))) })],
    ...KINDS.map((kind): [string, CopilotRequest] => [
      `route hour, ${kind}`,
      hour(8, { routeDay: withProposals([{ ...FIXTURE_PROPOSALS[0]!, kind, change: kind === 'add_buses' ? 1 : 0 }]) }),
    ]),
    ['route day', ask({ kind: 'routeProposals', routeName: routeDay.routeName })],
    [
      'route day, nothing observed, no proposal',
      ask({ kind: 'routeProposals', routeName: routeDay.routeName }, { routeDay: { ...withProposals([]), observed: null, currentHour: null } }),
    ],
    [
      'route day, many proposals',
      ask({ kind: 'routeProposals', routeName: routeDay.routeName }, { routeDay: withProposals([...FIXTURE_PROPOSALS, ...FIXTURE_PROPOSALS]) }),
    ],
    [
      'route day, level all day',
      ask({ kind: 'routeProposals', routeName: routeDay.routeName }, { routeDay: { ...routeDay, hours: routeDay.hours.map((h) => ({ ...h, gap: 0 })) } }),
    ],
    ['route, no body', ask({ kind: 'routeHour', routeName: 'X_1', hour: 3 }, { routeDay: undefined })],
    ...[0, 5, 7, 12, 16, 18, 22].map((h): [string, CopilotRequest] => [`network at ${h}`, ask({ kind: 'hourProposals', hour: h })]),
    ['network, one depot', ask({ kind: 'hourProposals', hour: 7, depotId: '101' })],
    ['network, other depot', ask({ kind: 'hourProposals', hour: 18, depotId: '102' })],
    ['network, unknown depot', ask({ kind: 'hourProposals', hour: 18, depotId: '999' })],
    ['network, no body', ask({ kind: 'hourProposals', hour: 7 }, { networkHours: undefined })],
    ['brief', ask({ kind: 'serviceBrief' })],
    ['brief, its date', ask({ kind: 'serviceBrief', date: '2026-10-06' })],
    ['brief, another date', ask({ kind: 'serviceBrief', date: '2026-10-05' })],
    [
      'brief, cold server, no trail, no proposal',
      ask({ kind: 'serviceBrief' }, { networkHours: networkHoursFixture({ observed: null, decisions: null, proposals: [], currentHour: null }) }),
    ],
    ['brief, late at night', ask({ kind: 'serviceBrief' }, { networkHours: networkHoursFixture({ currentHour: 2 }) })],
    ['brief, no body', ask({ kind: 'serviceBrief' }, { networkHours: undefined })],
  ];
}

const proseOf = (r: CopilotRequest): string =>
  [r.scriptedDraft.headline, ...r.scriptedDraft.paragraphs].join('\n');

describe('service answers: the draft rules', () => {
  it.each(cases())('%s renders through renderDraft with no figure in the prose', (_label, request) => {
    const rendered = renderDraft(request.scriptedDraft, request.facts);
    expect(rendered).toMatchObject({ ok: true });
    expect(proseOf(request).replace(PLACEHOLDER, ' ')).not.toMatch(/\d/);
    expect(proseOf(request).replace(PLACEHOLDER, ' ')).not.toMatch(
      /\b(one|ones|none|hour|hours|morning|evening)\b/i,
    );
  });

  it.each(cases())('%s has unique, bounded facts, each with a provenance and a noun', (_label, request) => {
    const ids = request.facts.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(request.facts.length).toBeLessThanOrEqual(60);
    for (const f of request.facts) {
      expect(f.text.length).toBeLessThanOrEqual(120);
      expect(f.label.length).toBeLessThanOrEqual(40);
      expect(PROVENANCE).toContain(f.provenance);
      const bare = f.kind !== 'name' && BARE_NUMBER.test(f.text) && factEdges(f.text).endsBare;
      expect(bare).toBe(false);
      if (/(^|\.)name$/.test(f.id)) expect(f.kind).toBe('name');
    }
  });
});

describe('service answers: provenance per fact', () => {
  const by = (r: CopilotRequest, id: string) => r.facts.find((f) => f.id === id);
  const at = (hour: number, basis: HourBasis): CopilotRequest =>
    buildAnswer(
      { kind: 'routeHour', routeName: routeDay.routeName, hour },
      data({ routeDay: withBasis(routeDay, hour, basis) }),
    );

  it('says deployed is derived where observed, live for the feed hour, modelled otherwise', () => {
    expect(by(at(8, 'observed'), 'hour.deployed')?.provenance).toBe('derived');
    expect(by(at(8, 'current'), 'hour.deployed')?.provenance).toBe('live');
    expect(by(at(8, 'modelled'), 'hour.deployed')?.provenance).toBe('modelled');
  });

  it('says scheduled is derived and demand, need and gap are modelled', () => {
    const r = at(8, 'observed');
    expect(by(r, 'hour.scheduled')).toMatchObject({ text: '6 buses', provenance: 'derived' });
    expect(by(r, 'hour.needed')).toMatchObject({ text: '13 buses', provenance: 'modelled' });
    expect(by(r, 'hour.gap')).toMatchObject({ text: '4 buses', provenance: 'modelled' });
    expect(by(r, 'hour.demand')).toMatchObject({ text: '520 passengers', provenance: 'modelled' });
    expect(by(r, 'hour.span')?.text).toBe('08:00–09:00');
    expect(by(r, 'p.line')).toMatchObject({ text: '07:00–11:00: add 3 buses', provenance: 'modelled' });
  });

  it('says a measured finding is derived', () => {
    const r = buildAnswer(
      { kind: 'routeHour', routeName: routeDay.routeName, hour: 8 },
      data({ routeDay: withProposals([FIXTURE_PROPOSALS[2]!]) }),
    );
    expect(by(r, 'p.line')).toMatchObject({ text: '07:00–10:00: revise running time', provenance: 'derived' });
  });

  it('gives the band its reference span and the routes their modelled gaps', () => {
    const r = buildAnswer({ kind: 'hourProposals', hour: 18 }, data());
    expect(by(r, 'band.label')).toMatchObject({ text: 'evening peak, 16:00–20:00', provenance: 'reference' });
    expect(by(r, 'short.1.name')).toMatchObject({ text: 'LKO_204_EXP_IN', kind: 'name' });
    expect(by(r, 'short.1.gap')).toMatchObject({ text: '4 buses', provenance: 'modelled' });
    expect(by(r, 'over.1.gap')).toMatchObject({ text: '1 bus', provenance: 'modelled' });
  });

  it("keeps one depot's routes and recomputes its totals", () => {
    const r = buildAnswer({ kind: 'hourProposals', hour: 7, depotId: '101' }, data());
    expect(by(r, 'depot.name')).toMatchObject({ text: 'KANPUR', kind: 'name' });
    expect(by(r, 'band.short_routes')?.text).toBe('2 routes');
    expect(by(r, 'band.buses_short')?.text).toBe('4.4 buses');
    expect(by(r, 'band.over_routes')?.text).toBe('0 routes');
    expect(r.facts.some((f) => f.text.includes('LKO_204_EXP_IN'))).toBe(false);
  });

  it('builds the brief from the band in focus, the moves, the leading proposals and the decisions', () => {
    const r = buildAnswer({ kind: 'serviceBrief' }, data());
    expect(by(r, 'brief.date')?.text).toBe('6 Oct 2026');
    expect(by(r, 'band.label')?.text).toBe('midday, 10:00–16:00');
    expect(by(r, 'brief.moves_within')).toMatchObject({ text: '22 buses', provenance: 'modelled' });
    expect(by(r, 'brief.p.1')?.text).toBe('VND_1613_ORD_OUT 07:00–11:00: add 3 buses, 180 to 320 passengers');
    expect(by(r, 'brief.accepted')).toMatchObject({ text: '2 proposals', provenance: 'derived' });
    expect(by(r, 'brief.observed_since')?.text).toBe('05:02 (79 samples)');
    expect(r.scriptedDraft.paragraphs.length).toBeLessThanOrEqual(5);
  });

  it('says plainly when the network view or the route is not there', () => {
    for (const r of [
      buildAnswer({ kind: 'serviceBrief' }, { network }),
      buildAnswer({ kind: 'hourProposals', hour: 7 }, { network }),
      buildAnswer({ kind: 'routeProposals', routeName: 'R_1' }, { network }),
    ]) {
      expect(r.scriptedDraft.headline).toBe('That answer is not available');
    }
  });
});

describe('the band table', () => {
  it('lists the short routes, then those in surplus, with a modelled gap column', () => {
    const query: CopilotQuery = { kind: 'hourProposals', hour: 18 };
    const table = answerTable(query, buildAnswer(query, data()).facts);
    expect(table).toEqual({
      columns: ['Route', 'Gap over the band'],
      rows: [
        ['LKO_204_EXP_IN', 'Short by 4 buses'],
        ['R_11', 'In surplus by 1 bus'],
      ],
      provenance: [null, 'modelled'],
    });
  });

  it('has no table for a band with no route short or in surplus', () => {
    const query: CopilotQuery = { kind: 'hourProposals', hour: 4 };
    expect(answerTable(query, buildAnswer(query, data()).facts)).toBeUndefined();
  });
});
