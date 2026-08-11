// CLI argument parsing, the hand-rolled semaphore, and the
// "Bus Not Assigned" retry.
//
// fetchUpstream is stubbed, so NO TEST HERE MAKES A NETWORK CALL — the retry
// behaviour is asserted against recorded upstream bodies.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONCURRENCY,
  fetchScheduleWithRetry,
  logHeadwayCalibration,
  mapWithConcurrency,
  parseArgs,
  parseGains,
} from '../../src/seed/index.js';
import * as client from '../../src/ingestion/upsrtc/client.js';
import { harvestNetwork } from '../../src/seed/harvest.js';
import { logger } from '../../src/lib/logger.js';
import { liveFeed, loadFixture, probe } from './fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseArgs', () => {
  it('defaults to a safe, non-destructive posture', () => {
    const options = parseArgs([]);
    expect(options).toMatchObject({
      dryRun: false,
      routes: null,
      date: null,
      concurrency: DEFAULT_CONCURRENCY,
      rolloutStage: 'observation',
      forceRolloutStage: false,
      defaultHeadwaySeconds: 1800,
      gains: { kf: 0.4, kb: 0.2, selfEqualizingK: 0.35 },
      reportPath: null,
      limit: null,
      // Both published sources are ON by default. Turning either off is
      // something an operator has to ask for by name.
      noTimetable: false,
      noOd: false,
      odFile: null,
      odOut: null,
      odDate: null,
    });
  });

  it('parses every documented flag', () => {
    const options = parseArgs([
      '--dry-run',
      '--routes=AAA_1_ORD_OUT, BBB_2_ORD',
      '--date=2026-07-18',
      '--concurrency=6',
      '--rollout-stage=advisory',
      '--default-headway-seconds=900',
      '--gains=0.5,0.25,0.4',
      '--report=/tmp/seed-report.json',
      '--limit=8',
      '--timetable-file=/tmp/tt.json',
      '--timetable-out=/tmp/tt-out.json',
      '--od-file=/tmp/od.json',
      '--od-out=/tmp/od-out.json',
      '--od-date=2026-07-19',
      '--no-od',
    ]);
    expect(options).toMatchObject({
      dryRun: true,
      routes: ['AAA_1_ORD_OUT', 'BBB_2_ORD'],
      date: '2026-07-18',
      concurrency: 6,
      rolloutStage: 'advisory',
      defaultHeadwaySeconds: 900,
      gains: { kf: 0.5, kb: 0.25, selfEqualizingK: 0.4 },
      reportPath: '/tmp/seed-report.json',
      limit: 8,
      timetableFile: '/tmp/tt.json',
      timetableOut: '/tmp/tt-out.json',
      odFile: '/tmp/od.json',
      odOut: '/tmp/od-out.json',
      odDate: '2026-07-19',
      noOd: true,
    });
  });

  it('rejects a malformed --od-date, which would silently sweep the wrong day', () => {
    expect(() => parseArgs(['--od-date=19-07-2026'])).toThrow(/YYYY-MM-DD/);
  });

  it('clamps concurrency so the shared upstream endpoint is never hammered', () => {
    expect(parseArgs(['--concurrency=99']).concurrency).toBe(8);
    expect(parseArgs(['--concurrency=1']).concurrency).toBe(1);
  });

  it('rejects an unknown rollout stage rather than seeding an invalid one', () => {
    // The column has a CHECK constraint; failing here beats failing 500
    // transactions in.
    expect(() => parseArgs(['--rollout-stage=yolo'])).toThrow(/rollout-stage/);
  });

  it('rejects a malformed date and a non-positive limit', () => {
    expect(() => parseArgs(['--date=18-07-2026'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--limit=0'])).toThrow(/limit/);
  });

  it('treats --max-stop-detour-meters=0 as "disable pruning", not "use the default"', () => {
    expect(parseArgs(['--max-stop-detour-meters=0']).maxStopDetourMeters).toBe(0);
    expect(parseArgs([]).maxStopDetourMeters).toBeGreaterThan(0);
  });

  it('requires three finite gains', () => {
    expect(parseGains('0.4,0.2,0.35')).toEqual({ kf: 0.4, kb: 0.2, selfEqualizingK: 0.35 });
    expect(() => parseGains('0.4,0.2')).toThrow(/three finite numbers/);
    expect(() => parseGains('a,b,c')).toThrow(/three finite numbers/);
  });
});

describe('logHeadwayCalibration', () => {
  it('prints the breakdown by source, so the run itself says how much is fabricated', () => {
    // Discovering that two thirds of the network has no real target by writing
    // SQL against route_policies is discovering it too late.
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const seed = harvestNetwork(loadFixture('live-feed-fleet'), [
      probe('schedule-loop'), // fleet_span
      probe('schedule-same-direction-repeat'), // journey_span
      probe('schedule-suffixed-pair'), // no evidence either way -> default x2
    ]);
    logHeadwayCalibration(seed.report, 1800);

    const call = info.mock.calls.find(([, message]) => String(message).includes('calibration'))!;
    expect(call[0]).toMatchObject({
      journey_span: 1,
      fleet_span: 1,
      default: 2,
      derivedPct: '50.0%',
      fabricatedPct: '50.0%',
    });
  });

  it('warns — not merely informs — when any direction carries a fabricated target', () => {
    // A fallback H* raises no error, fails no constraint and appears in no
    // failure list; it just silently stops the route being detectable.
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const seed = harvestNetwork(liveFeed, [probe('schedule-loop')]);
    logHeadwayCalibration(seed.report, 900);

    const call = warn.mock.calls.find(([, message]) => String(message).includes('FABRICATED'))!;
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({ directions: 1, share: '100.0%', fallbackSeconds: 900 });
    expect(String(call[1])).toContain("calibration_source = 'default'");
  });

  it('stays quiet when every direction has a real target', () => {
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const seed = harvestNetwork(liveFeed, [probe('schedule-same-direction-repeat')]);
    expect(seed.report.headwayCalibration).toMatchObject({ journey_span: 1, default: 0 });
    logHeadwayCalibration(seed.report, 1800);
    expect(warn).not.toHaveBeenCalled();
  });

  it('breaks the measured share down by source instead of collapsing the two', () => {
    // 'timetable' and 'od_timetable' are both measurements and both count
    // towards `measuredPct` — but they are different observations, and a report
    // that only showed the total would hide which half of the network is
    // calibrated from a departure board and which from a coarser sweep.
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const seed = harvestNetwork(liveFeed, [probe('schedule-loop')]);
    seed.report.headwayCalibration = {
      timetable: 1,
      od_timetable: 3,
      journey_span: 0,
      fleet_span: 0,
      default: 0,
      none: 4,
    };
    logHeadwayCalibration(seed.report, 1800);

    const call = info.mock.calls.find(([, message]) => String(message).includes('calibration'))!;
    expect(call[0]).toMatchObject({
      timetable: 1,
      od_timetable: 3,
      measuredPct: '50.0%',
      fromTimetablePct: '12.5%',
      fromOdTimetablePct: '37.5%',
      noTargetPct: '50.0%',
    });
  });

  it('still warns loudly about the route-directions with no target at all', () => {
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const seed = harvestNetwork(liveFeed, [probe('schedule-loop')]);
    seed.report.headwayCalibration = {
      timetable: 0,
      od_timetable: 1,
      journey_span: 0,
      fleet_span: 0,
      default: 0,
      none: 3,
    };
    logHeadwayCalibration(seed.report, 1800);

    const call = warn.mock.calls.find(([, message]) => String(message).includes('NO target'))!;
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({ directions: 3, share: '75.0%' });
    expect(String(call[1])).toContain("calibration_source = 'none'");
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order in the results regardless of completion order', async () => {
    const results = await mapWithConcurrency([30, 10, 20, 0], 4, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return `${index}:${delay}`;
    });
    expect(results).toEqual(['0:30', '1:10', '2:20', '3:0']);
  });

  it('never runs more than the configured number at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_unused, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty input without spawning a worker', async () => {
    const worker = vi.fn();
    await expect(mapWithConcurrency([], 4, worker)).resolves.toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });
});

describe('fetchScheduleWithRetry', () => {
  const target = { routeName: 'AAA_100_ORD_OUT', registrationNumber: 'UP11AA1001' };
  const unassigned = loadFixture('schedule-unassigned');
  const assigned = loadFixture('schedule-loop');

  it('retries on the previous service date when the vehicle is unassigned', async () => {
    // Measured: 9 of 10 probes on the current date answer " Bus Not
    // Assigned!!! ", versus 3 of 12 on date-1 — the retry is the difference
    // between a ~10% and a ~75% harvest yield.
    const spy = vi
      .spyOn(client, 'fetchUpstream')
      .mockResolvedValueOnce({ ok: true, status: 200, contentType: 'text/html', payload: unassigned })
      .mockResolvedValueOnce({ ok: true, status: 200, contentType: 'text/html', payload: assigned });

    const result = await fetchScheduleWithRetry(target, '2026-08-09');
    expect(result.date).toBe('2026-08-08');
    expect(result.payload).toEqual(assigned);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]![0]).toContain('date=2026-08-09');
    expect(spy.mock.calls[1]![0]).toContain('date=2026-08-08');
  });

  it('does not retry when the first date already has a schedule', async () => {
    const spy = vi
      .spyOn(client, 'fetchUpstream')
      .mockResolvedValue({ ok: true, status: 200, contentType: 'text/html', payload: assigned });
    const result = await fetchScheduleWithRetry(target, '2026-08-09');
    expect(result.date).toBe('2026-08-09');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('gives up after exactly one retry and reports the original date', async () => {
    // One bad route must never abort the run, and must never retry forever.
    const spy = vi
      .spyOn(client, 'fetchUpstream')
      .mockResolvedValue({ ok: true, status: 200, contentType: 'text/html', payload: unassigned });
    const result = await fetchScheduleWithRetry(target, '2026-08-09');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.date).toBe('2026-08-09');
    expect(result.error).toBeNull();
    expect(result.payload).toEqual(unassigned);
  });

  it('surfaces a transport failure as an error rather than an empty schedule', async () => {
    vi.spyOn(client, 'fetchUpstream').mockResolvedValue({
      ok: false,
      status: 0,
      contentType: 'unknown',
      payload: null,
      error: 'Upstream timed out after 45000ms',
    });
    const result = await fetchScheduleWithRetry(target, '2026-08-09');
    expect(result.error).toBe('Upstream timed out after 45000ms');
    expect(result.payload).toBeNull();
  });

  it('carries the probe’s provenance through to the harvester', async () => {
    vi.spyOn(client, 'fetchUpstream').mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'text/html',
      payload: assigned,
    });
    const result = await fetchScheduleWithRetry(target, '2026-08-09');
    expect(result).toMatchObject({
      registrationNumber: 'UP11AA1001',
      routeName: 'AAA_100_ORD_OUT',
    });
  });
});
