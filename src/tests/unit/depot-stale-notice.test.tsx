import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleNotice } from '@/components/depot/shell/DataStates';
import { STALE_NOTICE_AFTER_MS } from '@/lib/depot/feedChip';

const network = vi.hoisted(() => ({ fetchedAt: null as string | null, mounted: true }));

vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => {
    if (!network.mounted) throw new Error('useDepotNetworkContext must be used inside');
    return {
      data: network.fetchedAt === null ? null : { fetchedAt: network.fetchedAt, stale: true },
      error: null,
      loading: false,
    };
  },
}));

const FETCHED_AT = '2026-10-06T10:00:00.000Z';
const FETCHED_MS = Date.parse(FETCHED_AT);
const MINUTE_MS = 60_000;
const SINCE = '2026-10-06T15:21:00Z';

beforeEach(() => {
  vi.useFakeTimers();
  network.fetchedAt = FETCHED_AT;
  network.mounted = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('StaleNotice, the stale feed said once', () => {
  it('shows nothing and takes no room for young data', () => {
    // An empty gap held open while the notice waits would itself move the page each time
    // a response turns stale and fresh again. The notice costs one move, when it appears.
    vi.setSystemTime(FETCHED_MS + 2 * MINUTE_MS);
    render(<StaleNotice since={SINCE} />);
    const slot = screen.getByTestId('depot-stale');
    expect(slot.textContent).toBe('');
    expect(slot.getAttribute('data-state')).toBe('waiting');
    expect(screen.queryByTestId('depot-notice')).toBeNull();
    expect(slot.className).not.toContain('min-h-');
  });

  it('brings in the one shared notice, in the same slot, once the data passes the limit', () => {
    vi.setSystemTime(FETCHED_MS + 2 * MINUTE_MS);
    render(<StaleNotice since={SINCE} />);
    act(() => {
      vi.advanceTimersByTime(STALE_NOTICE_AFTER_MS - 2 * MINUTE_MS);
    });
    const slot = screen.getByTestId('depot-stale');
    expect(slot.getAttribute('data-state')).toBe('shown');
    const notice = screen.getByTestId('depot-notice');
    expect(slot.contains(notice)).toBe(true);
    expect(notice.getAttribute('data-status')).toBe('warning');
    expect(notice.textContent).toBe('StaleShowing last good data from 15:21');
    expect(slot.getAttribute('role')).toBe('status');
  });

  it('shows the notice at once for data already older than the limit', () => {
    vi.setSystemTime(FETCHED_MS + STALE_NOTICE_AFTER_MS + MINUTE_MS);
    render(<StaleNotice since={null} />);
    expect(screen.getByTestId('depot-notice').textContent).toBe('StaleShowing last good data');
  });

  it('prefers a fetch time the page passes over the shell feed', () => {
    vi.setSystemTime(FETCHED_MS + STALE_NOTICE_AFTER_MS + MINUTE_MS);
    const fresh = new Date(FETCHED_MS + STALE_NOTICE_AFTER_MS).toISOString();
    render(<StaleNotice since={SINCE} fetchedAt={fresh} />);
    expect(screen.queryByTestId('depot-notice')).toBeNull();
  });

  it('shows the notice when the age cannot be known', () => {
    vi.setSystemTime(FETCHED_MS);
    network.fetchedAt = null;
    render(<StaleNotice since={SINCE} />);
    expect(screen.getByTestId('depot-notice')).toBeTruthy();
  });

  it('shows the notice outside the shell, where no feed clock is available', () => {
    vi.setSystemTime(FETCHED_MS);
    network.mounted = false;
    render(<StaleNotice since={SINCE} />);
    expect(screen.getByTestId('depot-notice').textContent).toContain('15:21');
  });
});
