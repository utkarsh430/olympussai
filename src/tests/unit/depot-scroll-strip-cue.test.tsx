import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepotNav } from '@/components/depot/shell/DepotNav';
import { NETWORK_NAV } from '@/lib/depot/nav';
import { depotNav as depotNavForCount } from '@/lib/depot/depotNav';

// The number of depot pages comes from the navigation model, not a literal.
const DEPOT_PAGE_COUNT = depotNavForCount('49').length;

vi.mock('next/navigation', () => ({
  usePathname: (): string => '/project/depots/sources',
}));

const widths = { client: 400, scroll: 900 };

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => widths.client);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => widths.scroll);
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(() => 700);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => 100);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('navigation strip scroll cue', () => {
  it('scrolls the active link into view on load and shows a cue only where links are hidden', () => {
    render(<DepotNav groups={NETWORK_NAV} />);
    const strip = screen.getByTestId('depot-scroll-strip');
    // centred: 700 + 50 - 200 = 550, clamped to the 500 maximum, so the end is reached
    expect(strip.scrollLeft).toBe(500);
    expect(screen.queryByTestId('depot-strip-cue-after')).toBeNull();
    expect(screen.getByTestId('depot-strip-cue-before')).toBeTruthy();
  });

  it('shows the trailing cue when the strip is scrolled back to the start', () => {
    render(<DepotNav groups={NETWORK_NAV} />);
    const strip = screen.getByTestId('depot-scroll-strip');
    act(() => {
      strip.scrollLeft = 0;
      fireEvent.scroll(strip);
    });
    expect(screen.getByTestId('depot-strip-cue-after')).toBeTruthy();
    expect(screen.queryByTestId('depot-strip-cue-before')).toBeNull();
  });

  it('marks the current link with aria-current and keeps every link a real link', () => {
    render(<DepotNav groups={NETWORK_NAV} />);
    expect(screen.getByRole('link', { name: 'Data sources' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getAllByRole('link')).toHaveLength(DEPOT_PAGE_COUNT);
  });
});
