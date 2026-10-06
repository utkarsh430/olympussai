import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepotSubNav } from '@/components/depot/shell/DepotSubNav';
import { ScopeSwitcher } from '@/components/depot/shell/ScopeSwitcher';
import { depotNav as depotNavForCount } from '@/lib/depot/depotNav';

// The number of depot pages comes from the navigation model, not a literal.
const DEPOT_PAGE_COUNT = depotNavForCount('49').length;

const DEPOTS = [{ id: '49', name: 'KAUSHAMBI', kind: 'depot', fleet: 200 }];
let pathname = '/project/depots/d/49';
let networkDepots: typeof DEPOTS | null = DEPOTS;
let detailError: string | null = null;

vi.mock('next/navigation', () => ({
  usePathname: (): string => pathname,
  useRouter: (): { push: () => void } => ({ push: () => {} }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: networkDepots ? { depots: networkDepots } : null,
    error: networkDepots ? null : 'HTTP 503',
    loading: false,
    refresh: () => {},
  }),
}));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => ({
    data: null,
    error: detailError,
    loading: detailError === null,
    refresh: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  pathname = '/project/depots/d/49';
  networkDepots = DEPOTS;
  detailError = null;
});

describe('depot tabs and top-bar crumb for an unknown depot', () => {
  it('shows the tabs and the depot name for a depot the feed lists', () => {
    render(<DepotSubNav depotId="49" />);
    expect(screen.getByRole('navigation', { name: 'Depot pages' })).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(DEPOT_PAGE_COUNT);
    render(<ScopeSwitcher />);
    expect(screen.getByRole('button', { name: /UPSRTC \/ KAUSHAMBI/ })).toBeTruthy();
  });

  it('renders no tabs and says Unknown depot when the feed lacks the depot', () => {
    pathname = '/project/depots/d/999999';
    detailError = 'Depot not found';
    const { container } = render(<DepotSubNav depotId="999999" />);
    expect(container.innerHTML).toBe('');
    render(<ScopeSwitcher />);
    expect(screen.getByRole('button', { name: /UPSRTC \/ Unknown depot/ })).toBeTruthy();
  });

  it('keeps the tabs and shows Depot 49 when the data failed and the name is unknown', () => {
    networkDepots = null;
    detailError = 'HTTP 503';
    render(<DepotSubNav depotId="49" />);
    expect(screen.getAllByRole('link')).toHaveLength(DEPOT_PAGE_COUNT);
    cleanup();
    render(<ScopeSwitcher />);
    expect(screen.getByText(/UPSRTC \/ Depot 49/)).toBeTruthy();
  });
});
