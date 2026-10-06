import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProvenanceLine } from '@/components/depot/shell/ProvenanceLine';

const feed = vi.hoisted(() => ({ stale: false }));

// Only the feed state is read; the real provider would start a poll.
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: () => ({
    data: { source: 'live', stale: feed.stale, feedNow: '2026-10-06T12:36:10Z' },
    error: null,
    loading: false,
    refresh: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  feed.stale = false;
});

/** The provenance line as drawn (critique round 4, B). */
describe('ProvenanceLine view', () => {
  it('is 12/20 in the sans face with the tag as a pill', () => {
    render(<ProvenanceLine description={{ default: 'derived' }} />);
    const line = screen.getByTestId('depot-provenance-line');
    expect(line.className).toContain('font-sans');
    expect(line.className).toContain('text-xs');
    expect(line.className).toContain('leading-5');
    expect(screen.getByText('DERIVED').className).toContain('depot-tag-pill');
  });

  it('draws the stale words in the stale tone, as words', () => {
    feed.stale = true;
    render(<ProvenanceLine description={{ default: 'derived' }} />);
    const words = screen.getByTestId('depot-provenance-stale');
    expect(words.textContent).toBe('last good data');
    expect(words.className).toContain('text-alert-amber');
  });

  it('has no stale mark on fresh data', () => {
    render(<ProvenanceLine description={{ default: 'derived' }} />);
    expect(screen.queryByTestId('depot-provenance-stale')).toBeNull();
  });

  it('places the modelled-day sentence after the formula and before the link', () => {
    render(
      <ProvenanceLine
        description={{
          default: 'modelled',
          modelledDay: 'Built on the modelled day for Mon 05 Oct: 3 duties on 1 route.',
        }}
      />,
    );
    const line = screen.getByTestId('depot-provenance-line');
    const context = screen.getByTestId('depot-provenance-context');
    expect(context.textContent).toBe('Built on the modelled day for Mon 05 Oct: 3 duties on 1 route.');
    expect(line.lastElementChild?.textContent).toBe('Data sources');
  });
});
