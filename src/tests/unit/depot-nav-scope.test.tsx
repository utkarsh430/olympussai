import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('shows the depot pages with a Network disclosure in depot scope', () => {
    route.path = '/project/depots/d/49/yard';
    render(<DepotNav />);
    const strip = within(screen.getByTestId('depot-nav-strip'));
    expect(strip.getByRole('link', { name: 'Yard' }).getAttribute('aria-current')).toBe('page');
    expect(strip.queryByRole('link', { name: 'League table' })).toBeNull();

    const toggle = strip.getByRole('button', { name: 'Network' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByTestId('depot-nav-network-panel');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(within(panel).getByRole('link', { name: 'League table' })).toBeTruthy();

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByTestId('depot-nav-network-panel')).toBeNull();
    expect(document.activeElement).toBe(toggle);
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

  it('shows no depot group for a depot the feed does not know', () => {
    route.path = '/project/depots/d/999999/yard';
    render(<DepotNav />);
    expect(screen.queryByTestId('depot-nav-depot-group')).toBeNull();
    expect(within(screen.getByTestId('depot-nav')).queryByRole('link', { name: 'Yard' })).toBeNull();
    expect(within(screen.getByTestId('depot-nav-strip')).queryByRole('button')).toBeNull();
  });
});
