import { describe, expect, it } from 'vitest';
import type { DepotBusView, DepotDetailResponse, VisitorBus } from '@/lib/depot/api';
import { buildCockpit, coverageSentence } from '@/lib/depot/cockpit/cockpitModel';
import { buildTracker, noSchedulesSentence, THIN_SCHEDULE_SHARE } from '@/lib/depot/cockpit/outshedTracker';
import type { BusLocation, OutshedRow, OutshedState } from '@/lib/depot/infer/types';
import type { DepotScore } from '@/lib/depot/score/types';
import type { BusOpState, DepotSummary } from '@/lib/depot/types';

const FEED_NOW = '2026-10-06T06:00:00Z';

function bus(registrationNumber: string, state: BusOpState, location: BusLocation): DepotBusView {
  return {
    registrationNumber,
    state,
    location,
    otherDepotId: location === 'at_other_yard' ? '99' : null,
    distanceFromYardKm: null,
    latitude: null,
    longitude: null,
    speedKmph: null,
    gpsAgeMin: null,
    vehicleStatus: 'stationary',
    tripStatus: null,
    routeName: null,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    tripDate: null,
    delayMinutes: null,
    mainPowerOn: null,
    tamperCode: null,
  };
}

function row(
  registrationNumber: string,
  state: OutshedState,
  scheduledStart: string,
  extra: Partial<OutshedRow> = {},
): OutshedRow {
  return {
    registrationNumber,
    routeName: 'RKD_4560_ORD_OUT',
    journeyCode: null,
    scheduledStart,
    scheduledEnd: null,
    state,
    minutesLate: null,
    minutesOverdue: null,
    evidence: 'none',
    ...extra,
  };
}

const DEPOT: DepotSummary = {
  id: '20',
  name: 'Varanasi',
  kind: 'depot',
  fleet: 10,
  status: { live: 4, stationary: 4, noSignal: 1, underMaintenance: 1, unknown: 0 },
  states: { inService: 3, onRoad: 1, standing: 4, dark: 1, offRoad: 1 },
  reporting: 9,
  positioned: 9,
  assigned: 6,
  powerCut: 0,
  tamperFlagged: 0,
  centroid: null,
};

const SCORE: DepotScore = {
  depotId: '20',
  peerGroup: 'medium',
  ranked: true,
  reason: 'ok',
  index: 62.4,
  rank: 4,
  peerCount: 31,
  components: [],
};

const OUTSHED_ROWS: readonly OutshedRow[] = [
  row('UP-ENDED', 'ended', '2026-10-06T04:00:00Z'),
  row('UP-DEP', 'departed', '2026-10-06T05:00:00Z', { minutesLate: 7, evidence: 'actual_time' }),
  row('UP-LATE', 'upcoming', '2026-10-06T07:30:00Z'),
  row('UP-SOON', 'upcoming', '2026-10-06T06:20:00Z'),
  row('UP-DARK', 'unknown', '2026-10-06T05:30:00Z'),
  row('UP-DUE', 'due', '2026-10-06T05:55:00Z'),
  row('UP-OVER', 'overdue', '2026-10-06T05:20:00Z', { minutesOverdue: 25 }),
];

const VISITORS: readonly VisitorBus[] = [
  {
    registrationNumber: 'V-2',
    homeDepotId: '7',
    homeDepotName: 'Agra',
    state: 'standing',
    position: null,
  },
  {
    registrationNumber: 'V-1',
    homeDepotId: null,
    homeDepotName: null,
    state: 'dark',
    position: null,
  },
];

function detail(overrides: Partial<DepotDetailResponse> = {}): DepotDetailResponse {
  return {
    feedNow: FEED_NOW,
    fetchedAt: FEED_NOW,
    source: 'live',
    stale: false,
    depot: DEPOT,
    score: SCORE,
    yard: {
      value: { lat: 25.3, lng: 83, radiusM: 200, parked: 44, inCluster: 38 },
      provenance: 'derived',
      coverage: { n: 38, of: 44 },
    },
    buses: [
      bus('A', 'in_service', 'away'),
      bus('B', 'in_service', 'away'),
      bus('C', 'in_service', 'away'),
      bus('D', 'on_road', 'away'),
      bus('E', 'standing', 'in_yard'),
      bus('F', 'standing', 'in_yard'),
      bus('G', 'standing', 'at_other_yard'),
      bus('H', 'standing', 'away'),
      bus('I', 'dark', 'unknown'),
      bus('J', 'off_road', 'in_yard'),
    ],
    locationMix: { in_yard: 3, at_other_yard: 1, away: 5, unknown: 1 },
    outshed: {
      rows: OUTSHED_ROWS,
      counts: { upcoming: 2, due: 1, departed: 1, overdue: 1, ended: 1, unknown: 1 },
      coverage: { n: 7, of: 10 },
    },
    exceptions: {
      depot: [
        {
          id: 'dark_share_high:20',
          depotId: '20',
          depotName: 'Varanasi',
          kind: 'dark_share_high',
          severity: 'warning',
          value: 0.1,
          peerMedian: 0.05,
          z: 2,
          affected: 1,
          fleet: 10,
        },
      ],
      bus: [
        {
          id: 'power_cut:I',
          registrationNumber: 'I',
          depotId: '20',
          depotName: 'Varanasi',
          kind: 'power_cut',
          severity: 'critical',
          lastSeen: '2026-10-06T05:10:00Z',
          detail: null,
        },
      ],
    },
    visitors: VISITORS,
    ...overrides,
  };
}

describe('buildCockpit status board', () => {
  const { board } = buildCockpit(detail());

  it('lists the five states with counts and shares that sum to the fleet', () => {
    expect(board.states.map((s) => [s.state, s.count])).toEqual([
      ['in_service', 3],
      ['on_road', 1],
      ['standing', 4],
      ['dark', 1],
      ['off_road', 1],
    ]);
    expect(board.states.reduce((sum, s) => sum + s.count, 0)).toBe(board.fleet);
    const shares = board.states.map((s) => s.share ?? 0);
    expect(shares.reduce((sum, s) => sum + s, 0)).toBeCloseTo(1, 10);
    expect(board.states[0]?.label).toBe('In service');
  });

  it('splits only the standing buses by location', () => {
    expect(board.standing).toBe(4);
    expect(board.locations?.map((l) => [l.location, l.count])).toEqual([
      ['in_yard', 2],
      ['at_other_yard', 1],
      ['away', 1],
      ['unknown', 0],
    ]);
  });

  it('states the yard sample', () => {
    expect(board.yard).toEqual({
      established: true,
      sample: { n: 38, of: 44 },
      sentence: 'Yard learned from 38 of 44 parked buses.',
    });
  });

  it('replaces the split with the yard rule when no yard is established', () => {
    const yardless = buildCockpit(
      detail({ yard: { value: null, provenance: 'derived' }, visitors: [] }),
    );
    expect(yardless.board.locations).toBeNull();
    expect(yardless.board.yard.established).toBe(false);
    expect(yardless.board.yard.sentence).toContain('No yard is established for this depot');
    expect(yardless.board.yard.sentence).toContain('at least 6 parked buses');
    expect(yardless.board.yard.sentence).toContain('at least 25% of');
    expect(yardless.board.yard.sentence).toContain('each within 150 m of the next');
    expect(yardless.board.yard.sentence).toContain('no more than 1.5 km across');
    expect(yardless.board.yard.sentence).toContain('1.5 times');
  });
});

describe('buildCockpit outshedding tracker', () => {
  const { tracker } = buildCockpit(detail());

  it('orders overdue, due, upcoming by time, unknown, departed, ended', () => {
    expect(tracker.map((r) => r.registrationNumber)).toEqual([
      'UP-OVER',
      'UP-DUE',
      'UP-SOON',
      'UP-LATE',
      'UP-DARK',
      'UP-DEP',
      'UP-ENDED',
    ]);
  });

  it('labels every state and shows the right minutes', () => {
    const by = new Map(tracker.map((r) => [r.registrationNumber, r]));
    expect(by.get('UP-OVER')).toMatchObject({ label: 'Overdue', minutes: 25 });
    expect(by.get('UP-OVER')?.minutesText).toBe('25 min overdue');
    expect(by.get('UP-DUE')).toMatchObject({ label: 'Due now', minutes: 5 });
    expect(by.get('UP-DUE')?.minutesText).toBe('5 min since schedule');
    expect(by.get('UP-SOON')).toMatchObject({ label: 'Upcoming', minutes: 20 });
    expect(by.get('UP-SOON')?.minutesText).toBe('in 20 min');
    expect(by.get('UP-DARK')).toMatchObject({ label: 'Unknown', minutes: null, minutesText: '—' });
    expect(by.get('UP-DEP')).toMatchObject({ label: 'Departed', minutes: 7 });
    expect(by.get('UP-DEP')?.minutesText).toBe('7 min late');
    expect(by.get('UP-LATE')?.minutesText).toBe('in 1 h 30 min');
    expect(by.get('UP-ENDED')).toMatchObject({ label: 'Window ended', minutes: null });
  });

  it('never prints raw minutes above an hour (R2-m5)', () => {
    const long = buildTracker(
      [
        row('UP-O', 'overdue', '2026-10-06T01:00:00Z', { minutesOverdue: 135 }),
        row('UP-D', 'departed', '2026-10-06T01:00:00Z', { minutesLate: 1500, evidence: 'actual_time' }),
        row('UP-E', 'departed', '2026-10-06T01:00:00Z', { minutesLate: -75, evidence: 'actual_time' }),
      ],
      '2026-10-06T06:00:00Z',
    );
    expect(long.map((r) => r.minutesText)).toEqual(['2 h 15 min overdue', '1 d 1 h late', '1 h 15 min early']);
  });

  it('words an early, on-time and untimed departure', () => {
    const rows = [
      row('E', 'departed', '2026-10-06T05:00:00Z', { minutesLate: -3, evidence: 'actual_time' }),
      row('O', 'departed', '2026-10-06T05:01:00Z', { minutesLate: 0, evidence: 'actual_time' }),
      row('L', 'departed', '2026-10-06T05:02:00Z', { evidence: 'left_yard' }),
    ];
    const outshed = { ...detail().outshed, rows };
    const texts = buildCockpit(detail({ outshed })).tracker.map((r) => r.minutesText);
    expect(texts).toEqual(['3 min early', 'On time', 'Left the yard; no departure time']);
  });

  it('puts the most overdue first, whatever the scheduled time', () => {
    const rows = [
      row('LESS', 'overdue', '2026-10-06T05:00:00Z', { minutesOverdue: 10 }),
      row('MORE', 'overdue', '2026-10-06T05:10:00Z', { minutesOverdue: 40 }),
      row('NONE', 'overdue', '2026-10-06T04:00:00Z'),
    ];
    const outshed = { ...detail().outshed, rows };
    const order = buildCockpit(detail({ outshed })).tracker.map((r) => r.registrationNumber);
    expect(order).toEqual(['MORE', 'LESS', 'NONE']);
  });

  it('shows no minutes when the feed has no clock', () => {
    const noClock = buildCockpit(detail({ feedNow: null })).tracker;
    expect(noClock.find((r) => r.state === 'upcoming')?.minutes).toBeNull();
  });
});

describe('coverageSentence', () => {
  const DATE = '2026-10-06';
  const THIN =
    ' Only these buses can be tracked: the other 111 carry no schedule for that date, so their departures are not shown.';

  it('names the feed date, never "today"', () => {
    expect(coverageSentence({ n: 100, of: 142 }, DATE)).toBe(
      '100 of 142 buses carry a schedule for the feed date, 6 Oct 2026.',
    );
    expect(coverageSentence({ n: 1, of: 1 }, null)).toBe(
      '1 of 1 bus carries a schedule for the feed date.',
    );
    expect(coverageSentence({ n: 0, of: 0 }, DATE)).toBe(
      'This depot has no buses, so none carries a schedule for the feed date.',
    );
  });

  it('adds the warning only below the thin-coverage threshold', () => {
    expect(THIN_SCHEDULE_SHARE).toBe(0.5);
    expect(coverageSentence({ n: 71, of: 142 }, DATE)).not.toContain('Only these buses');
    expect(coverageSentence({ n: 31, of: 142 }, DATE)).toBe(
      `31 of 142 buses carry a schedule for the feed date, 6 Oct 2026.${THIN}`,
    );
    expect(coverageSentence({ n: 70, of: 142 }, DATE)).toContain('the other 72 carry');
  });

  it('leaves the empty state to say a zero coverage', () => {
    expect(coverageSentence({ n: 0, of: 10 }, DATE)).toBe(
      '0 of 10 buses carry a schedule for the feed date, 6 Oct 2026.',
    );
    expect(noSchedulesSentence(DATE)).toBe(
      'No bus carries a schedule for the feed date, 6 Oct 2026, so there are no departures to track.',
    );
    expect(noSchedulesSentence(null)).toBe(
      'No bus carries a schedule for the feed date, so there are no departures to track.',
    );
  });

  it('reads the feed date from the feed clock', () => {
    expect(buildCockpit(detail()).coverageSentence).toContain('the feed date, 6 Oct 2026.');
    expect(buildCockpit(detail({ feedNow: null })).coverageSentence).toContain('the feed date.');
  });
});


describe('buildCockpit header', () => {
  it('gives a ranked depot its index and rank within its peer group', () => {
    expect(buildCockpit(detail()).header).toEqual({
      name: 'Varanasi',
      kindLabel: 'Depot',
      fleet: 10,
      ranked: true,
      index: 62.4,
      rank: 4,
      peerCount: 31,
      peerGroupLabel: 'Medium fleets',
      unrankedReason: null,
    });
  });

  it('gives an unranked depot the league wording', () => {
    const small = { ...DEPOT, fleet: 4 };
    const score: DepotScore = {
      ...SCORE,
      peerGroup: null,
      ranked: false,
      reason: 'fleet_too_small',
      index: null,
      rank: null,
      peerCount: null,
    };
    const { header } = buildCockpit(detail({ depot: small, score }));
    expect(header.ranked).toBe(false);
    expect(header.unrankedReason).toBe('Needs at least 10 buses to be ranked; this depot has 4.');
    expect(buildCockpit(detail({ score: null })).header.unrankedReason).toBe(
      'No score is available for this depot.',
    );
  });
});

describe('buildCockpit exceptions and visitors', () => {
  const model = buildCockpit(detail());

  it('lists exceptions by severity with their sentences', () => {
    expect(model.exceptions.map((e) => [e.subject, e.severityLabel])).toEqual([
      ['I', 'Critical'],
      ['Depot', 'Warning'],
    ]);
    expect(model.exceptions[0]?.sentence).toBe('Main power reads off. Last seen 05:10.');
    expect(model.exceptions[1]?.sentence).toContain('Dark rate 10.0%');
  });

  it('lists visitors by home depot with a label for a missing one', () => {
    expect(model.visitors.map((v) => [v.registrationNumber, v.homeDepotLabel])).toEqual([
      ['V-2', 'Agra'],
      ['V-1', 'No home depot in the feed'],
    ]);
    expect(model.visitors.map((v) => v.homeDepotId)).toEqual(['7', null]);
  });
});

describe('buildCockpit edge cases', () => {
  it('handles a depot with no buses without NaN', () => {
    const empty: DepotSummary = {
      ...DEPOT,
      fleet: 0,
      states: { inService: 0, onRoad: 0, standing: 0, dark: 0, offRoad: 0 },
    };
    const model = buildCockpit(
      detail({
        depot: empty,
        buses: [],
        outshed: {
          rows: [],
          counts: { upcoming: 0, due: 0, departed: 0, overdue: 0, ended: 0, unknown: 0 },
          coverage: { n: 0, of: 0 },
        },
      }),
    );
    expect(model.board.states.every((s) => s.share === null)).toBe(true);
    expect(model.board.standing).toBe(0);
    expect(model.hasSchedules).toBe(false);
    const nonFinite = (_key: string, value: unknown): unknown =>
      typeof value === 'number' && !Number.isFinite(value) ? 'NON_FINITE' : value;
    expect(JSON.stringify(model, nonFinite)).not.toContain('NON_FINITE');
  });

  it('does not mutate its input', () => {
    const input = detail();
    const before = JSON.stringify(input);
    buildCockpit(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
