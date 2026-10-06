import { describe, it, expect } from 'vitest';
import type { EconomicsDepotRow } from '@/lib/depot/revenue/api';
import type { DepotEconomicsScore, EconomicsComponent } from '@/lib/depot/revenue/types';
import {
  BREAKDOWN_NOTE,
  ECONOMICS_COMPONENT_SPECS,
  FUEL_ONLY_NOTE,
  INDEX_LIMITS_NOTE,
  INDEX_SEPARATION,
  breakdownRows,
  buildEconomicsRows,
  defaultShowUnranked,
  economicsStatement,
  economicsStatusLine,
  emptyRowText,
  explainEconomics,
  peerRankPhrase,
  rankingShortfallNotice,
} from '@/lib/depot/revenue/economicsPageModel';
import {
  buildRouteRows,
  coverageSentence,
  heroBars,
  modelledStatement,
  summaryTiles,
  withheldSentence,
} from '@/lib/depot/revenue/revenuePageModel';
import { ECONOMICS_Z_CLAMP, REVENUE_MODEL_PARAMS } from '@/lib/depot/sim/revenueConfig';

const WEIGHTS = { earningsPerKm: 0.4, costPerKm: 0.35, loadFactor: 0.25 } as const;

function component(
  key: EconomicsComponent['key'],
  value: number | null,
  peerMedian: number | null,
  contribution = 0,
): EconomicsComponent {
  return {
    key,
    value,
    peerMedian,
    coverage: key === 'earningsPerKm' ? { n: 2, of: 4 } : null,
    z: contribution,
    contribution,
    provenance: 'modelled',
  };
}

function entry(
  id: string,
  over: Partial<DepotEconomicsScore> = {},
  row: Partial<EconomicsDepotRow> = {},
): EconomicsDepotRow {
  const score: DepotEconomicsScore = {
    depotId: id,
    peerGroup: 'all',
    ranked: true,
    reason: 'ok',
    missing: [],
    economicsIndex: 60,
    rank: 1,
    peerCount: 6,
    components: [
      component('earningsPerKm', 30, 25, 0.8),
      component('costPerKm', 20, 22, 0.3),
      component('loadFactor', 0.6, 0.55, -0.4),
    ],
    provenance: 'modelled',
    ...over,
  };
  return {
    depotId: id,
    name: `Depot ${id}`,
    kind: 'depot',
    fleet: 40,
    earningsCoverage: { n: 2, of: 2 },
    score,
    ...row,
  };
}

const UNRANKED = {
  ranked: false,
  economicsIndex: null,
  rank: null,
  peerCount: null,
} as const;

const NO_LENGTH = entry(
  '9',
  {
    ...UNRANKED,
    reason: 'missing_component',
    missing: ['earningsPerKm'],
    components: [
      component('earningsPerKm', null, null),
      component('costPerKm', 20, null),
      component('loadFactor', 0.5, null),
    ],
  },
  { earningsCoverage: { n: 0, of: 9 } },
);
const THIN = entry(
  '6',
  { ...UNRANKED, reason: 'thin_route_coverage' },
  { earningsCoverage: { n: 2, of: 9 } },
);
const SMALL_GROUP = entry('5', { ...UNRANKED, reason: 'peer_group_too_small' });
const TINY_FLEET = entry('8', { ...UNRANKED, reason: 'fleet_too_small', peerGroup: null }, { fleet: 4 });
const OTHER_UNIT = entry('7', { ...UNRANKED, reason: 'not_a_depot', peerGroup: null }, { kind: 'hired' });

function operating(ranked: number, total: number): EconomicsDepotRow[] {
  return Array.from({ length: total }, (_, i) =>
    i < ranked ? entry(`${i}`) : entry(`${i}`, { ...UNRANKED, reason: 'thin_route_coverage' }),
  );
}

const joined = (n: ReturnType<typeof rankingShortfallNotice>): string =>
  n === null ? '' : `${n.lead}${n.linkText}${n.tail}`;

describe('the fuel-only cost column', () => {
  it('calls the cost column Fuel cost per km, with one sentence beside the table', () => {
    expect(ECONOMICS_COMPONENT_SPECS.map((c) => c.label)).toEqual([
      'Earnings per km',
      'Fuel cost per km',
      'Load factor',
    ]);
    expect(FUEL_ONLY_NOTE).toBe(
      'Fuel is only one cost. The difference between earnings and fuel cost per kilometre is not profit.',
    );
  });
});

describe('an almost empty ranking', () => {
  it('explains itself with counts when fewer than half the operating depots are ranked', () => {
    expect(joined(rankingShortfallNotice(operating(1, 6)))).toBe(
      'Only 1 of 6 operating depots can be ranked. A depot is ranked once at least two of its routes, and a quarter of them, have a known length; route lengths come from route profiles, which are loaded one route at a time when a route is opened on the Routes page.',
    );
    expect(rankingShortfallNotice(operating(1, 6))?.linkText).toBe('Routes page');
    expect(joined(rankingShortfallNotice(operating(0, 3)))).toMatch(/^Only 0 of 3 operating depots/);
  });
  it('says nothing at half or more, or with no operating depot', () => {
    expect(rankingShortfallNotice(operating(3, 6))).toBeNull();
    expect(rankingShortfallNotice([OTHER_UNIT])).toBeNull();
    expect(rankingShortfallNotice([])).toBeNull();
  });
  it('shows unranked depots by default only when nothing is ranked', () => {
    expect(defaultShowUnranked(buildEconomicsRows(operating(0, 3)))).toBe(true);
    expect(defaultShowUnranked(buildEconomicsRows(operating(2, 3)))).toBe(false);
  });
  it('tells nothing ranked yet from filters hiding every row', () => {
    const none = buildEconomicsRows(operating(0, 3));
    const some = buildEconomicsRows(operating(2, 3));
    expect(emptyRowText(none, { showUnranked: false, search: '' })).toMatch(/nothing is ranked yet/i);
    expect(emptyRowText(some, { showUnranked: false, search: 'zzz' })).toMatch(/filters hide every row/i);
    expect(emptyRowText(none, { showUnranked: true, search: 'zzz' })).toMatch(/filters hide every row/i);
  });
});

describe('a depot without a usable earnings figure', () => {
  const cellOf = (e: EconomicsDepotRow) =>
    buildEconomicsRows([e])[0]?.cells.find((c) => c.key === 'earningsPerKm');
  it('writes length not known with its coverage, never a dash alone', () => {
    expect(cellOf(NO_LENGTH)?.valueText).toBe('length not known');
    expect(cellOf(NO_LENGTH)?.noteText).toBe('0 of 9 routes');
    expect(cellOf(NO_LENGTH)?.description).toContain('length not known');
  });
  it('says too few routes with a known length for a thin figure', () => {
    expect(cellOf(THIN)?.noteText).toBe('too few routes with a known length (2 of 9 routes)');
  });
  it('has no note on a ranked depot', () => {
    expect(cellOf(entry('1'))?.noteText).toBeNull();
  });
  it('shows the reason in the breakdown value cell too', () => {
    const [row] = buildEconomicsRows([NO_LENGTH]);
    expect(row && breakdownRows(row, WEIGHTS)[0]?.valueText).toBe('length not known');
  });
});

describe('the short reason under not ranked', () => {
  it('is a few visible words for every kind of unranked row, and null when ranked', () => {
    const short = (e: EconomicsDepotRow) => buildEconomicsRows([e])[0]?.reasonShort;
    expect(short(NO_LENGTH)).toBe('length not known');
    expect(short(THIN)).toBe('too few routes with a known length');
    expect(short(SMALL_GROUP)).toBe('peer group too small');
    expect(short(TINY_FLEET)).toBe('fewer than 10 buses');
    expect(short(OTHER_UNIT)).toBe('not an operating depot');
    expect(short(entry('1'))).toBeNull();
  });
});

describe('a depot whose peer group is too small', () => {
  it('shows no peer median and no better or worse words', () => {
    const [row] = buildEconomicsRows([SMALL_GROUP]);
    for (const cell of row?.cells ?? []) {
      expect(cell.peerMedian).toBeNull();
      expect(cell.differenceText).toBe('');
      expect(cell.description).not.toMatch(/better|worse|peers|level/);
    }
    const rows = row ? breakdownRows(row, WEIGHTS) : [];
    expect(rows.every((r) => r.peerMedianText === 'no peer median')).toBe(true);
  });
});

describe('explainEconomics with nothing positive', () => {
  it('says least held back by when every contribution is at or below zero', () => {
    const negative = entry('1', {
      components: [
        component('earningsPerKm', 30, 25, -0.8),
        component('costPerKm', 20, 22, -0.3),
        component('loadFactor', 0.6, 0.55, -0.4),
      ],
    });
    const [row] = buildEconomicsRows([negative]);
    expect(row && explainEconomics(row)).toBe(
      'Least held back by Fuel cost per km; held back most by Earnings per km.',
    );
  });
});

describe('the breakdown note', () => {
  it('is built from the economics index own clamp', () => {
    expect(ECONOMICS_Z_CLAMP).toBe(3);
    expect(BREAKDOWN_NOTE).toContain(`+${ECONOMICS_Z_CLAMP} reaches 100`);
    expect(BREAKDOWN_NOTE).toContain(`−${ECONOMICS_Z_CLAMP} reaches 0`);
  });
});

describe('the economics statement', () => {
  const statement = economicsStatement();
  const all = [...statement.preface, ...statement.closing].join(' ');
  it('says what is modelled and that fuel issue records replace the cost', () => {
    expect(all).toMatch(/MODELLED/);
    expect(all).toMatch(/fuel issue records/i);
    expect(statement.preface.length).toBeGreaterThan(0);
  });
  it('says what the ranking can and cannot tell a reader', () => {
    expect(INDEX_LIMITS_NOTE).toBe(
      "This index is driven by the model's class mix and load-factor assumptions; it shows how a ranking will work once ticketing data is supplied and is not a finding about any depot.",
    );
  });
});

function strings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, into);
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) strings(v, into);
  }
  return into;
}

describe('no wording reads as profit, loss or margin', () => {
  it('holds over every string the page models can produce', () => {
    const entries = [entry('1'), entry('2', { rank: 2 }), NO_LENGTH, TINY_FLEET, THIN, SMALL_GROUP, OTHER_UNIT];
    const rows = buildEconomicsRows(entries);
    const route = {
      routeName: 'R',
      serviceClass: 'ordinary',
      trips: 1,
      seatsPerTrip: 40,
      seatCapacity: 40,
      loadFactor: 0.5,
      boardings: 10,
      revenue: 100,
      lengthKm: null,
      revenueBasis: 'flat_fare_unknown_length',
      provenance: 'modelled',
      serviceKm: null,
      earningsPerKm: null,
      earningsWithheld: 'unknown_length',
      lengthProvenance: null,
    } as const;
    const collected = strings([
      rows,
      rows.map((r) => [explainEconomics(r), peerRankPhrase(r), breakdownRows(r, WEIGHTS)]),
      economicsStatusLine(entries),
      rankingShortfallNotice(operating(1, 6)),
      emptyRowText(rows, { showUnranked: false, search: '' }),
      emptyRowText(rows, { showUnranked: true, search: 'x' }),
      economicsStatement(),
      modelledStatement(REVENUE_MODEL_PARAMS),
      INDEX_LIMITS_NOTE,
      INDEX_SEPARATION,
      BREAKDOWN_NOTE,
      ECONOMICS_COMPONENT_SPECS,
      buildRouteRows([route]),
      heroBars([route], false),
      summaryTiles({
        routes: 1,
        trips: 1,
        boardings: 1,
        revenue: 1,
        loadFactor: 0.5,
        flatFareRevenueShare: 1,
        flatFareRouteShare: 1,
        earningsPerKm: null,
        earningsCoverage: { n: 0, of: 1 },
        provenance: 'modelled',
      }),
      withheldSentence('unknown_length'),
      withheldSentence('no_service_km'),
      coverageSentence({ n: 0, of: 3 }),
    ]).join('\n');
    // The one required sentence says "not profit"; every other string must avoid the words.
    const rest = collected.replace(FUEL_ONLY_NOTE, '');
    expect(rest).not.toMatch(/\b(profit|profits|profitable|loss|losses|margin|margins)\b/i);
    expect(collected).not.toMatch(/simulated/i);
  });
});
