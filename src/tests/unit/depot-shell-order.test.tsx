import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepotShell } from '@/components/depot/shell/DepotShell';
import { DepotSubNav } from '@/components/depot/shell/DepotSubNav';

vi.mock('next/navigation', () => ({
  usePathname: (): string => '/project/depots/d/49/yard',
  useRouter: (): { push: () => void } => ({ push: () => {} }),
}));
vi.mock('@/hooks/useProjectSignOut', () => ({
  useProjectSignOut: (): unknown => ({ signOut: () => {}, pending: false }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  DepotNetworkProvider: ({ children }: { children: React.ReactNode }): React.ReactNode => children,
  useDepotNetworkContext: (): unknown => ({
    data: { depots: [{ id: '49', name: 'KAUSHAMBI', kind: 'depot', fleet: 200 }], source: 'live' },
    error: null,
    loading: false,
    refresh: () => {},
  }),
}));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => ({
    data: null,
    error: null,
    loading: true,
    refresh: () => {},
  }),
}));

afterEach(cleanup);

function focusables(root: Element): readonly HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([tabindex="-1"])'));
}

describe('DepotShell structure', () => {
  it('puts the skip link first and the depot tabs first inside the page region', () => {
    const { container } = render(
      <DepotShell>
        <DepotSubNav depotId="49" />
        <button type="button">First page control</button>
      </DepotShell>,
    );
    const all = focusables(container);
    expect(all[0]?.textContent).toBe('Skip to depot content');
    expect(all[0]?.getAttribute('href')).toBe('#depot-main');

    const main = container.querySelector('#depot-main');
    expect(main?.getAttribute('tabindex')).toBe('-1');
    const inMain = focusables(main as Element);
    expect(inMain[0]?.textContent).toBe('Cockpit');
    expect(inMain.at(-1)?.textContent).toBe('First page control');
  });

  it('keeps the scope switcher and the feed chip in separate groups of the top bar', () => {
    render(
      <DepotShell>
        <p>page</p>
      </DepotShell>,
    );
    const scopeGroup = screen.getByTestId('depot-top-bar-scope');
    const actionGroup = screen.getByTestId('depot-top-bar-actions');
    expect(scopeGroup.contains(screen.getByTestId('depot-scope-switcher'))).toBe(true);
    expect(actionGroup.contains(screen.getByTestId('depot-feed-status'))).toBe(true);
    expect(scopeGroup.contains(actionGroup)).toBe(false);
    expect(actionGroup.contains(screen.getByTestId('depot-feed-status'))).toBe(true);
  });

  it('reserves room under the page for the footer through the shell property', () => {
    const { container } = render(
      <DepotShell>
        <p>page</p>
      </DepotShell>,
    );
    expect(container.querySelector('#depot-main')?.className).toContain('--depot-footer-h');
  });
});
