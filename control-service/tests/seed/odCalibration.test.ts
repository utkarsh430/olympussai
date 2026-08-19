// The statewide OD schedule as the SECOND calibration source, end to end
// through the derivation, the precedence rule, the recalibration pass and the
// migration that constrains what they write.
//
// No database and no network: the pool is a recording fake, every payload is a
// pinned fixture or a shape recorded off the live endpoint.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  buildBusBetweenStopsBody,
  busBetweenStopsHeaders,
  fetchBusBetweenStops,
  normalizeOdRows,
  orderedCityPairs,
  splitOdCorpus,
} from '../../src/ingestion/upsrtc/busBetweenStops.js';
import { normalizeTimetableRows } from '../../src/ingestion/upsrtc/staticData.js';
import {
  DEFAULT_HEADWAY_SECONDS,
  UNCALIBRATED_HEADWAY_SENTINEL_SECONDS,
} from '../../src/seed/harvest.js';
import {
  buildOdIndex,
  deriveOdHeadway,
  lookupOdHeadway,
  UNSUFFIXED_DIRECTION,
} from '../../src/seed/odTimetable.js';
import { recalibrateHeadways, resolveHeadway } from '../../src/seed/recalibrate.js';
import { buildTimetableIndex } from '../../src/seed/timetable.js';
import { loadFixture } from './fixtures.js';

const MIGRATION_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

/** The corridor timetable, which line 635 IS in and line 4444 is NOT. */
const timetable = buildTimetableIndex(normalizeTimetableRows(loadFixture('timetable-corpus')).rows);

/** A recorded slice of getBusBetweenStops responses across several city pairs. */
const odCorpus = buildOdIndex(
  splitOdCorpus(loadFixture('od-corpus')).flatMap((payload) => normalizeOdRows(payload).rows),
);

/**
 * A row in the shape the endpoint actually returns. Only the fields the
 * derivation reads are varied; the rest are kept so the fixture stays
 * recognisable against a real payload.
 */
function odRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vj_id: 19237,
    trip_id: 'MZP0120',
    depot_name: 'MIRZAPUR',
    language_code: 'eng',
    service_type_name: 'ORDINARY',
    route_origin: 'LKM',
    route_destination: 'MZP',
    route_name: 'MZP_1310_ORD_OUT',
    route_id: 4335,
    route_desc: 'LAKHIMPUR TO MIRZAPUR',
    line_name: '1310',
    line_desc: 'LAKHIMPUR-MIRZAPUR',
    line_directional_desc: 'LAKHIMPUR TO MIRZAPUR',
    region_name: 'PRAYAGRAJ',
    from_stop_name: 'ALAMBAGH',
    to_stop_name: 'PRAYAGRAJ CIVIL LINES',
    from_arrival_time: '10:53:44',
    to_arrival_time: '18:23:29',
    reg_num: null,
    ...overrides,
  };
}

/** Departures at one boarding stop, as the derivation wants them. */
function atStop(stop: string, times: number[]): Map<string, Set<number>> {
  return new Map([[stop, new Set(times)]]);
}

const HOURS = 3600;

// ============================================================================
// The row reader
// ============================================================================

describe('normalizeOdRows', () => {
  it('reads a real row down to the departure it publishes', () => {
    const result = normalizeOdRows([odRow()]);

    expect(result.rowCount).toBe(1);
    expect(result.rejectedRowCount).toBe(0);
    expect(result.rows[0]).toMatchObject({
      journeyId: '19237',
      // line_name, NOT route_id: routes.id came from getScheduledBusInfo's
      // line_id and 4335 is a different identifier space entirely.
      lineName: '1310',
      routeName: 'MZP_1310_ORD_OUT',
      fromStopName: 'ALAMBAGH',
      departureSecondsOfDay: 10 * HOURS + 53 * 60 + 44,
    });
  });

  it('handles an hour >= 24 instead of crashing on it', () => {
    // MEASURED: `to_arrival_time` carries values like `28:37:51` for a working
    // that crosses midnight. That is an ordinary row, not a malformed one, and
    // rejecting or throwing on it would drop real service.
    const result = normalizeOdRows([odRow({ to_arrival_time: '28:37:51' })]);

    expect(result.rejectedRowCount).toBe(0);
    expect(result.rows[0]!.arrivalSecondsOfDay).toBe(4 * HOURS + 37 * 60 + 51);
  });

  it('accepts an hour >= 24 as a DEPARTURE too, folded into the same day frame', () => {
    const result = normalizeOdRows([odRow({ from_arrival_time: '25:10:00' })]);
    expect(result.rows[0]!.departureSecondsOfDay).toBe(1 * HOURS + 10 * 60);
  });

  it('rejects a row that cannot contribute a departure at a known point', () => {
    const result = normalizeOdRows([
      odRow({ line_name: null }),
      odRow({ from_stop_name: '' }),
      odRow({ from_arrival_time: 'not a clock' }),
      'not an object',
    ]);

    expect(result.rows).toEqual([]);
    expect(result.rejectedRowCount).toBe(4);
  });
});

// ============================================================================
// The request shape — the only one observed to work
// ============================================================================

describe('the OD request', () => {
  it('form-encodes the body the way the site does, spaces as +', () => {
    // `service_type=All+Bus+Types` is the encoding the endpoint was verified
    // against; %20 is an untested deviation.
    const body = buildBusBetweenStopsBody({ originId: 8, destinationId: 12, date: '2026-08-11' });

    expect(body).toBe(
      'origin_id=8&origin_classification=GROUP&destination_id=12' +
        '&destination_classification=GROUP&req_date=2026-08-11&service_type=All+Bus+Types',
    );
  });

  it('classifies both ends as GROUP, because origin_id is a CITY id here', () => {
    // getStaticData's stop_code is a STOP_AREA id (1 = ALAMBAGH);
    // getBusBetweenStops' origin_id under GROUP is a city id (8 = LUCKNOW). The
    // spaces collide numerically and mean different things, so the
    // classification is the discriminator, not decoration.
    expect(buildBusBetweenStopsBody({ originId: 8, destinationId: 12, date: '2026-08-11' }))
      .toContain('origin_classification=GROUP');
  });

  it('sends the headers the site sends, including the AJAX marker', () => {
    expect(busBetweenStopsHeaders()).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    });
  });

  it('POSTs through the shared tolerant-parse path rather than a second fetcher', async () => {
    // The upstream advertises text/html while returning JSON and answers with an
    // HTML error page on failure. That knowledge lives in fetchUpstream; a
    // second POST client would be a second place to get it wrong.
    const seen: { url: string; request: unknown }[] = [];
    const result = await fetchBusBetweenStops(
      { originId: 8, destinationId: 12, date: '2026-08-11' },
      1000,
      (url, _timeout, request) => {
        seen.push({ url, request });
        return Promise.resolve({ ok: true, status: 200, contentType: 'text/html', payload: [] });
      },
    );

    expect(seen[0]!.request).toMatchObject({
      method: 'POST',
      body: expect.stringContaining('origin_id=8'),
    });
    expect(result).toMatchObject({ originId: 8, destinationId: 12, error: null });
  });

  it('treats an empty response as no service, not as a failure', async () => {
    const result = await fetchBusBetweenStops(
      { originId: 1, destinationId: 2, date: '2026-08-11' },
      1000,
      () => Promise.resolve({ ok: true, status: 200, contentType: 'text/html', payload: [] }),
    );
    expect(result.error).toBeNull();
    expect(result.payload).toEqual([]);
  });

  it('sweeps every ORDERED pair and never a city against itself', () => {
    const pairs = orderedCityPairs([8, 12, 1]);

    expect(pairs).toHaveLength(6); // n * (n - 1)
    expect(pairs.some((pair) => pair.originId === pair.destinationId)).toBe(false);
    expect(pairs).toContainEqual({ originId: 8, destinationId: 12 });
    expect(pairs).toContainEqual({ originId: 12, destinationId: 8 });
  });
});

// ============================================================================
// The estimator
// ============================================================================

describe('deriveOdHeadway', () => {
  it('derives H* from realistic multi-trip departures at one boarding stop', () => {
    // A half-hourly morning service: 06:00 through 08:00 at 30-minute spacing.
    const departures = [6 * HOURS, 6.5 * HOURS, 7 * HOURS, 7.5 * HOURS, 8 * HOURS];
    const outcome = deriveOdHeadway(atStop('ALAMBAGH', departures));

    expect(outcome.kind).toBe('derived');
    if (outcome.kind !== 'derived') return;
    expect(outcome.headway.targetHeadwaySeconds).toBe(1800);
    expect(outcome.headway.sampleCount).toBe(5);
    expect(outcome.headway.stopCount).toBe(1);
    expect(outcome.headway.stopNames).toEqual(['ALAMBAGH']);
  });

  it('takes the MEDIAN gap, so an overnight break does not become the headway', () => {
    // Four departures 20 minutes apart in the morning, then the first working of
    // the next service period 11 hours later. The mean gap is 2h48m and
    // span/(n-1) says the same; the median says 20 minutes, which is what the
    // service actually runs at. An H* inflated 8x can never be reached by
    // hFwd/H*, so the route would be silently undetectable.
    const departures = [6 * HOURS, 6 * HOURS + 1200, 6 * HOURS + 2400, 6 * HOURS + 3600, 17 * HOURS];
    const outcome = deriveOdHeadway(atStop('ALAMBAGH', departures));

    expect(outcome.kind).toBe('derived');
    if (outcome.kind !== 'derived') return;
    expect(outcome.headway.targetHeadwaySeconds).toBe(1200);

    const gaps = [1200, 1200, 1200, 17 * HOURS - (6 * HOURS + 3600)];
    const mean = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    expect(mean).toBeGreaterThan(9000);
    expect(outcome.headway.targetHeadwaySeconds).not.toBe(mean);
  });

  it('rejects an implausible derivation rather than clamping it', () => {
    // Two departures 9 hours apart is not a headway; it is two long-distance
    // workings. A clamped 4h would look like a measurement and is not one.
    const outcome = deriveOdHeadway(atStop('ALAMBAGH', [6 * HOURS, 15 * HOURS]));

    expect(outcome.kind).toBe('implausible');
    if (outcome.kind !== 'implausible') return;
    expect(outcome.seconds).toBe(9 * HOURS);
  });

  it('rejects a derivation below the credibility floor as well', () => {
    const outcome = deriveOdHeadway(atStop('ALAMBAGH', [6 * HOURS, 6 * HOURS + 200, 6 * HOURS + 400]));
    // 200s gaps survive the 120s re-publication collapse but sit under the
    // 5-minute floor, and an H* biased LOW is the silent-false-negative case.
    expect(outcome.kind).toBe('implausible');
  });

  it('says so when no boarding stop saw two departures, instead of guessing', () => {
    const departures = new Map([
      ['ALAMBAGH', new Set([6 * HOURS])],
      ['KAISERBAGH', new Set([6 * HOURS + 900])],
    ]);
    expect(deriveOdHeadway(departures).kind).toBe('no_repeated_departure');
  });

  it('medians ACROSS boarding stops once each has its own median', () => {
    const departures = new Map([
      ['ALAMBAGH', new Set([6 * HOURS, 6.5 * HOURS, 7 * HOURS])],
      ['KAISERBAGH', new Set([6 * HOURS, 7 * HOURS, 8 * HOURS])],
      ['CHARBAGH', new Set([6 * HOURS, 6.25 * HOURS, 6.5 * HOURS])],
    ]);
    const outcome = deriveOdHeadway(departures);

    expect(outcome.kind).toBe('derived');
    if (outcome.kind !== 'derived') return;
    // Per-stop medians are 1800, 3600 and 900; the median of those is 1800.
    expect(outcome.headway.targetHeadwaySeconds).toBe(1800);
    expect(outcome.headway.stopCount).toBe(3);
  });
});

// ============================================================================
// The index: bucketing, deduping and direction
// ============================================================================

describe('buildOdIndex', () => {
  it('never pools boarding stops, so one bus leaving a city is not a headway', () => {
    // MEASURED on a real Lucknow -> Prayagraj response: vj_id 19237 appears
    // twice, at KAISERBAGH 10:53:44 and ALAMBAGH 11:08:52. That is ONE bus
    // fifteen minutes apart. Pooled, it manufactures a 15-minute service out of
    // a single working — an H* biased low, which is silent non-detection.
    const index = buildOdIndex(
      normalizeOdRows([
        odRow({ from_stop_name: 'KAISERBAGH', from_arrival_time: '10:53:44' }),
        odRow({ from_stop_name: 'ALAMBAGH', from_arrival_time: '11:08:52' }),
      ]).rows,
    );

    expect(index.report.headwaysDerived).toBe(0);
    expect(index.report.headwaysNoRepeatedDeparture).toBe(1);
    expect(index.headwayByDirection.size).toBe(0);
  });

  it('counts a journey once however many city pairs returned it', () => {
    // A route spanning five cities comes back from every pair it covers, so the
    // sweep's output is heavily redundant by design.
    const rows = normalizeOdRows([
      odRow({ from_arrival_time: '06:00:00' }),
      odRow({ from_arrival_time: '06:00:00' }),
      odRow({ from_arrival_time: '06:00:00' }),
      odRow({ from_arrival_time: '07:00:00' }),
    ]).rows;
    const index = buildOdIndex(rows);
    const headway = index.headwayByDirection.get('1310|OUT')!;

    expect(headway.targetHeadwaySeconds).toBe(3600);
    expect(headway.sampleCount).toBe(2);
  });

  it('takes direction from the _IN/_OUT suffix and keeps the two apart', () => {
    const index = buildOdIndex(
      normalizeOdRows([
        odRow({ route_name: 'MZP_1310_ORD_OUT', from_arrival_time: '06:00:00' }),
        odRow({ route_name: 'MZP_1310_ORD_OUT', from_arrival_time: '06:30:00' }),
        odRow({ route_name: 'MZP_1310_ORD_IN', from_arrival_time: '14:00:00' }),
        odRow({ route_name: 'MZP_1310_ORD_IN', from_arrival_time: '15:00:00' }),
      ]).rows,
    );

    expect(index.headwayByDirection.get('1310|OUT')!.targetHeadwaySeconds).toBe(1800);
    expect(index.headwayByDirection.get('1310|IN')!.targetHeadwaySeconds).toBe(3600);
    expect(index.directionsByRouteId.get('1310')).toEqual(new Set(['OUT', 'IN']));
  });

  it('parks an unsuffixed route name under its own key rather than guessing OUT', () => {
    const index = buildOdIndex(
      normalizeOdRows([
        odRow({ route_name: 'MZP_700_ORD', from_arrival_time: '06:00:00' }),
        odRow({ route_name: 'MZP_700_ORD', from_arrival_time: '06:30:00' }),
      ]).rows,
    );

    expect(index.directionsByRouteId.get('1310')).toEqual(new Set([UNSUFFIXED_DIRECTION]));
    expect(index.headwayByDirection.has('1310|OUT')).toBe(false);
    expect(index.report.rowsWithoutDirectionSuffix).toBe(2);
  });

  it('indexes a recorded three-city-pair slice, deriving only credible values', () => {
    // A real capture: three per-pair payloads straight off the sweep, which also
    // exercises splitOdCorpus's array-of-arrays shape.
    expect(odCorpus.report.rowsAccepted).toBe(360);
    expect(odCorpus.report.distinctLines).toBeGreaterThan(10);
    expect(odCorpus.report.headwaysDerived).toBeGreaterThan(0);

    for (const headway of odCorpus.headwayByDirection.values()) {
      // Every derived value is inside the credibility bounds, because an
      // out-of-bounds one is REJECTED rather than clamped.
      expect(headway.targetHeadwaySeconds).toBeGreaterThanOrEqual(300);
      expect(headway.targetHeadwaySeconds).toBeLessThanOrEqual(14_400);
      expect(headway.sampleCount).toBeGreaterThanOrEqual(2);
      expect(headway.stopNames.length).toBe(headway.stopCount);
    }
  });

  it('leaves the real corpus with far more lines than derived headways', () => {
    // The honest shape of this source: most lines appear once and have no gap to
    // measure. A module that "derived" something for all of them would be
    // inventing, which is the failure this whole line of work removes.
    expect(odCorpus.report.headwaysDerived).toBeLessThan(odCorpus.report.distinctLineDirections);
    expect(odCorpus.report.headwaysNoRepeatedDeparture).toBeGreaterThan(0);
  });
});

// ============================================================================
// Lookup
// ============================================================================

describe('lookupOdHeadway', () => {
  const index = buildOdIndex(
    normalizeOdRows([
      odRow({ line_name: '1310', route_name: 'MZP_1310_ORD_OUT', from_arrival_time: '06:00:00' }),
      odRow({ line_name: '1310', route_name: 'MZP_1310_ORD_OUT', from_arrival_time: '06:30:00' }),
      odRow({ line_name: '9999', route_name: 'AAA_9999_ORD', from_arrival_time: '06:00:00' }),
      odRow({ line_name: '9999', route_name: 'AAA_9999_ORD', from_arrival_time: '07:00:00' }),
      odRow({ line_name: '5555', route_name: 'BBB_5555_ORD_OUT', from_arrival_time: '06:00:00' }),
      odRow({ line_name: '5555', route_name: 'BBB_5555_ORD_OUT', from_arrival_time: '06:20:00' }),
      odRow({ line_name: '5555', route_name: 'BBB_5555_ORD_IN', from_arrival_time: '16:00:00' }),
      odRow({ line_name: '5555', route_name: 'BBB_5555_ORD_IN', from_arrival_time: '17:00:00' }),
    ]).rows,
  );

  it('matches exactly on line and direction', () => {
    expect(lookupOdHeadway(index, '1310', 'OUT')).toMatchObject({
      match: 'exact',
      headway: { targetHeadwaySeconds: 1800 },
    });
  });

  it('resolves a pseudo-direction only when the line runs one way', () => {
    // 'SINGLE' and 'UP' are what the OLD seeder invented for a route name with
    // no suffix. With one direction published there is only one answer it could
    // be; with two, resolving it would be a guess.
    expect(lookupOdHeadway(index, '9999', 'SINGLE')).toMatchObject({ match: 'sole_direction' });
    expect(lookupOdHeadway(index, '5555', 'SINGLE')).toBeNull();
  });

  it('refuses to hand an outbound headway to the inbound direction', () => {
    // Inbound and outbound of one line routinely run at different frequencies,
    // and 1310 is published outbound only here. Answering anyway would be the
    // same class of guess this work exists to delete.
    expect(lookupOdHeadway(index, '1310', 'IN')).toBeNull();
  });

  it('returns null for a line the corpus never mentions', () => {
    expect(lookupOdHeadway(index, '404404', 'OUT')).toBeNull();
  });
});

// ============================================================================
// PRECEDENCE — the property this whole change turns on
// ============================================================================

describe('precedence: timetable > od_timetable > none', () => {
  /** Line 635 OUT is in the corridor timetable at 1,500s. */
  const odDisagreeing = buildOdIndex(
    normalizeOdRows([
      odRow({ line_name: '635', route_name: 'RKD_635_ORD_OUT', from_arrival_time: '06:00:00' }),
      odRow({ line_name: '635', route_name: 'RKD_635_ORD_OUT', from_arrival_time: '07:00:00' }),
      odRow({ line_name: '4444', route_name: 'ZZZ_4444_ORD_OUT', from_arrival_time: '06:00:00' }),
      odRow({ line_name: '4444', route_name: 'ZZZ_4444_ORD_OUT', from_arrival_time: '06:30:00' }),
    ]).rows,
  );

  it('keeps the corridor timetable when both sources answer, and the OD value differs', () => {
    // The OD corpus above says 3,600s for line 635 OUT; the departure board says
    // 1,500s. The board wins, and it wins because the OD index is never
    // consulted after a timetable hit — not because 1,500 is preferred.
    expect(odDisagreeing.headwayByDirection.get('635|OUT')!.targetHeadwaySeconds).toBe(3600);

    expect(resolveHeadway('635', 'OUT', timetable, odDisagreeing)).toMatchObject({
      source: 'timetable',
      targetHeadwaySeconds: 1500,
    });
  });

  it('uses the OD schedule exactly where the corridor timetable is silent', () => {
    expect(resolveHeadway('4444', 'OUT', timetable, odDisagreeing)).toMatchObject({
      source: 'od_timetable',
      targetHeadwaySeconds: 1800,
      match: 'exact',
    });
  });

  it('leaves a route neither source covers as \'none\' with the sentinel', () => {
    const resolved = resolveHeadway('700', 'OUT', timetable, odDisagreeing);

    expect(resolved.source).toBe('none');
    expect(resolved.targetHeadwaySeconds).toBe(UNCALIBRATED_HEADWAY_SENTINEL_SECONDS);
    expect(resolved.targetHeadwaySeconds).not.toBe(DEFAULT_HEADWAY_SECONDS);
    expect(resolved.match).toBeNull();
  });

  it('still answers when only one of the two sources exists', () => {
    expect(resolveHeadway('4444', 'OUT', null, odDisagreeing).source).toBe('od_timetable');
    expect(resolveHeadway('635', 'OUT', timetable, null).source).toBe('timetable');
    expect(resolveHeadway('635', 'OUT', null, null).source).toBe('none');
  });
});

// ============================================================================
// The recalibration pass
// ============================================================================

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim().toLowerCase();

function fakePool(
  directions: { id: string; route_id: string; direction_code: string }[],
  policies: Record<string, Record<string, unknown>> = {},
): { pool: Pool; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const query = (sql: string, params: unknown[] = []) => {
    const normalized = normalize(sql);
    queries.push({ sql: normalized, params });
    if (normalized.startsWith('select id, route_id, direction_code')) {
      return Promise.resolve({ rows: directions, rowCount: directions.length });
    }
    if (normalized.startsWith('select id, target_headway_seconds')) {
      const existing = policies[String(params[0])];
      return existing
        ? Promise.resolve({ rows: [existing], rowCount: 1 })
        : Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  };
  const client = { query, release: vi.fn() };
  const pool = { connect: () => Promise.resolve(client), query } as unknown as Pool;
  return { pool, queries };
}

const openPolicy = (overrides: Record<string, unknown> = {}) => ({
  id: 'policy-1',
  target_headway_seconds: '1800',
  kf: '0.4',
  kb: '0.2',
  self_equalizing_k: '0.35',
  calibration_source: 'default',
  ...overrides,
});

describe('recalibrateHeadways with both sources', () => {
  const od = buildOdIndex(
    normalizeOdRows([
      odRow({ line_name: '635', route_name: 'RKD_635_ORD_OUT', from_arrival_time: '06:00:00' }),
      odRow({ line_name: '635', route_name: 'RKD_635_ORD_OUT', from_arrival_time: '07:00:00' }),
      odRow({ line_name: '4444', route_name: 'ZZZ_4444_ORD_OUT', from_arrival_time: '06:00:00' }),
      odRow({ line_name: '4444', route_name: 'ZZZ_4444_ORD_OUT', from_arrival_time: '06:30:00' }),
    ]).rows,
  );

  it('NEVER overwrites a route-direction that already holds a timetable H*', async () => {
    // rd-1 holds the corridor board's own 1,500s. The OD corpus would say
    // 3,600s. The run must not touch it: no insert, no new version, and the
    // audit trail must record zero downgrades.
    const handle = fakePool([{ id: 'rd-1', route_id: '635', direction_code: 'OUT' }], {
      'rd-1': openPolicy({ target_headway_seconds: '1500', calibration_source: 'timetable' }),
    });

    const result = await recalibrateHeadways(handle.pool, timetable, od);

    expect(result.calibratedFromTimetable).toBe(1);
    expect(result.calibratedFromOd).toBe(0);
    expect(result.policiesInserted).toBe(0);
    expect(result.policiesUnchanged).toBe(1);
    expect(result.changed).toHaveLength(0);
    expect(
      handle.queries.some((entry) => entry.sql.startsWith('insert into route_policies')),
    ).toBe(false);
  });

  it('writes od_timetable where the corridor timetable had no answer', async () => {
    const handle = fakePool([{ id: 'rd-2', route_id: '4444', direction_code: 'OUT' }], {
      'rd-2': openPolicy({ target_headway_seconds: '1', calibration_source: 'none' }),
    });

    const result = await recalibrateHeadways(handle.pool, timetable, od);

    expect(result.calibratedFromOd).toBe(1);
    expect(result.calibrated).toBe(1);
    expect(result.changed[0]).toMatchObject({
      routeId: '4444',
      calibrationSource: 'od_timetable',
      targetHeadwaySeconds: 1800,
      previousCalibrationSource: 'none',
      match: 'exact',
    });

    const insert = handle.queries.find((entry) =>
      entry.sql.startsWith('insert into route_policies'),
    )!;
    expect(insert.params[1]).toBe(1800);
    expect(insert.params[5]).toBe('od_timetable');
  });

  it('leaves a route neither source covers at \'none\', with no fabricated number', async () => {
    const handle = fakePool([{ id: 'rd-3', route_id: '700', direction_code: 'OUT' }], {
      'rd-3': openPolicy({ target_headway_seconds: '26130' }),
    });

    const result = await recalibrateHeadways(handle.pool, timetable, od);

    expect(result.calibrated).toBe(0);
    expect(result.uncalibrated).toBe(1);
    const insert = handle.queries.find((entry) =>
      entry.sql.startsWith('insert into route_policies'),
    )!;
    expect(insert.params[1]).toBe(UNCALIBRATED_HEADWAY_SENTINEL_SECONDS);
    expect(insert.params[5]).toBe('none');
    expect(insert.params[1]).not.toBe(DEFAULT_HEADWAY_SECONDS);
  });

  it('reports a source breakdown that adds up to every direction considered', async () => {
    const handle = fakePool(
      [
        { id: 'rd-1', route_id: '635', direction_code: 'OUT' },
        { id: 'rd-2', route_id: '4444', direction_code: 'OUT' },
        { id: 'rd-3', route_id: '700', direction_code: 'OUT' },
      ],
      { 'rd-1': openPolicy(), 'rd-2': openPolicy(), 'rd-3': openPolicy() },
    );

    const result = await recalibrateHeadways(handle.pool, timetable, od);

    expect(result.routeDirectionsConsidered).toBe(3);
    expect(
      result.calibratedFromTimetable + result.calibratedFromOd + result.uncalibrated,
    ).toBe(result.routeDirectionsConsidered);
    expect(result.calibratedFromTimetable).toBe(1);
    expect(result.calibratedFromOd).toBe(1);
    expect(result.uncalibrated).toBe(1);
  });

  it('behaves exactly as before when no OD corpus is supplied', async () => {
    const handle = fakePool([{ id: 'rd-4', route_id: '4444', direction_code: 'OUT' }], {
      'rd-4': openPolicy(),
    });

    const result = await recalibrateHeadways(handle.pool, timetable, null);

    expect(result.calibrated).toBe(0);
    expect(result.uncalibrated).toBe(1);
    expect(result.calibratedFromOd).toBe(0);
  });
});

// ============================================================================
// The database has to accept what the seeder emits
// ============================================================================

describe('od_timetable in the schema', () => {
  /** The constraint as the LAST migration that touches it leaves it. */
  function allowedSources(): string[] {
    const files = readdirSync(MIGRATION_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    let allowed: string[] | null = null;
    for (const file of files) {
      const sql = readFileSync(join(MIGRATION_DIR, file), 'utf8');
      const match = /check \(calibration_source in \(([^)]+)\)\)/.exec(sql);
      if (match) {
        allowed = match[1]!.split(',').map((value) => value.trim().replace(/^'|'$/g, ''));
      }
    }
    return allowed!;
  }

  it('admits od_timetable without dropping any source that came before it', () => {
    expect(allowedSources()).toEqual(
      expect.arrayContaining([
        'timetable',
        'od_timetable',
        'journey_span',
        'fleet_span',
        'default',
        'none',
      ]),
    );
  });

  it('adds the source in a NEW migration, leaving the shipped one untouched', () => {
    // The 2026-08-10 migration is applied in production. Editing it would mean
    // the constraint in the database and the constraint in the repository say
    // different things, with nothing to notice.
    const shipped = readFileSync(
      join(MIGRATION_DIR, '20260810120000__route_policy_timetable_calibration.sql'),
      'utf8',
    );
    expect(shipped).not.toContain('od_timetable');

    const added = readFileSync(
      join(MIGRATION_DIR, '20260811090000__route_policy_od_timetable_calibration.sql'),
      'utf8',
    );
    expect(added).toContain("'od_timetable'");
  });

  it('leaves the uncalibrated-sentinel CHECK exactly as it was', () => {
    // The sentinel pin is what stops a 'none' row from carrying a
    // plausible-looking target. Adding a source must not drop, weaken or
    // redefine it — the new migration may only MENTION it in prose.
    const added = readFileSync(
      join(MIGRATION_DIR, '20260811090000__route_policy_od_timetable_calibration.sql'),
      'utf8',
    );
    const statements = added
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    expect(statements).not.toMatch(
      /(drop|add)\s+constraint\s+(if\s+exists\s+)?route_policies_uncalibrated_sentinel_check/i,
    );
    // And the only constraint it does touch is the source list.
    expect(statements.match(/add constraint (\w+)/g)).toEqual([
      'add constraint route_policies_calibration_source_check',
    ]);
  });

  it('is loaded by the readers, because they exclude \'none\' rather than allow-list', () => {
    // An 'od_timetable' H* is a measurement and detection SHOULD run against it.
    // Both readers filter with a DENY-list - MEASURED_POLICY_PREDICATE, which
    // names only the two sources that mean "no measurement" ('none', and
    // 'default', which harvest.ts calls FABRICATED). A deny-list admits a newly
    // added measured source without either query being touched; assert that, so
    // a future change to an allow-list cannot silently switch detection off for
    // the OD-calibrated majority of the network.
    const repositoryDir = join(dirname(fileURLToPath(import.meta.url)), '../../src');
    for (const file of ['headway/repository.ts', 'db/rehydrate.ts']) {
      const source = readFileSync(join(repositoryDir, file), 'utf8');
      expect(source).toContain('MEASURED_POLICY_PREDICATE');
      expect(source).not.toContain("calibration_source in (");
    }
  });
});
