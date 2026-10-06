import { describe, expect, it } from 'vitest';
import { ageWords, feedChip, headerProvenanceNote, type FeedChipData } from '@/lib/depot/feedChip';

const FETCHED = '2026-10-06T07:06:00.000Z';
const FETCHED_MS = Date.parse(FETCHED);

function data(overrides: Partial<FeedChipData> = {}): FeedChipData {
  return {
    source: 'live',
    stale: false,
    feedNow: '2026-10-06T12:36:10Z',
    fetchedAt: FETCHED,
    ...overrides,
  };
}

describe('ageWords', () => {
  it('says seconds under a minute, minutes under an hour, then hours and minutes', () => {
    expect(ageWords(38_000)).toBe('38 s');
    expect(ageWords(4 * 60_000 + 10_000)).toBe('4 min');
    expect(ageWords(2 * 3_600_000 + 5 * 60_000)).toBe('2 h 5 min');
    expect(ageWords(3_600_000)).toBe('1 h');
  });

  it('treats a clock slightly ahead of the browser as no age at all', () => {
    expect(ageWords(-2_000)).toBe('0 s');
  });

  it('returns null when the age cannot be known', () => {
    expect(ageWords(Number.NaN)).toBeNull();
  });
});

describe('feedChip', () => {
  it('says LIVE with the feed clock when the server answered from the feed', () => {
    const chip = feedChip({
      data: data(),
      error: null,
      loading: false,
      nowMs: FETCHED_MS + 38_000,
    });
    expect(chip.text).toBe('LIVE · 12:36');
    expect(chip.tone).toBe('live');
    expect(chip.title).toBe('Live feed, data received 38 s ago (feed time 12:36)');
    expect(chip.srText).toBe('Feed status: live feed, data received 38 s ago (feed time 12:36)');
  });

  it('says LIVE, never CACHE, when the server answered from its own cache', () => {
    const chip = feedChip({
      data: data({ source: 'cache' }),
      error: null,
      loading: false,
      nowMs: FETCHED_MS + 38_000,
    });
    expect(chip.text).toBe('LIVE · 12:36');
    expect(chip.tone).toBe('live');
    expect(`${chip.text} ${chip.title} ${chip.srText}`).not.toMatch(/cache/i);
  });

  it('says STALE with the age when the server marks the data stale', () => {
    const chip = feedChip({
      data: data({ source: 'cache', stale: true }),
      error: null,
      loading: false,
      nowMs: FETCHED_MS + 4 * 60_000,
    });
    expect(chip.text).toBe('STALE · 12:36');
    expect(chip.tone).toBe('stale');
    expect(chip.title).toBe('Showing the last good data, received 4 min ago (feed time 12:36)');
    expect(chip.srText).toBe(
      'Feed status: stale. Showing the last good data, received 4 min ago (feed time 12:36)',
    );
  });

  it('says STALE when the latest poll failed but earlier data is still shown', () => {
    const chip = feedChip({
      data: data(),
      error: 'Depot data unavailable',
      loading: false,
      nowMs: FETCHED_MS + 90_000,
    });
    expect(chip.text).toBe('STALE · 12:36');
    expect(chip.tone).toBe('stale');
  });

  it('keeps the sample-data wording for the fixture', () => {
    const fresh = feedChip({
      data: data({ source: 'fixture' }),
      error: null,
      loading: false,
      nowMs: FETCHED_MS,
    });
    expect(fresh.text).toBe('FIXTURE · 12:36');
    expect(fresh.tone).toBe('fixture');
    expect(fresh.title).toBe('Sample data, not the live feed');
    const stale = feedChip({
      data: data({ source: 'fixture', stale: true }),
      error: null,
      loading: false,
      nowMs: FETCHED_MS,
    });
    expect(stale.text).toBe('FIXTURE · stale · 12:36');
  });

  it('says an unknown age in words when the server time cannot be read', () => {
    const chip = feedChip({
      data: data({ fetchedAt: 'not a time' }),
      error: null,
      loading: false,
      nowMs: FETCHED_MS,
    });
    expect(chip.title).toBe('Live feed, data received at an unknown time (feed time 12:36)');
  });

  it('says connecting before the first answer and unavailable after a failed first poll', () => {
    const connecting = feedChip({ data: null, error: null, loading: true, nowMs: 0 });
    expect(connecting.text).toBe('Feed connecting');
    expect(connecting.tone).toBe('neutral');
    const failed = feedChip({
      data: null,
      error: 'Depot data unavailable',
      loading: false,
      nowMs: 0,
    });
    expect(failed.text).toBe('Feed unavailable');
    expect(failed.title).toBe('The depot feed has not answered yet');
  });
});

describe('headerProvenanceNote', () => {
  it('says live, derived and modelled figures apart, with the feed time', () => {
    expect(headerProvenanceNote(data(), null, 'live')).toBe('Live from the feed at 12:36');
    expect(headerProvenanceNote(data(), null, 'derived')).toBe(
      'Derived from the live feed at 12:36',
    );
    expect(headerProvenanceNote(data(), null, 'modelled')).toBe(
      'Modelled: generated figures, anchored on the live feed at 12:36',
    );
  });

  it('never calls a modelled page live', () => {
    for (const d of [data(), data({ source: 'cache' })]) {
      expect(headerProvenanceNote(d, null, 'modelled')).not.toMatch(/^live|from the live feed at/i);
    }
  });

  it('calls reference data curated, whatever the feed is doing', () => {
    expect(headerProvenanceNote(data(), null, 'reference')).toBe('Reference data, curated');
    expect(headerProvenanceNote(null, null, 'reference')).toBe('Reference data, curated');
    expect(headerProvenanceNote(data({ stale: true }), 'x', 'reference')).toBe(
      'Reference data, curated',
    );
  });

  it('treats a cached answer as the live feed', () => {
    expect(headerProvenanceNote(data({ source: 'cache' }), null, 'live')).toBe(
      'Live from the feed at 12:36',
    );
  });

  it('says stale, sample and waiting states for each tag', () => {
    expect(headerProvenanceNote(data({ stale: true }), null, 'derived')).toBe(
      'Derived from the last good data, feed time 12:36',
    );
    expect(headerProvenanceNote(data(), 'Depot data unavailable', 'modelled')).toBe(
      'Modelled: generated figures, anchored on the last good data, feed time 12:36',
    );
    expect(headerProvenanceNote(data({ stale: true }), null, 'live')).toBe(
      'From the last good data, feed time 12:36',
    );
    expect(headerProvenanceNote(data({ source: 'fixture' }), null, 'derived')).toBe(
      'Derived from sample data, feed time 12:36',
    );
    expect(headerProvenanceNote(data({ source: 'fixture' }), null, 'modelled')).toBe(
      'Modelled: generated figures, anchored on sample data, feed time 12:36',
    );
    expect(headerProvenanceNote(null, null, 'derived')).toBe('Waiting for the feed');
    // The network poll failed, so there is nothing to wait for.
    expect(headerProvenanceNote(null, 'Depot data unavailable', 'derived')).toBe(
      'The feed is unavailable',
    );
    expect(headerProvenanceNote(null, 'Session expired', 'modelled')).toBe('The feed is unavailable');
  });

  it('keeps an omitted tag working as the derived wording', () => {
    expect(headerProvenanceNote(data(), null)).toBe('Derived from the live feed at 12:36');
  });
});
