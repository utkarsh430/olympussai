import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepotBarMenu } from '@/components/depot/shell/DepotBarMenu';
import { NETWORK_NAV } from '@/lib/depot/nav';

const route = vi.hoisted(() => ({ path: '/project/depots/d/49/yard' }));

vi.mock('next/navigation', () => ({ usePathname: (): string => route.path }));
vi.mock('@/hooks/useProjectSignOut', () => ({
  useProjectSignOut: (): unknown => ({ signOut: () => {}, pending: false }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { depots: [{ id: '49', name: 'KAUSHAMBI', kind: 'depot', fleet: 200 }] },
    error: null,
    loading: false,
  }),
}));

afterEach(cleanup);

const NETWORK_LABELS = NETWORK_NAV.flatMap((group) => group.items.map((item) => item.label));

describe('the bar menu below 1280px', () => {
  it('lists every network page in depot scope, so the network is two keys away from a depot page', () => {
    route.path = '/project/depots/d/49/yard';
    render(<DepotBarMenu />);
    const toggle = screen.getByRole('button', { name: /Menu/ });
    fireEvent.click(toggle);
    const panel = within(screen.getByTestId('depot-bar-menu-panel'));
    for (const label of NETWORK_LABELS) {
      expect(panel.getByRole('link', { name: label })).toBeTruthy();
    }
    expect(panel.getByRole('link', { name: /Operations/ })).toBeTruthy();
    expect(panel.getByTestId('depot-sign-out')).toBeTruthy();

    fireEvent.keyDown(screen.getByTestId('depot-bar-menu-panel'), { key: 'Escape' });
    expect(screen.queryByTestId('depot-bar-menu-panel')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('leaves the network links to the strip in network scope', () => {
    route.path = '/project/depots/league';
    render(<DepotBarMenu />);
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    const panel = within(screen.getByTestId('depot-bar-menu-panel'));
    expect(panel.queryByRole('link', { name: 'League table' })).toBeNull();
    expect(panel.getByRole('link', { name: /Operations/ })).toBeTruthy();
  });
});
