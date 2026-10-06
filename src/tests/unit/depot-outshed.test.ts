import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import type { BusOpState } from '@/lib/depot/types';
import type { LocatedBus, Yard } from '@/lib/depot/infer/types';
import { fromMetres } from '@/lib/depot/infer/geo';
import {
  ACTUAL_START_WINDOW_MIN,
  MAX_PLAUSIBLE_DELAY_MIN,
  OUTSHED_GRACE_MIN,
  classifyOutshed,
  isScheduledForFeedDate,
  summariseOutshed,
} from '@/lib/depot/infer/outshed';

const HOME = { lat: 26.85, lng: 80.95 };
const FEED_NOW = '2026-10-06T08:00:00Z';

/** ISO time on the feed date, offset in minutes from 08:00. */
const at = (offsetMin: number): string =>
  new Date(Date.parse(FEED_NOW) + offsetMin * 60_000).toISOString();

function row(over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001',
    latitude: HOME.lat,
    longitude: HOME.lng,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: FEED_NOW,
    receivedAt: FEED_NOW,
    depotId: '1',
    depotName: 'Home',
    vehicleStatus: 'stationary',
    tripStatus: null,
    routeId: 'R1',
    routeName: 'Route 1',
    routeDescription: null,
    journeyId: 'J1',
    journeyCode: 'J-1',
    scheduledStart: at(-30),
    scheduledEnd: at(240),
    actualStart: null,
    delayMinutes: null,
    odometerRaw: null,
    mainPowerOn: null,
    mainVoltage: null,
    tamperCode: null,
    emergency: null,
    ...over,
  };
}

const IN_YARD: LocatedBus = { location: 'in_yard', otherDepotId: null, distanceFromYardKm: 0 };
const AWAY: LocatedBus = { location: 'away', otherDepotId: null, distanceFromYardKm: 12 };
const OTHER: LocatedBus = { location: 'at_other_yard', otherDepotId: '2', distanceFromYardKm: 20 };
const UNKNOWN: LocatedBus = { location: 'unknown', otherDepotId: null, distanceFromYardKm: null };

const classify = (
  over: Partial<DepotBusRow>,
  state: BusOpState,
  located: LocatedBus,
  feedNow: string = FEED_NOW,
) => classifyOutshed(row(over), state, located, feedNow);

describe('isScheduledForFeedDate', () => {
  it('matches the feed date prefix', () => {
    expect(isScheduledForFeedDate(row({ scheduledStart: at(-30) }), FEED_NOW)).toBe(true);
  });
  it('rejects yesterday, a missing start, and a null feedNow', () => {
    expect(isScheduledForFeedDate(row({ scheduledStart: '2026-10-05T08:00:00Z' }), FEED_NOW)).toBe(
      false,
    );
    expect(isScheduledForFeedDate(row({ scheduledStart: null }), FEED_NOW)).toBe(false);
    expect(isScheduledForFeedDate(row(), null)).toBe(false);
  });
});

describe('classifyOutshed', () => {
  it('ignores a schedule from another day', () => {
    expect(classify({ scheduledStart: '2026-10-05T07:00:00Z' }, 'standing', IN_YARD)).toBeNull();
  });

  it('ignores a row with no schedule', () => {
    expect(classify({ scheduledStart: null }, 'standing', IN_YARD)).toBeNull();
  });

  it('rule 1: ended when the scheduled end has passed, before anything else', () => {
    const result = classify(
      { scheduledStart: at(-300), scheduledEnd: at(-1), actualStart: at(-295) },
      'in_service',
      AWAY,
    );
    expect(result?.state).toBe('ended');
    expect(result?.evidence).toBe('none');
  });

  it('rule 1: a scheduled end exactly at feedNow has not ended', () => {
    expect(classify({ scheduledEnd: at(0) }, 'standing', IN_YARD)?.state).not.toBe('ended');
  });

  it('rule 2: a credible actual start means departed on actual time, minutes late', () => {
    const result = classify({ scheduledStart: at(-30), actualStart: at(-20) }, 'standing', IN_YARD);
    expect(result).toMatchObject({
      state: 'departed',
      evidence: 'actual_time',
      minutesLate: 10,
      minutesOverdue: null,
    });
  });

  it('rule 2: an early departure has negative lateness', () => {
    const result = classify({ scheduledStart: at(-30), actualStart: at(-35) }, 'standing', AWAY);
    expect(result?.minutesLate).toBe(-5);
  });

  it('rule 2: the actual-time window is inclusive at both ends', () => {
    const early = classify(
      { scheduledStart: at(-30), actualStart: at(-30 - ACTUAL_START_WINDOW_MIN.before) },
      'standing',
      IN_YARD,
    );
    expect(early?.evidence).toBe('actual_time');
    const late = classify(
      { scheduledStart: at(-400), scheduledEnd: at(100), actualStart: at(-400 + ACTUAL_START_WINDOW_MIN.after) },
      'standing',
      IN_YARD,
    );
    expect(late?.evidence).toBe('actual_time');
  });

  it('rule 2: an actual start just outside the window is not evidence', () => {
    const result = classify(
      { scheduledStart: at(-30), actualStart: at(-30 - ACTUAL_START_WINDOW_MIN.before - 1) },
      'standing',
      IN_YARD,
    );
    expect(result?.evidence).not.toBe('actual_time');
  });

  it('rule 2: an actual start in the future of the feed clock is not evidence', () => {
    const result = classify({ scheduledStart: at(-30), actualStart: at(5) }, 'standing', IN_YARD);
    expect(result?.evidence).not.toBe('actual_time');
  });

  it('rule 2: lateness beyond the plausible maximum is departed without a figure', () => {
    const result = classify(
      { scheduledStart: at(-300), scheduledEnd: at(100), actualStart: at(-300 + MAX_PLAUSIBLE_DELAY_MIN + 1) },
      'standing',
      IN_YARD,
    );
    expect(result).toMatchObject({ state: 'departed', evidence: 'actual_time', minutesLate: null });
  });

  it('a stale actual start from days ago does not make today look on time', () => {
    const stale = at(-3 * 24 * 60);
    const inYard = classify({ scheduledStart: at(-60), actualStart: stale }, 'standing', IN_YARD);
    expect(inYard).toMatchObject({ state: 'overdue', evidence: 'none', minutesLate: null });
    const out = classify({ scheduledStart: at(-60), actualStart: stale }, 'in_service', AWAY);
    expect(out).toMatchObject({ state: 'departed', evidence: 'left_yard', minutesLate: null });
  });

  it('rule 3: a start after feedNow is upcoming', () => {
    expect(classify({ scheduledStart: at(1), scheduledEnd: at(200) }, 'standing', IN_YARD)).toMatchObject({
      state: 'upcoming',
      minutesLate: null,
      minutesOverdue: null,
    });
  });

  it('rule 3: a bus moving before its start has not departed for this journey', () => {
    expect(classify({ scheduledStart: at(20) }, 'in_service', AWAY)?.state).toBe('upcoming');
  });

  it('rule 3: a dark bus with a future start is upcoming, wherever it was last heard', () => {
    expect(classify({ scheduledStart: at(45) }, 'dark', IN_YARD)?.state).toBe('upcoming');
    expect(classify({ scheduledStart: at(45) }, 'dark', AWAY)?.state).toBe('upcoming');
    expect(classify({ scheduledStart: at(45) }, 'dark', UNKNOWN)?.state).toBe('upcoming');
  });

  it('rule 3: an unlocated bus with a future start is upcoming', () => {
    expect(classify({ scheduledStart: at(45) }, 'standing', UNKNOWN)?.state).toBe('upcoming');
  });

  it('rule 4: a dark bus at its scheduled start is unknown, never overdue', () => {
    const result = classify({ scheduledStart: at(0) }, 'dark', IN_YARD);
    expect(result).toMatchObject({ state: 'unknown', minutesOverdue: null, evidence: 'none' });
  });

  it('rule 4: a dark bus whose start has passed is unknown', () => {
    expect(classify({ scheduledStart: at(-90) }, 'dark', IN_YARD)?.state).toBe('unknown');
  });

  it('rule 4: an unlocated bus whose start has passed is unknown', () => {
    expect(classify({ scheduledStart: at(-90) }, 'standing', UNKNOWN)?.state).toBe('unknown');
  });

  it('rule 4: a dark bus last heard away is not evidence it left', () => {
    expect(classify({}, 'dark', AWAY)?.state).toBe('unknown');
  });

  it('rule 5: moving in service after the start means left the yard', () => {
    const result = classify({ scheduledStart: at(-20) }, 'in_service', IN_YARD);
    expect(result).toMatchObject({ state: 'departed', evidence: 'left_yard', minutesLate: null });
  });

  it('rule 5: on_road, away or at another yard also count as out', () => {
    expect(classify({}, 'on_road', IN_YARD)?.state).toBe('departed');
    expect(classify({}, 'standing', AWAY)?.state).toBe('departed');
    expect(classify({}, 'standing', OTHER)?.state).toBe('departed');
  });

  it('rule 6: due at the start and up to the end of the grace period', () => {
    expect(classify({ scheduledStart: at(0) }, 'standing', IN_YARD)?.state).toBe('due');
    expect(classify({ scheduledStart: at(-OUTSHED_GRACE_MIN) }, 'standing', IN_YARD)?.state).toBe('due');
  });

  it('rule 7: overdue one minute past grace, with minutes past the scheduled start', () => {
    const result = classify({ scheduledStart: at(-OUTSHED_GRACE_MIN - 1) }, 'standing', IN_YARD);
    expect(result).toMatchObject({
      state: 'overdue',
      minutesOverdue: OUTSHED_GRACE_MIN + 1,
      evidence: 'none',
    });
  });

  it('carries identity fields through', () => {
    const result = classify({ scheduledStart: at(-60) }, 'standing', IN_YARD);
    expect(result).toMatchObject({
      registrationNumber: 'UP32A0001',
      routeName: 'Route 1',
      journeyCode: 'J-1',
      scheduledStart: at(-60),
      scheduledEnd: at(240),
    });
  });
});

describe('summariseOutshed', () => {
  const homeYard: Yard = { lat: HOME.lat, lng: HOME.lng, radiusM: 200, parked: 10, inCluster: 10 };
  const yards = new Map([['1', homeYard]]);
  const standing = () => 'standing' as BusOpState;
  const outside = fromMetres({ x: 8000, y: 0 }, HOME.lat, HOME.lng);

  const rows = [
    row({ registrationNumber: 'C', scheduledStart: at(-60) }), // overdue, in yard
    row({ registrationNumber: 'A', scheduledStart: at(-120), latitude: outside.lat, longitude: outside.lng }), // departed
    row({ registrationNumber: 'B', scheduledStart: at(30) }), // upcoming
    row({ registrationNumber: 'Y', scheduledStart: '2026-10-05T08:00:00Z' }), // yesterday
    row({ registrationNumber: 'N', scheduledStart: null, routeName: null }), // no schedule
  ];

  it('counts every state and sorts by scheduled start', () => {
    const summary = summariseOutshed(rows, yards, FEED_NOW, standing);
    expect(summary.rows.map((r) => r.registrationNumber)).toEqual(['A', 'C', 'B']);
    expect(summary.counts).toEqual({
      upcoming: 1,
      due: 0,
      departed: 1,
      overdue: 1,
      ended: 0,
      unknown: 0,
    });
    expect(Object.values(summary.counts).reduce((a, b) => a + b, 0)).toBe(summary.rows.length);
  });

  it('reports coverage as scheduled rows out of the rows passed in', () => {
    expect(summariseOutshed(rows, yards, FEED_NOW, standing).coverage).toEqual({ n: 3, of: 5 });
  });

  it('uses the injected stateOf for every row', () => {
    const seen: string[] = [];
    summariseOutshed(rows, yards, FEED_NOW, (r) => {
      seen.push(r.registrationNumber);
      return 'dark';
    });
    expect(seen.length).toBeGreaterThan(0);
    const dark = summariseOutshed(rows, yards, FEED_NOW, () => 'dark');
    expect(dark.counts.unknown).toBe(2);
    expect(dark.counts.upcoming).toBe(1);
    expect(dark.counts.overdue).toBe(0);
  });

  it('returns an empty summary with zero counts for a null feedNow', () => {
    const summary = summariseOutshed(rows, yards, null, standing);
    expect(summary.rows).toEqual([]);
    expect(summary.counts).toEqual({ upcoming: 0, due: 0, departed: 0, overdue: 0, ended: 0, unknown: 0 });
    expect(summary.coverage).toEqual({ n: 0, of: 5 });
  });

  it('is empty for no rows', () => {
    expect(summariseOutshed([], yards, FEED_NOW, standing).coverage).toEqual({ n: 0, of: 0 });
  });

  it('sees each of two depots sharing one yard as in_yard (overdue, not at another yard)', () => {
    const shared = new Map([
      ['1', homeYard],
      ['2', homeYard],
    ]);
    const mine = row({ registrationNumber: 'M', depotId: '1', scheduledStart: at(-60) });
    const theirs = row({ registrationNumber: 'T', depotId: '2', scheduledStart: at(-60) });
    const summary = summariseOutshed([mine, theirs], shared, FEED_NOW, standing);
    expect(summary.counts.overdue).toBe(2);
    expect(summary.counts.departed).toBe(0);
  });

  it('is deterministic on shuffled input, including equal start times', () => {
    const same = [
      row({ registrationNumber: 'Z', journeyCode: 'J-2', scheduledStart: at(-60) }),
      row({ registrationNumber: 'Z', journeyCode: 'J-1', scheduledStart: at(-60) }),
      row({ registrationNumber: 'M', journeyCode: 'J-9', scheduledStart: at(-60) }),
    ];
    const baseline = summariseOutshed(same, yards, FEED_NOW, standing);
    expect(summariseOutshed([...same].reverse(), yards, FEED_NOW, standing)).toEqual(baseline);
    expect(summariseOutshed([same[1]!, same[2]!, same[0]!], yards, FEED_NOW, standing)).toEqual(
      baseline,
    );
  });

  it('does not mutate its inputs', () => {
    const frozenRows = rows.map((r) => Object.freeze({ ...r }));
    Object.freeze(frozenRows);
    Object.freeze(yards);
    const snapshot = JSON.stringify(frozenRows);
    summariseOutshed(frozenRows, yards, FEED_NOW, standing);
    expect(JSON.stringify(frozenRows)).toBe(snapshot);
  });
});
