// The timetable path: getStaticData rows -> a MEASURED target headway, or an
// explicit refusal to invent one.
//
// NO TEST HERE MAKES A NETWORK CALL. `timetable-corpus.json` is a pinned
// synthetic board shaped exactly like the endpoint's rows, built so each case
// below is isolated; `timetable-live-slice.json` is 45 verbatim rows captured
// from the production endpoint on 2026-08-10, so at least one test runs over
// bytes nobody wrote.

import { describe, expect, it } from 'vitest';
import {
  normalizeTimetablePayloads,
  normalizeTimetableRows,
  splitTimetableCorpus,
  toDirectionCode,
  wallClockSecondsOfDay,
  buildStaticDataUrl,
  STATIC_DATA_STOP_CODES,
} from '../../src/ingestion/upsrtc/staticData.js';
import { parseUpstreamInstant } from '../../src/ingestion/upsrtc/normalize.js';
import {
  buildTimetableIndex,
  collapseRepublishedDepartures,
  deriveTimetableHeadway,
  directionKey,
  lookupTimetableHeadway,
  medianGapSeconds,
  medianOf,
  MAX_TIMETABLE_HEADWAY_SECONDS,
  MIN_TIMETABLE_HEADWAY_SECONDS,
} from '../../src/seed/timetable.js';
import { loadFixture } from './fixtures.js';

const corpus = loadFixture('timetable-corpus');
const liveSlice = loadFixture('timetable-live-slice');

function index(payload: unknown = corpus) {
  const { rows } = normalizeTimetableRows(payload);
  return buildTimetableIndex(rows);
}

function headway(routeId: string, direction: string): number | null {
  return index().headwayByDirection.get(directionKey(routeId, direction))?.targetHeadwaySeconds ?? null;
}

// ============================================================================
// Reading the upstream clock
// ============================================================================

describe('wallClockSecondsOfDay', () => {
  it('reads the IST wall clock the `Z` suffix misdescribes, without shifting it', () => {
    // The endpoint stamps `2026-08-11T06:44:28Z` for a departure that happens at
    // 06:44 IST. Honouring the `Z` would move it 5.5 hours and put every
    // departure in a different frame from every other one.
    expect(wallClockSecondsOfDay('2026-08-11T06:44:28Z')).toBe(6 * 3600 + 44 * 60 + 28);

    // What honouring it would have produced, spelled out so the difference
    // cannot be mistaken for rounding.
    const asRealUtc = new Date(Date.parse('2026-08-11T06:44:28Z') + 5.5 * 3600 * 1000);
    expect(asRealUtc.getUTCHours()).toBe(12);
    expect(wallClockSecondsOfDay('2026-08-11T06:44:28Z')).not.toBe(
      asRealUtc.getUTCHours() * 3600 + asRealUtc.getUTCMinutes() * 60 + asRealUtc.getUTCSeconds(),
    );
  });

  it('is used INSTEAD OF parseUpstreamInstant because that helper rejects every timetable stamp', () => {
    // parseUpstreamInstant corrects the same defect by detecting a value in the
    // future and shifting it back one IST offset, then returning null if it is
    // still ahead. A timetable stamp is a SCHEDULED departure, so it is
    // legitimately in the future and that helper nulls it — measured, for 100%
    // of the corpus. This asserts the trap rather than trusting a comment.
    const nowMs = Date.parse('2026-08-10T14:37:00Z');
    expect(parseUpstreamInstant('2026-08-11T06:44:28Z', nowMs)).toBeNull();
    expect(wallClockSecondsOfDay('2026-08-11T06:44:28Z')).not.toBeNull();
  });

  it('folds an hour >= 24 into the next day rather than throwing or rejecting it', () => {
    // `28:37:51` is upstream's way of writing a post-midnight working (observed
    // on the sibling endpoint's to_arrival_time).
    expect(wallClockSecondsOfDay('28:37:51')).toBe(4 * 3600 + 37 * 60 + 51);
    expect(wallClockSecondsOfDay('24:00:00')).toBe(0);
    expect(wallClockSecondsOfDay('47:59:59')).toBe(23 * 3600 + 59 * 60 + 59);
    // Past 47:59 it is not a clock at all.
    expect(wallClockSecondsOfDay('48:00:00')).toBeNull();
  });

  it('accepts the bare wall-clock form and rejects unusable values', () => {
    expect(wallClockSecondsOfDay('10:00:00')).toBe(36_000);
    expect(wallClockSecondsOfDay('10:00')).toBe(36_000);
    expect(wallClockSecondsOfDay(null)).toBeNull();
    expect(wallClockSecondsOfDay('')).toBeNull();
    expect(wallClockSecondsOfDay('not a time')).toBeNull();
    expect(wallClockSecondsOfDay('10:99:00')).toBeNull();
  });
});

// ============================================================================
// Direction — stated, not parsed
// ============================================================================

describe('direction comes from line_direction, never from a name suffix', () => {
  it('maps the endpoint\'s own words', () => {
    expect(toDirectionCode('Outbound')).toBe('OUT');
    expect(toDirectionCode('Inbound')).toBe('IN');
    expect(toDirectionCode('inbound')).toBe('IN');
    expect(toDirectionCode('sideways')).toBeNull();
    expect(toDirectionCode(null)).toBeNull();
  });

  it('gives a direction to a route name that carries no _IN/_OUT suffix', () => {
    // ALM_11_VPL ends in a SERVICE CLASS, not a direction. The old suffix rule
    // had to invent a 'SINGLE' pseudo-direction for names like this — 118 of the
    // 656 seeded route-directions ended up that way.
    const identity = index().identityByRouteName.get('ALM_11_VPL');
    expect(identity?.directionCode).toBe('IN');
    expect(identity?.routeId).toBe('7762');
  });

  it('believes the stated direction over a contradicting name suffix', () => {
    // MIS_903_ORD_OUT is published with line_direction 'Inbound'. The suffix rule
    // would have said OUT and written the headway onto the wrong direction.
    const identity = index().identityByRouteName.get('MIS_903_ORD_OUT');
    expect(identity?.directionCode).toBe('IN');
    expect(headway('903', 'IN')).toBe(18 * 60);
    expect(headway('903', 'OUT')).toBeNull();
  });
});

// ============================================================================
// The estimator
// ============================================================================

describe('deriveTimetableHeadway', () => {
  it('derives a real headway from a multi-departure board', () => {
    // 05:30 / 05:55 / 06:20 / 06:45 at ALAMBAGH, and the same four journeys an
    // hour later at RAEBARELI. Both stop areas agree on 25 minutes.
    expect(headway('635', 'OUT')).toBe(25 * 60);

    const derived = index().headwayByDirection.get(directionKey('635', 'OUT'))!;
    expect(derived.stopAreaCount).toBe(2);
    expect(derived.sampleCount).toBe(4);
    expect(derived.stopAreaCodes).toEqual([1, 9]);
  });

  it('takes the MEDIAN gap, so one overnight break cannot swallow the headway', () => {
    // 05:00 / 05:20 / 05:40 / 22:00 -> gaps 1200, 1200, 58800.
    expect(headway('900', 'OUT')).toBe(1200);

    // What a mean or a span/(n-1) estimator would have produced instead. Both
    // land at 20,400s: 17x too large, so hFwd/H* could never reach the 0.5
    // warning ratio and the route would be silently undetectable.
    const gaps = [1200, 1200, 58_800];
    const mean = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    expect(mean).toBe(20_400);
    expect(headway('900', 'OUT')).not.toBe(mean);
  });

  it('buckets by stop area rather than pooling, so running time is never read as a gap', () => {
    // Four journeys on a 25-minute headway, seen at two stop areas 40 minutes
    // apart along the road. The service has ONE headway; the offset between the
    // observation points is not part of it.
    const first = [30, 55, 80, 105].map((minute) => minute * 60);
    const second = first.map((seconds) => seconds + 40 * 60);

    const bucketed = deriveTimetableHeadway(
      new Map([
        [1, new Set(first)],
        [9, new Set(second)],
      ]),
    );
    expect(bucketed).toMatchObject({ kind: 'derived', headway: { targetHeadwaySeconds: 25 * 60 } });

    // Pooled, the eight departures interleave and the running time between the
    // two stops is read as a gap. MEASURED across the whole corpus this bias
    // moves the median derived headway from 2,100s to 1,409s, and an H* biased
    // LOW is the silent-false-negative failure the whole change is about.
    const pooled = medianGapSeconds([...first, ...second]);
    expect(pooled).toBe(15 * 60);
    expect(pooled).toBeLessThan(25 * 60);
  });

  it('reads post-midnight departures written as hour >= 24', () => {
    // 23:00 / 23:45 / 24:30 / 25:15, i.e. a 45-minute night service that crosses
    // midnight. Folding puts two of them at the start of the day, which is
    // exactly the outlying gap the median is chosen to survive.
    expect(headway('904', 'OUT')).toBe(45 * 60);
  });

  it('collapses a working re-published under a second vehicle-journey id', () => {
    // Line 905 mirrors line 270 in the live corpus: vj 9050 and vj 9051 exactly
    // 60s apart at every stop area. Uncollapsed this yields H* = 60, which makes
    // every genuine headway read as a ratio far above 0.5 and turns detection
    // off for the route — the exact failure mode this module exists to remove.
    expect(headway('905', 'OUT')).toBeNull();

    expect(collapseRepublishedDepartures([34_189, 34_249])).toEqual([34_189]);
    // A genuine following departure survives.
    expect(collapseRepublishedDepartures([34_189, 34_489])).toEqual([34_189, 34_489]);
  });

  it('rejects an implausible derivation instead of clamping it', () => {
    // 06:00 and 18:00: a real gap, but a 12-hour one is a service span, not a
    // headway. A clamped 4h would look like a measurement and would not be one.
    const built = index();
    expect(built.headwayByDirection.get(directionKey('901', 'IN'))).toBeUndefined();
    expect(built.report.headwaysImplausible).toContainEqual({
      routeId: '901',
      directionCode: 'IN',
      seconds: 12 * 3600,
      sampleCount: 2,
      stopAreaCount: 1,
    });
    expect(12 * 3600).toBeGreaterThan(MAX_TIMETABLE_HEADWAY_SECONDS);
  });

  it('measures nothing when no stop area saw a second departure', () => {
    // Line 902 calls once at each of two stop areas. Two observations, zero
    // gaps: the honest answer is that this data cannot say.
    const built = index();
    expect(built.headwayByDirection.get(directionKey('902', 'OUT'))).toBeUndefined();
    expect(built.report.headwaysNoRepeatedDeparture).toBeGreaterThanOrEqual(1);
    expect(deriveTimetableHeadway(new Map([[2, new Set([32_400])]]))).toEqual({
      kind: 'no_repeated_departure',
    });
  });

  it('holds the credibility bounds where the constants say they are', () => {
    const atFloor = new Map([[1, new Set([0, MIN_TIMETABLE_HEADWAY_SECONDS])]]);
    expect(deriveTimetableHeadway(atFloor).kind).toBe('derived');

    const belowFloor = new Map([[1, new Set([0, MIN_TIMETABLE_HEADWAY_SECONDS - 1])]]);
    // Below the floor a gap is indistinguishable from a re-publication, so it is
    // collapsed away before it can be rejected — either way, no number.
    expect(deriveTimetableHeadway(belowFloor).kind).not.toBe('derived');

    const aboveCeiling = new Map([[1, new Set([0, MAX_TIMETABLE_HEADWAY_SECONDS + 60])]]);
    expect(deriveTimetableHeadway(aboveCeiling).kind).toBe('implausible');
  });
});

describe('medianOf', () => {
  it('is the middle value, and the mean of the middle two when even', () => {
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([1, 3, 5, 9])).toBe(4);
    expect(medianOf([])).toBeNull();
  });
});

// ============================================================================
// Lookup
// ============================================================================

describe('lookupTimetableHeadway', () => {
  it('matches on line id AND direction', () => {
    const built = index();
    expect(lookupTimetableHeadway(built, '635', 'OUT')).toMatchObject({
      match: 'exact',
      headway: { targetHeadwaySeconds: 1500 },
    });
    expect(lookupTimetableHeadway(built, '635', 'IN')).toMatchObject({
      match: 'exact',
      headway: { targetHeadwaySeconds: 2400 },
    });
  });

  it('resolves a pseudo-direction only when the line has exactly one real direction', () => {
    const built = index();
    // 7762 is published in one direction only, so 'SINGLE' can mean nothing else.
    expect(lookupTimetableHeadway(built, '7762', 'SINGLE')).toMatchObject({
      match: 'sole_direction',
      headway: { targetHeadwaySeconds: 1200 },
    });
    // 635 runs both ways: which one a 'SINGLE' meant is unknowable, so no guess.
    expect(lookupTimetableHeadway(built, '635', 'SINGLE')).toBeNull();
  });

  it('never substitutes the opposite direction for a real one it does not have', () => {
    // 635 IN exists and 903 IN exists; 903 OUT must NOT borrow 903 IN's number
    // just because the line is present.
    expect(lookupTimetableHeadway(index(), '903', 'OUT')).toBeNull();
  });

  it('returns nothing for a line the timetable never mentions', () => {
    expect(lookupTimetableHeadway(index(), '700', 'OUT')).toBeNull();
  });
});

// ============================================================================
// Corpus handling
// ============================================================================

describe('corpus normalization', () => {
  it('rejects a row that cannot contribute, and counts the rejection', () => {
    const result = normalizeTimetableRows([
      { stop_area_code: 1, line_id: 5, line_direction: 'Outbound', std: '06:00:00' },
      { stop_area_code: 1, line_id: 5, line_direction: 'Sideways', std: '06:30:00' },
      { stop_area_code: 1, line_direction: 'Outbound', std: '07:00:00' },
      { stop_area_code: 1, line_id: 5, line_direction: 'Outbound', std: 'nonsense' },
      'not an object',
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rowCount).toBe(5);
    expect(result.rejectedRowCount).toBe(4);
  });

  it('treats an empty stop board as a normal answer, not a failure', () => {
    // Stop codes 16 and 23 return `[]` permanently.
    const result = normalizeTimetableRows([]);
    expect(result.rows).toHaveLength(0);
    expect(result.rejectedRowCount).toBe(0);
  });

  it('accepts a saved corpus as rows, as per-stop arrays, or as a stop-code map', () => {
    const rows = normalizeTimetableRows(corpus).rows.length;
    expect(normalizeTimetablePayloads(splitTimetableCorpus(corpus)).rows).toHaveLength(rows);
    expect(normalizeTimetablePayloads(splitTimetableCorpus([corpus, []])).rows).toHaveLength(rows);
    expect(normalizeTimetablePayloads(splitTimetableCorpus({ '1': corpus, '16': [] })).rows).toHaveLength(
      rows,
    );
  });

  it('builds the documented request shape', () => {
    const url = new URL(buildStaticDataUrl(8, 1_700_000_000_000));
    expect(url.searchParams.get('stop_code')).toBe('8');
    expect(url.searchParams.get('plate_code')).toBe('');
    expect(url.searchParams.get('lang_id')).toBe('eng');
    expect(url.searchParams.get('_')).toBe('1700000000000');
    expect(STATIC_DATA_STOP_CODES).toHaveLength(24);
  });
});

describe('over 45 verbatim rows captured from the production endpoint', () => {
  it('derives the same headways the live corpus does', () => {
    const built = index(liveSlice);

    // AWD_1350_JRT_OUT: five departures at ALAMBAGH, ~3.5h apart. Seeded at the
    // fabricated 1,800s, which is 7x too FAST — the direction detection is most
    // likely to fire spuriously on.
    expect(built.headwayByDirection.get(directionKey('1350', 'OUT'))?.targetHeadwaySeconds).toBe(12_449);

    // CHB_316_ORD_OUT: seen at two stop areas, ~35 min apart. Seeded at 17,700s.
    expect(built.headwayByDirection.get(directionKey('316', 'OUT'))?.targetHeadwaySeconds).toBe(2095);

    // PYD_270_ORD_OUT: one working published twice, 60s apart, at three stop
    // areas. Uncollapsed this is the 60s trap; collapsed it is honestly nothing.
    expect(built.headwayByDirection.get(directionKey('270', 'OUT'))).toBeUndefined();
  });

  it('reads direction, line and route name straight out of the captured rows', () => {
    const identity = index(liveSlice).identityByRouteName.get('AWD_1350_JRT_OUT');
    expect(identity).toMatchObject({
      routeId: '1350',
      directionCode: 'OUT',
      publicName: 'MATHURA TO ALAMBAGH VIA AGRA EXPRESSWAY',
    });
  });
});
