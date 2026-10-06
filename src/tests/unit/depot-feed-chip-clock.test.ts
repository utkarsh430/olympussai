import { describe, expect, it } from 'vitest';
import {
  FEED_CLOCK_AHEAD_WARN_MIN_ROWS,
  FEED_CLOCK_AHEAD_WARN_SHARE,
  feedChip,
  type FeedChipData,
} from '@/lib/depot/feedChip';

/*
 * P4: a lagging feed clock must be noticeable. When at least
 * FEED_CLOCK_AHEAD_WARN_SHARE of a response's rows (and never fewer than
 * FEED_CLOCK_AHEAD_WARN_MIN_ROWS) carry a time later than the server's own
 * clock allows, the feed clock may lag: the chip says CHECK CLOCK in words, not
 * by colour alone. Below that it is unchanged; the saved sample never warns.
 */

const FETCHED = '2026-10-06T07:06:00.000Z';
const NOW_MS = Date.parse(FETCHED) + 38_000;

function chipOf(overrides: Partial<FeedChipData>, error: string | null = null) {
  const data: FeedChipData = {
    source: 'live',
    stale: false,
    feedNow: '2026-10-06T12:36:10Z',
    fetchedAt: FETCHED,
    recordCount: 10_000,
    ...overrides,
  };
  return feedChip({ data, error, loading: false, nowMs: NOW_MS });
}

const CLOCK = (n: number): string =>
  `${n} reports carry a time later than the server's own clock allows, so the feed clock ` +
  "may lag and the server's clock should be checked";

describe('feed chip: a lagging clock (P4)', () => {
  it('names the share and its floor', () => {
    expect(FEED_CLOCK_AHEAD_WARN_SHARE).toBe(0.01);
    expect(FEED_CLOCK_AHEAD_WARN_MIN_ROWS).toBe(20);
  });

  it('is unchanged below one percent of the rows', () => {
    const chip = chipOf({ feedClockAheadRows: 99 });
    expect(chip.text).toBe('LIVE · 12:36');
    expect(chip.tone).toBe('live');
    expect(chip.title).toBe('Live feed, data received 38 s ago (feed time 12:36)');
  });

  it('says CHECK CLOCK, in words and as stale, from one percent of the rows', () => {
    const chip = chipOf({ feedClockAheadRows: 100 });
    expect(chip.text).toBe('CHECK CLOCK · 12:36');
    expect(chip.tone).toBe('stale');
    expect(chip.title).toBe(`${CLOCK(100)}. Data received 38 s ago (feed time 12:36)`);
    expect(chip.srText).toBe(`Feed status: check clock. ${chip.title}`);
  });

  it('never warns below the floor of twenty rows, however small the response', () => {
    expect(chipOf({ recordCount: 500, feedClockAheadRows: 19 }).text).toBe('LIVE · 12:36');
    expect(chipOf({ recordCount: 500, feedClockAheadRows: 20 }).text).toBe('CHECK CLOCK · 12:36');
    expect(chipOf({ recordCount: undefined, feedClockAheadRows: 19 }).tone).toBe('live');
    expect(chipOf({ recordCount: undefined, feedClockAheadRows: 20 }).tone).toBe('stale');
  });

  it('is unchanged when the count is absent or zero', () => {
    expect(chipOf({}).text).toBe('LIVE · 12:36');
    expect(chipOf({ feedClockAheadRows: 0 }).text).toBe('LIVE · 12:36');
  });

  it('never warns for the saved sample', () => {
    const chip = chipOf({ source: 'fixture', stale: true, feedClockAheadRows: 5_000 });
    expect(chip.text).toBe('FIXTURE · stale · 12:36');
    expect(`${chip.title} ${chip.srText}`).not.toMatch(/clock/);
  });

  it('keeps STALE for an outage and adds the clock sentence to its title', () => {
    const chip = chipOf({ stale: true, feedClockAheadRows: 100 });
    expect(chip.text).toBe('STALE · 12:36');
    expect(chip.title).toBe(
      `Showing the last good data, received 38 s ago (feed time 12:36). ${CLOCK(100)}.`,
    );
    expect(chip.srText).toBe(`Feed status: stale. ${chip.title}`);
  });
});
