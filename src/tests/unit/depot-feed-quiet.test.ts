import { describe, expect, it } from 'vitest';
import { FEED_QUIET_AFTER_MIN, feedChip, feedLagMinutes } from '@/lib/depot/feedChip';
import { provenanceLine } from '@/lib/depot/provenanceLine';

// 14:02 on the feed's clock (Indian time behind a misleading Z) is 08:32 UTC.
const FEED_NOW = '2026-10-06T14:02:00Z';
const IN_STEP = '2026-10-06T08:32:05.000Z';
const THIRTEEN_MIN_LATER = '2026-10-06T08:45:05.000Z';
const live = (fetchedAt: string) => ({ source: 'live' as const, stale: false, feedNow: FEED_NOW, fetchedAt });
const chip = (data: ReturnType<typeof live>, extra: object = {}) =>
  feedChip({ data: { ...data, ...extra }, error: null, loading: false, nowMs: Date.parse(data.fetchedAt) });

describe('a feed whose newest report trails the fetch', () => {
  it('measures the lag on the Indian clock, never the browser zone', () => {
    expect(FEED_QUIET_AFTER_MIN).toBe(10);
    expect(feedLagMinutes(FEED_NOW, IN_STEP)).toBe(0);
    expect(feedLagMinutes(FEED_NOW, THIRTEEN_MIN_LATER)).toBe(13);
    expect(feedLagMinutes('not a time', IN_STEP)).toBeNull();
  });

  it('reads LIVE while in step and FEED QUIET in the stale tone past the limit', () => {
    expect(chip(live(IN_STEP))).toMatchObject({ text: 'LIVE · 14:02', tone: 'live' });
    const quiet = chip(live(THIRTEEN_MIN_LATER));
    expect(quiet).toMatchObject({ text: 'FEED QUIET · 14:02', tone: 'stale' });
    expect(quiet.title).toMatch(/^The newest report in the feed is 13 min older than the last fetch\./);
  });

  it('stays LIVE at exactly the limit', () => {
    expect(chip(live('2026-10-06T08:42:05.000Z')).text).toBe('LIVE · 14:02');
  });

  it('gives way to stale and sample, and comes before the clock check', () => {
    expect(chip(live(THIRTEEN_MIN_LATER), { stale: true }).text).toBe('STALE · 14:02');
    expect(chip(live(THIRTEEN_MIN_LATER), { source: 'fixture' }).text).toBe('FIXTURE · 14:02');
    const both = chip(live(THIRTEEN_MIN_LATER), { feedClockAheadRows: 500, recordCount: 1000 });
    expect(both.text).toBe('FEED QUIET · 14:02');
    expect(both.title).toContain('the feed clock may lag');
  });

  it('the provenance line agrees with the chip', () => {
    const feed = (fetchedAt: string) => ({ data: live(fetchedAt), error: null });
    expect(provenanceLine({ default: 'live' }, feed(THIRTEEN_MIN_LATER)).sentence).toBe(
      'From a quiet feed: its newest report is from 14:02.',
    );
    expect(provenanceLine({ default: 'live' }, feed(IN_STEP)).sentence).toBe('Live from the feed at 14:02.');
    expect(provenanceLine({ default: 'mixed', live: 'Bus states', derived: 'Counts' }, feed(THIRTEEN_MIN_LATER)).sentence).toBe(
      'Bus states are from a quiet feed, newest report 14:02; Counts are DERIVED from a quiet feed.',
    );
  });
});
