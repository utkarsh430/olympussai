import { describe, expect, it } from 'vitest';
import type { DepotBusView, DepotDetailResponse } from '@/lib/depot/api';
import { buildAttention } from '@/lib/depot/cockpit/attention';
import {
  availabilitySegments,
  availabilityText,
  standingLine,
} from '@/lib/depot/cockpit/availability';
import { depotExceptionLines, groupBusExceptions } from '@/lib/depot/cockpit/exceptionGroups';
import { indexLine } from '@/lib/depot/cockpit/indexLine';
import type { CockpitHeader, StatusBoard } from '@/lib/depot/cockpit/cockpitTypes';
import type { BusException, DepotException } from '@/lib/depot/exceptions/types';
import type { OutshedRow } from '@/lib/depot/infer/types';

const FEED_NOW = '2026-10-05T14:20:00.000Z';

function bus(registrationNumber: string, overrides: Partial<DepotBusView> = {}): DepotBusView {
  return {
    registrationNumber,
    state: 'standing',
    location: 'in_yard',
    mainPowerOn: true,
    tamperCode: null,
    notHeardMin: null,
    ...overrides,
  } as DepotBusView;
}

function busException(registrationNumber: string, kind: BusException['kind'], severity: BusException['severity']): BusException {
  return { id: `${kind}:${registrationNumber}`, registrationNumber, depotId: '49', depotName: 'K', kind, severity, lastSeen: null, detail: null };
}

function detail(overrides: Partial<DepotDetailResponse> = {}): DepotDetailResponse {
  return {
    feedNow: FEED_NOW,
    buses: [],
    outshed: { rows: [], coverage: { n: 0, of: 0 } },
    exceptions: { depot: [], bus: [] },
    visitors: [],
    ...overrides,
  } as unknown as DepotDetailResponse;
}

describe('buildAttention', () => {
  it('says so in one calm line when nothing needs attention', () => {
    const attention = buildAttention(detail({ buses: [bus('A')] }), '49');
    expect(attention.lines).toEqual([]);
    expect(attention.calm).toMatch(/^Nothing needs attention on this snapshot/);
  });

  it('counts each concern, most pressing first, each a link', () => {
    const attention = buildAttention(
      detail({
        buses: [
          bus('A', { mainPowerOn: false }),
          bus('B', { mainPowerOn: false, state: 'dark' }),
          bus('C', { state: 'off_road' }),
          bus('D', { notHeardMin: 87 }),
          bus('E', { tamperCode: '7' }),
        ],
        outshed: { rows: [{ state: 'overdue' } as OutshedRow], coverage: { n: 1, of: 5 } } as unknown as DepotDetailResponse['outshed'],
        exceptions: { depot: [], bus: [busException('F', 'emergency', 'critical')] },
      }),
      '49',
    );
    expect(attention.calm).toBeNull();
    expect(attention.lines.map((l) => l.text)).toEqual([
      '1 bus raises the emergency flag',
      '2 buses report main power off',
      '1 departure is overdue',
      '1 bus is dark: no signal for 6 h or more',
      '1 bus is off the road',
      '1 bus has not been heard for over 30 min',
    ]);
    expect(attention.lines[1]?.href).toBe('/project/depots/d/49/roster?flag=power_off');
    expect(attention.lines[3]?.href).toBe('/project/depots/d/49/roster?state=dark');
    expect(attention.lines[2]?.href).toBe('/project/depots/d/49#depot-outshed');
  });

  it('never shows more than six lines', () => {
    const attention = buildAttention(
      detail({
        buses: [bus('A', { mainPowerOn: false, state: 'dark', tamperCode: '7' }), bus('B', { state: 'off_road' }), bus('C', { notHeardMin: 50 })],
        outshed: { rows: [{ state: 'overdue' } as OutshedRow], coverage: { n: 1, of: 1 } } as unknown as DepotDetailResponse['outshed'],
        exceptions: { depot: [], bus: [busException('F', 'emergency', 'critical')] },
      }),
      '49',
    );
    expect(attention.lines).toHaveLength(6);
  });
});

const BOARD: StatusBoard = {
  fleet: 200,
  states: [
    { state: 'in_service', label: 'In service', count: 5, share: 0.025 },
    { state: 'on_road', label: 'On road, no schedule in feed', count: 55, share: 0.275 },
    { state: 'standing', label: 'Standing', count: 86, share: 0.43 },
    { state: 'dark', label: 'Dark', count: 44, share: 0.22 },
    { state: 'off_road', label: 'Off road', count: 10, share: 0.05 },
  ],
  standing: 86,
  locations: [
    { location: 'in_yard', label: 'In yard', count: 59 },
    { location: 'at_other_yard', label: 'At another depot', count: 2 },
    { location: 'away', label: 'Away', count: 25 },
    { location: 'unknown', label: 'Location unknown', count: 0 },
  ],
  yard: { established: true, sample: { n: 59, of: 86 }, sentence: 'Yard learned from 59 of 86 parked buses.' },
};

describe('availability bar', () => {
  it('gives every state its word, count and share, summing to the fleet', () => {
    const segments = availabilitySegments(BOARD);
    expect(segments.map((s) => s.count).reduce((a, b) => a + b, 0)).toBe(200);
    expect(segments[0]).toMatchObject({ state: 'in_service', label: 'In service', count: 5, shareText: '2.5%' });
  });

  it('has a text equivalent', () => {
    expect(availabilityText(BOARD)).toBe(
      'Of 200 buses: 5 in service (2.5%), 55 on road, no schedule in feed (27.5%), 86 standing (43%), 44 dark (22%), 10 off road (5%).',
    );
  });

  it('puts the standing split on one line', () => {
    expect(standingLine(BOARD, null)).toEqual({
      kind: 'split',
      text: '86 standing: 59 in the yard · 2 at another yard · 25 away · 0 location unknown',
      held: null,
    });
  });

  it('says when the yard is held', () => {
    const line = standingLine(BOARD, '2026-10-05T14:02:00.000Z');
    expect(line.kind === 'split' && line.held).toBe('Yard held since 14:02: this snapshot alone would not place it.');
  });

  it('gives the yard rule when no yard is established', () => {
    const line = standingLine({ ...BOARD, locations: null, yard: { established: false, sentence: 'No yard is established.' } }, null);
    expect(line).toEqual({ kind: 'no-yard', sentence: 'No yard is established.' });
  });
});

describe('index line', () => {
  const header: CockpitHeader = {
    name: 'K', kindLabel: 'Depot', fleet: 200, ranked: true, index: 31.64, rank: 34, peerCount: 38,
    peerGroupLabel: 'Large fleets', unrankedReason: null,
  };

  // The window words come from the shared module; the cockpit line must use them.
  it('words the window', () => {
    const line = (w: Parameters<typeof indexLine>[1]): string => indexLine(header, w, FEED_NOW);
    expect(line({ lengthMin: 20, since: '2026-10-05T14:00:00.000Z', samples: 30 })).toMatch(/ · over the last 20 minutes$/);
    expect(line({ lengthMin: 20, since: '2026-10-05T14:02:00.000Z', samples: 3 })).toMatch(/ · since 14:02, 3 snapshots$/);
    expect(line({ lengthMin: 20, since: FEED_NOW, samples: 1 })).toMatch(/ · from one snapshot at 14:20$/);
    expect(line(undefined)).toBe('Efficiency index 31.6 · rank 34 of 38 in Large fleets');
  });

  it('carries index, rank, peer group and window on one line', () => {
    expect(indexLine(header, { lengthMin: 20, since: '2026-10-05T14:00:00.000Z', samples: 30 }, FEED_NOW)).toBe(
      'Efficiency index 31.6 · rank 34 of 38 in Large fleets · over the last 20 minutes',
    );
  });

  it('gives an unranked depot its reason', () => {
    expect(indexLine({ ...header, ranked: false, index: null, unrankedReason: 'Not an operating depot.' }, undefined, FEED_NOW)).toBe(
      'Efficiency index: not ranked. Not an operating depot.',
    );
  });
});

describe('exception groups', () => {
  it('merges each bus into one row under its most severe kind, with its kinds as words', () => {
    const groups = groupBusExceptions(
      [
        busException('UP1', 'power_cut', 'info'),
        busException('UP1', 'long_dark', 'warning'),
        busException('UP2', 'power_cut', 'info'),
      ],
      '49',
    );
    expect(groups.map((g) => [g.kind, g.rows.length])).toEqual([['long_dark', 1], ['power_cut', 1]]);
    expect(groups[0]?.rows[0]).toMatchObject({ registrationNumber: 'UP1', kinds: 'Long dark · Power off' });
    expect(groups[0]?.href).toBe('/project/depots/d/49/roster?state=dark');
    expect(groups[1]?.href).toBe('/project/depots/d/49/roster?flag=power_off');
  });

  it('says a windowed depot exception is over the window while its count is now', () => {
    const e: DepotException = {
      id: 'dark_share_high:49', depotId: '49', depotName: 'K', kind: 'dark_share_high', severity: 'warning',
      value: 0.22, peerMedian: 0.1, z: 2, affected: 44, fleet: 200,
    };
    const [line] = depotExceptionLines([e], { lengthMin: 20, since: '2026-10-05T14:00:00.000Z', samples: 30 }, FEED_NOW);
    expect(line?.windowNote).toBe('Rate over the last 20 minutes; 44 buses affected now.');
    const [cluster] = depotExceptionLines([{ ...e, kind: 'power_cut_cluster' }], undefined, FEED_NOW);
    expect(cluster?.windowNote).toBeNull();
  });
});
