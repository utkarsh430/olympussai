import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageRefreshNotice, pageRefreshSentence } from '@/components/depot/shell/PageRefreshNotice';
import { StaleNotice } from '@/components/depot/shell/StaleNotice';
import { feedChip } from '@/lib/depot/feedChip';
import {
  PAGE_REFRESH_OK,
  feedTimeOf,
  pageRefreshState,
  refreshFailuresSnapshot,
  reportRefreshFailure,
} from '@/lib/depot/pageRefresh';
import { provenanceLine } from '@/lib/depot/provenanceLine';

const FEED = {
  source: 'live' as const,
  stale: false,
  feedNow: '2026-10-06T14:02:00Z',
  fetchedAt: '2026-10-06T08:32:05.000Z',
};
const NOW_MS = Date.parse('2026-10-06T08:32:10.000Z');

afterEach(() => {
  act(() => {
    [...refreshFailuresSnapshot().keys()].forEach((key) => reportRefreshFailure(key, null));
  });
});

describe('the page-refresh store', () => {
  it('names the oldest known feed time and clears to nothing', () => {
    reportRefreshFailure('a', { since: '2026-10-06T13:50:00Z' });
    reportRefreshFailure('b', { since: '2026-10-06T13:40:00Z' });
    reportRefreshFailure('c', { since: null });
    expect(pageRefreshState(refreshFailuresSnapshot())).toEqual({
      failed: true,
      since: '2026-10-06T13:40:00Z',
    });
    ['a', 'b', 'c'].forEach((key) => reportRefreshFailure(key, null));
    expect(pageRefreshState(refreshFailuresSnapshot())).toBe(PAGE_REFRESH_OK);
  });

  it('keeps one snapshot while nothing changes', () => {
    reportRefreshFailure('a', { since: null });
    const first = refreshFailuresSnapshot();
    reportRefreshFailure('a', { since: null });
    expect(refreshFailuresSnapshot()).toBe(first);
  });

  it('reads a feed time only from a response that carries one', () => {
    expect(feedTimeOf({ feedNow: '2026-10-06T14:02:00Z' })).toBe('2026-10-06T14:02:00Z');
    expect(feedTimeOf({ feedNow: 7 })).toBeNull();
    expect(feedTimeOf(null)).toBeNull();
  });
});

describe('the shell notice for a page whose own request fails', () => {
  it('shows at once, in fixed words with the figures time, and clears on success', () => {
    render(<PageRefreshNotice />);
    expect(screen.queryByTestId('depot-notice')).toBeNull();
    act(() => reportRefreshFailure('page', { since: '2026-10-06T13:40:00Z' }));
    expect(screen.getByTestId('depot-notice').textContent).toBe(
      "Not refreshedThis page's figures could not be refreshed. The figures on screen are the " +
        'last ones received, feed time 13:40.',
    );
    act(() => reportRefreshFailure('page', null));
    expect(screen.queryByTestId('depot-notice')).toBeNull();
  });

  it('says no time when the response carried none', () => {
    expect(pageRefreshSentence(null)).toBe(
      "This page's figures could not be refreshed. The figures on screen are the last ones received.",
    );
  });

  it('stands the page stale strip down, so the page keeps one notice', () => {
    act(() => reportRefreshFailure('page', { since: null }));
    render(<StaleNotice since={null} fetchedAt={null} />);
    expect(screen.getByTestId('depot-stale').getAttribute('data-state')).toBe('covered');
    expect(screen.queryByTestId('depot-notice')).toBeNull();
  });
});

describe('the chip and the provenance line while a page request fails', () => {
  const page = { failed: true, since: '2026-10-06T13:40:00Z' };

  it('the chip reads STALE at the page figures time, never LIVE at the feed time', () => {
    const chip = feedChip({ data: FEED, error: null, loading: false, nowMs: NOW_MS, page });
    expect(chip).toMatchObject({ text: 'STALE · 13:40', tone: 'stale' });
    expect(chip.title).toContain("This page's figures could not be refreshed");
    expect(feedChip({ data: FEED, error: null, loading: false, nowMs: NOW_MS }).text).toBe('LIVE · 14:02');
  });

  it('the provenance line says last good data at the page figures time', () => {
    const line = provenanceLine({ default: 'live' }, { data: FEED, error: null, page });
    expect(line.sentence).toBe('From the last good data, feed time 13:40.');
    expect(line.staleWords).toBe('last good data');
  });
});
