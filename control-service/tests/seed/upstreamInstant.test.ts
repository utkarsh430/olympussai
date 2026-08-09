// Regression suite for the live feed's timezone defect.
//
// Found by running the poller against production, not by any unit test: the
// feed stamps IST wall-clock time and labels it `Z`. Measured 2026-08-09 at
// 06:47 UTC / 12:17 IST - the feed reported 12:16:37Z, the median record sat
// +5.44h ahead of real UTC, and 2982 of 9260 records landed within 60s of
// exactly +5h30m.
//
// These tests exist because taking `Z` at face value disables three guards at
// once, all of which compare observed_at to now(): the MPC hard staleness
// filter, GPS_MAX_AGE_SECONDS, and the vehicle_states out-of-order guard. Each
// failure is silent - the system keeps running and quietly stops protecting
// anything - so the behaviour is pinned here rather than left to inspection.

import { describe, expect, it } from 'vitest';
import { parseUpstreamInstant } from '../../src/ingestion/upsrtc/normalize.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** 2026-08-09T06:47:44Z, the moment the defect was measured against production. */
const NOW_MS = Date.parse('2026-08-09T06:47:44.000Z');

describe('parseUpstreamInstant', () => {
  it('corrects an IST wall-clock time mislabelled as Z back to real UTC', () => {
    // Exactly what the production feed returned while UTC was 06:47:44.
    const parsed = parseUpstreamInstant('2026-08-09T12:16:37Z', NOW_MS);
    expect(parsed).not.toBeNull();
    expect(new Date(parsed as number).toISOString()).toBe('2026-08-09T06:46:37.000Z');
    // 67s old at the time of measurement - a plausible fix age, which is the
    // whole point: read literally it was 5.5 hours in the FUTURE.
    expect(NOW_MS - (parsed as number)).toBeCloseTo(67_000, -3);
  });

  it('leaves a genuinely-UTC recent timestamp untouched', () => {
    const raw = '2026-08-09T06:47:00.000Z';
    expect(parseUpstreamInstant(raw, NOW_MS)).toBe(Date.parse(raw));
  });

  it('leaves a genuinely-UTC past timestamp untouched', () => {
    // Never shift a value that is already in the past: it is not ambiguous,
    // and shifting would make a merely-stale fix look 5.5h staler than it is.
    const raw = '2026-08-09T04:00:00.000Z';
    expect(parseUpstreamInstant(raw, NOW_MS)).toBe(Date.parse(raw));
  });

  it('accepts small forward skew without shifting a whole IST offset', () => {
    // Unit clock drift of a few seconds must not be mistaken for a timezone
    // error; correcting it would rewrite a fresh fix into a 5.5h-old one.
    const raw = new Date(NOW_MS + 30_000).toISOString();
    expect(parseUpstreamInstant(raw, NOW_MS)).toBe(Date.parse(raw));
  });

  it('rejects a fix still in the future after correction (broken unit clock)', () => {
    // Observed in production: one unit reporting ~39 years ahead. Left
    // uncorrected this permanently locks that vehicle's row, because
    // `on conflict ... where observed_at <= excluded.observed_at` can then
    // never be satisfied by a real fix again.
    expect(parseUpstreamInstant('2065-01-01T00:00:00Z', NOW_MS)).toBeNull();
  });

  it('rejects an unparseable, empty, or absent value rather than defaulting to now', () => {
    // Dropping beats inventing: a fabricated observed_at would let an
    // arbitrarily old fix win the out-of-order guard against a current one.
    expect(parseUpstreamInstant('Bus Not Assigned', NOW_MS)).toBeNull();
    expect(parseUpstreamInstant('', NOW_MS)).toBeNull();
    expect(parseUpstreamInstant('   ', NOW_MS)).toBeNull();
    expect(parseUpstreamInstant(null, NOW_MS)).toBeNull();
    expect(parseUpstreamInstant(undefined, NOW_MS)).toBeNull();
  });

  it('keeps corrected fixes inside the max-age window the poller enforces', () => {
    // The end-to-end property that matters: an IST-stamped fix from 2 minutes
    // ago must survive a 300s max-age test, and one from 10 minutes ago must
    // not. Before the correction every fix passed, whatever its true age.
    const maxAgeMs = 300_000;
    const istStamp = (agoMs: number) => new Date(NOW_MS - agoMs + IST_OFFSET_MS).toISOString();

    const fresh = parseUpstreamInstant(istStamp(120_000), NOW_MS);
    expect(fresh).not.toBeNull();
    expect(NOW_MS - (fresh as number)).toBeLessThan(maxAgeMs);

    const old = parseUpstreamInstant(istStamp(600_000), NOW_MS);
    expect(old).not.toBeNull();
    expect(NOW_MS - (old as number)).toBeGreaterThan(maxAgeMs);
  });

  it('yields a positive age so the MPC staleness filter can actually fire', () => {
    // mpc/safety.ts computes ageSeconds(observedAt, now) and rejects a
    // candidate when it exceeds staleAfterSeconds. A future-dated fix makes
    // that age negative, so the comparison is never true and the guardrail
    // silently passes everything.
    const parsed = parseUpstreamInstant('2026-08-09T12:16:37Z', NOW_MS);
    expect((NOW_MS - (parsed as number)) / 1000).toBeGreaterThan(0);
  });
});
