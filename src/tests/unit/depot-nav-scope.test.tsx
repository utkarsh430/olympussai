import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepotNav } from '@/components/depot/shell/DepotNav';

const route = vi.hoisted(() => ({ path: '/project/depots/d/49/yard' }));

vi.mock('next/navigation', () => ({ usePathname: (): string => route.path }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { depots: [{ id: '49', name: 'KAUSHAMBI', kind: 'depot', fleet: 200 }] },
    error: null,
    loading: false,
  }),
}));

afterEach(cleanup);

describe('the navigation strip below 1280px', () => {
  it('shows below the rail breakpoint only, and sticks under the bar from 640px', () => {
    route.path = '/project/depots/d/49/yard';
    render(<DepotNav />);
    const own = (screen.getByTestId('depot-nav-strip').getAttribute('class') ?? '').split(/\s+/);
    expect(own).toEqual(
      expect.arrayContaining(['xl:hidden', 'sm:sticky', 'sm:top-[var(--depot-bar-h)]']),
    );
    expect(own).toContain('h-[var(--depot-nav-h)]');
  });

  it('shows only the depot pages in depot scope: no Network control, its caps at the outer ends', () => {
    route.path = '/project/depots/d/49/yard';
    render(<DepotNav />);
    const nav = screen.getByTestId('depot-nav-strip');
    const strip = within(nav);
    expect(strip.getByRole('link', { name: 'Yard' }).getAttribute('aria-current')).toBe('page');
    expect(strip.queryByRole('link', { name: 'League table' })).toBeNull();
    expect(strip.queryByRole('button')).toBeNull();
    expect(nav.textContent).not.toMatch(/network/i);
    // The scrolling frame is the strip's only child, so its end caps sit at the strip's ends.
    expect(nav.children).toHaveLength(1);
    expect(nav.firstElementChild?.contains(screen.getByTestId('depot-scroll-strip'))).toBe(true);
  });

  it('shows the network links and no disclosure in network scope', () => {
    route.path = '/project/depots/league';
    render(<DepotNav />);
    const strip = within(screen.getByTestId('depot-nav-strip'));
    expect(strip.queryByRole('button', { name: 'Network' })).toBeNull();
    expect(strip.getByRole('link', { name: 'League table' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});

describe('the rail from 1280px', () => {
  it('leads with the depot name and its pages, then the network groups', () => {
    route.path = '/project/depots/d/49';
    render(<DepotNav />);
    const rail = screen.getByTestId('depot-nav');
    const group = within(screen.getByTestId('depot-nav-depot-group'));
    expect(group.getByText('KAUSHAMBI')).toBeTruthy();
    expect(group.getByRole('link', { name: 'Cockpit' }).getAttribute('aria-current')).toBe('page');
    expect(within(rail).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
  });

  it('draws every group heading as a category tab and lights the one that holds the current page', () => {
    route.path = '/project/depots/d/49/yard';
    render(<DepotNav />);
    const tabs = within(screen.getByTestId('depot-nav')).getAllByTestId('depot-nav-category');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['KAUSHAMBI', 'Network', 'Intelligence', 'System']);
    for (const tab of tabs) expect(tab.className.split(/\s+/)).toContain('depot-nav-category');
    const lit = tabs.filter((tab) => tab.className.split(/\s+/).includes('depot-nav-category-current'));
    expect(lit.map((tab) => tab.textContent)).toEqual(['KAUSHAMBI']);
    expect(lit[0]?.getAttribute('data-current')).toBe('true');
  });

  it('lights the network category on a network page, and never two at once', () => {
    route.path = '/project/depots/league';
    render(<DepotNav />);
    const tabs = within(screen.getByTestId('depot-nav')).getAllByTestId('depot-nav-category');
    const lit = tabs.filter((tab) => tab.getAttribute('data-current') === 'true');
    expect(lit).toHaveLength(1);
    const group = lit[0]?.parentElement;
    expect(group && within(group).getByRole('link', { name: 'League table' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('keeps a long depot name on one line inside its tab', () => {
    route.path = '/project/depots/d/49';
    render(<DepotNav />);
    const tab = within(screen.getByTestId('depot-nav-depot-group')).getByTestId('depot-nav-category');
    expect(tab.className.split(/\s+/)).toEqual(expect.arrayContaining(['truncate', 'block']));
    expect(tab.getAttribute('title')).toBe('KAUSHAMBI');
  });

  it('shows no depot group for a depot the feed does not know', () => {
    route.path = '/project/depots/d/999999/yard';
    render(<DepotNav />);
    expect(screen.queryByTestId('depot-nav-depot-group')).toBeNull();
    expect(within(screen.getByTestId('depot-nav')).queryByRole('link', { name: 'Yard' })).toBeNull();
    expect(within(screen.getByTestId('depot-nav-strip')).queryByRole('button')).toBeNull();
  });
});
