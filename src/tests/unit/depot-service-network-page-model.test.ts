import { describe, expect, it } from 'vitest';
import {
  HEAT_STEPS,
  heatCell,
  heatTableRows,
  networkChangeCell,
  networkFigures,
  networkProposalRow,
  networkProvenance,
  orderNetworkProposals,
  uncoveredWords,
  cutNote,
} from '@/lib/depot/service/networkPageModel';
import type { NetworkHourlyResponse, NetworkProposal, NetworkRouteStrip } from '@/lib/depot/service/types';
import {
  NETWORK_PROPOSAL_COLUMN_WIDTHS,
  networkProposalColumnKeys,
  networkProposalTierFor,
} from '@/lib/depot/service/networkProposalColumns';
import { TABLE_FRAME_BORDER_PX, contentWidthAt } from '@/lib/depot/shell/geometry';
import { tableWidth } from '@/lib/depot/shell/tableWidth';
import { FIXTURE_PROPOSALS } from './depot-service-fixtures';

const strip: NetworkRouteStrip = {
  routeName: 'R1', depotId: 'A', depotName: 'Alambagh',
  gaps: Array.from({ length: 24 }, (_, h) => (h === 8 ? 4 : h === 13 ? -2 : h === 20 ? 7 : 0)),
  bases: Array.from({ length: 24 }, (_, h) => (h < 12 ? 'measured' : 'modelled')),
  bandGap: 2, peakGap: 4, peakHour: 8,
};

function response(over: Partial<NetworkHourlyResponse> = {}): NetworkHourlyResponse {
  const band = { shortRoutes: 3, overRoutes: 2, busesShort: 9, busesOver: 4, byDepot: [] };
  return {
    operatingDate: '2026-10-06', currentHour: 11, band: 'evening_peak', nextPeak: 'evening_peak',
    depotId: null, depots: [{ depotId: 'A', depotName: 'Alambagh' }],
    bands: [
      { band: 'early', label: 'Early', fromHour: 4, toHour: 5, ...band },
      { band: 'evening_peak', label: 'Evening peak', fromHour: 16, toHour: 19, ...band, shortRoutes: 14 },
    ],
    routes: { total: 1, page: 0, pageSize: 25, rows: [strip] },
    proposals: [],
    reallocation: { band: 'evening_peak', moves: [], uncovered: [], busesWithin: 22, busesBetween: 6, deadKm: 140 },
    totals: {
      busesShort: 9, busesOver: 4, movesWithin: 22, movesBetween: 6, uncovered: 1,
      passengersPerDay: { low: 100, high: 200 }, busKmPerDay: { low: 10, high: 20 },
    },
    observed: null, routeCoverage: { n: 10, of: 40 }, demandBasis: 'x',
    feedNow: '2026-10-06T11:24:00Z', fetchedAt: '2026-10-06T11:24:05.000Z', source: 'live', stale: false,
    ...over,
  } as NetworkHourlyResponse;
}

describe('a heat cell', () => {
  it('says the gap in figures and words, its side, its strength and its basis', () => {
    expect(heatCell(4, 'measured')).toEqual({
      text: '+4', words: 'Short by 4', tone: 'short', step: 2, measured: true,
    });
    expect(heatCell(-1, 'modelled')).toMatchObject({ text: '−1', tone: 'over', step: 1, measured: false });
    expect(heatCell(0.2, 'measured')).toMatchObject({ text: '0', tone: 'even', step: 0 });
    expect(heatCell(12, 'measured').step).toBe(HEAT_STEPS.length);
  });

  it('gives the table view one row per route, every hour in words with its basis', () => {
    const [row] = heatTableRows([strip]);
    expect(row?.routeName).toBe('R1');
    expect(row?.hours).toHaveLength(24);
    expect(row?.hours[8]).toBe('+4 measured');
    expect(row?.hours[20]).toBe('+7 modelled');
    expect(row?.peak).toBe('+4 at 08:00');
  });
});

describe('the network page’s figures and provenance', () => {
  it('leads with the routes short at the next peak, tagged MODELLED', () => {
    const [first, ...rest] = networkFigures(response());
    expect(first).toMatchObject({ label: 'Routes short at the next peak', value: '14', tag: 'modelled' });
    expect(rest.map((f) => f.label)).toEqual(['Buses short', 'Buses over', 'Moves proposed']);
    expect(rest[2]?.value).toBe('28');
    expect(rest[2]?.caption).toBe('22 within depots, 6 between');
  });

  it('is MIXED, naming the observed hours only when some were observed', () => {
    expect(networkProvenance(null).default).toBe('mixed');
    const cold = networkProvenance(response());
    expect(cold.default === 'mixed' && cold.derived).not.toContain('observed');
    const warm = networkProvenance(response({ observed: { since: '2026-10-06T05:00:00Z', hours: 6, samples: 70 } }));
    expect(warm.default === 'mixed' && warm.derived).toContain('observed');
  });
});

const corridor: NetworkProposal = {
  ...FIXTURE_PROPOSALS[0]!, kind: 'corridor_under_served', routeName: null, depotId: null, depotName: null,
  routes: ['UP_1', 'DOWN_1'], group: 'findings', count: 5, change: 0, impact: null, source: null,
};

describe('a network proposal row', () => {
  it('names the route and depot, or the corridor’s routes', () => {
    const own: NetworkProposal = { ...FIXTURE_PROPOSALS[0]!, depotId: 'A', depotName: 'Alambagh', routes: [FIXTURE_PROPOSALS[0]!.routeName], group: 'changes', count: null };
    expect(networkProposalRow(own)).toMatchObject({ route: own.routeName, depot: 'Alambagh', change: 'Add 3' });
    expect(networkProposalRow(corridor)).toMatchObject({ route: 'UP_1, DOWN_1', depot: '—', change: 'Corridor short 5' });
  });

  it('writes the network kinds’ change cell with their figure', () => {
    expect(networkChangeCell('reserve_by_hour', 0, 2)).toBe('Reserve 2');
    expect(networkChangeCell('shift_departures', 0, 3)).toBe('Shift 3 trips');
    expect(networkChangeCell('add_buses', 3, null)).toBe('Add 3');
  });

  it('orders changes, then findings, then the network moves', () => {
    const network = { ...corridor, group: 'network' as const, kind: 'reserve_by_hour' as const };
    const own = { ...corridor, group: 'changes' as const };
    expect(orderNetworkProposals([network, corridor, own]).map((p) => p.group)).toEqual([
      'changes', 'findings', 'network',
    ]);
  });

  it('says why a deficit is left', () => {
    expect(uncoveredWords('no_surplus_in_range')).toMatch(/within/);
    expect(uncoveredWords('insufficient_surplus')).toMatch(/ran out/);
    expect(uncoveredWords('no_position')).toMatch(/position/);
  });
});

describe('the network proposals table width per tier', () => {
  const VIEWPORTS = [390, 640, 799, 800, 1023, 1024, 1279, 1280, 1439, 1440] as const;

  it.each([...VIEWPORTS])('at %ipx the chosen column set fits the frame', (viewport) => {
    const keys = networkProposalColumnKeys(networkProposalTierFor(viewport));
    const width = tableWidth(NETWORK_PROPOSAL_COLUMN_WIDTHS, keys, { expander: true }) + TABLE_FRAME_BORDER_PX;
    expect(width).toBeLessThanOrEqual(contentWidthAt(viewport));
    expect(keys).toContain('change');
  });

  it('shows Route and Depot from 1440, Route from 800', () => {
    expect(networkProposalColumnKeys(networkProposalTierFor(1440))).toEqual(
      expect.arrayContaining(['route', 'depot']),
    );
    expect(networkProposalColumnKeys(networkProposalTierFor(800))).toContain('route');
  });
});

describe('the cut note', () => {
  it('says which groups were cut, and nothing when none was', () => {
    const shown = [{ group: 'changes' as const }, { group: 'network' as const }];
    expect(cutNote(shown, { changes: 1, findings: 0, network: 1 })).toBeNull();
    expect(cutNote(shown, { changes: 685, findings: 0, network: 1 })).toBe(
      'Listed by weight: the first 1 of 685 changes.',
    );
  });
});
