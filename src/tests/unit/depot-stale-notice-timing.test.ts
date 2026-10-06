import { describe, expect, it } from 'vitest';
import { STALE_NOTICE_AFTER_MS, staleNoticeTiming } from '@/lib/depot/feedChip';

const FETCHED_AT = '2026-10-06T10:00:00.000Z';
const FETCHED_MS = Date.parse(FETCHED_AT);
const MINUTE_MS = 60_000;

describe('staleNoticeTiming', () => {
  it('names a five-minute limit', () => {
    expect(STALE_NOTICE_AFTER_MS).toBe(5 * MINUTE_MS);
  });

  it('holds the notice back while the data is younger than the limit, saying when it is due', () => {
    expect(staleNoticeTiming(FETCHED_AT, FETCHED_MS + 2 * MINUTE_MS)).toEqual({
      show: false,
      showInMs: 3 * MINUTE_MS,
    });
    expect(staleNoticeTiming(FETCHED_AT, FETCHED_MS + STALE_NOTICE_AFTER_MS - 1)).toEqual({
      show: false,
      showInMs: 1,
    });
  });

  it('shows the notice from the limit on', () => {
    const shown = { show: true, showInMs: null };
    expect(staleNoticeTiming(FETCHED_AT, FETCHED_MS + STALE_NOTICE_AFTER_MS)).toEqual(shown);
    expect(staleNoticeTiming(FETCHED_AT, FETCHED_MS + 3 * 60 * MINUTE_MS)).toEqual(shown);
  });

  it('shows the notice when the age cannot be known', () => {
    const shown = { show: true, showInMs: null };
    expect(staleNoticeTiming(null, FETCHED_MS)).toEqual(shown);
    expect(staleNoticeTiming('not a time', FETCHED_MS)).toEqual(shown);
    expect(staleNoticeTiming(FETCHED_AT, Number.NaN)).toEqual(shown);
  });

  it('treats a fetch time slightly ahead of the browser clock as new data', () => {
    expect(staleNoticeTiming(FETCHED_AT, FETCHED_MS - 2_000)).toEqual({
      show: false,
      showInMs: STALE_NOTICE_AFTER_MS,
    });
  });

  it('treats a fetch time far ahead of the browser clock as unknown, so the notice shows', () => {
    expect(staleNoticeTiming(FETCHED_AT, FETCHED_MS - STALE_NOTICE_AFTER_MS - 1)).toEqual({
      show: true,
      showInMs: null,
    });
  });
});
