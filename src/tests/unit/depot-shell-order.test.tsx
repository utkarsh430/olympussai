import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepotShell } from '@/components/depot/shell/DepotShell';

vi.mock('next/navigation', () => ({
  usePathname: (): string => '/project/depots/d/49/yard',
  useRouter: (): { push: () => void } => ({ push: () => {} }),
  useSearchParams: (): URLSearchParams => new URLSearchParams(),
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
  it('puts the skip link first, then the bar, then the sidebar tree, then the page', () => {
    const { container } = render(
      <DepotShell>
        <button type="button">First page control</button>
      </DepotShell>,
    );
    const all = focusables(container);
    expect(all[0]?.textContent).toBe('Skip to depot content');
    expect(all[0]?.getAttribute('href')).toBe('#depot-main');

    // The sidebar tree lists the six workspaces and System; the current one is open,
    // its features are links in the depot's own form, and the current feature is marked.
    const rail = screen.getByTestId('depot-nav');
    const workspaces = [...rail.querySelectorAll('[data-testid="os-workspace-link"]')];
    expect(workspaces).toHaveLength(7);
    expect(workspaces[0]?.textContent).toContain('Control Room');
    expect(workspaces[2]?.getAttribute('aria-expanded')).toBe('true');
    expect(workspaces[0]?.getAttribute('aria-expanded')).toBe('false');
    const yard = [...rail.querySelectorAll('[data-testid="os-feature-link"]')].find((a) => a.getAttribute('aria-current') === 'page');
    expect(yard?.textContent).toContain('Yard Intelligence');
    expect(yard?.getAttribute('href')).toBe('/project/depots/d/49/yard');
    // The bar comes before the navigation, the navigation before the page.
    const order = all.map((el) => el.textContent ?? '');
    const firstWorkspace = order.findIndex((text) => text.includes('Control Room'));
    expect(order.indexOf('Operations')).toBeLessThan(firstWorkspace);

    const main = container.querySelector('#depot-main');
    expect(main?.getAttribute('tabindex')).toBe('-1');
    // The workspace's view tabs lead the page; the page's own controls follow them.
    const inMain = focusables(main as Element).map((el) => el.textContent);
    expect(inMain[inMain.length - 1]).toBe('First page control');
    expect(screen.getByTestId('os-workspace-tabs').compareDocumentPosition(screen.getByText('First page control')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('holds Operations and Sign out behind one menu button below the rail breakpoint', () => {
    render(
      <DepotShell>
        <p>page</p>
      </DepotShell>,
    );
    const menu = screen.getByTestId('depot-bar-menu');
    const button = menu.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(menu.querySelectorAll('a')).toHaveLength(0);
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const operations = [...menu.querySelectorAll('a')].find((a) => a.textContent === 'Operations');
    expect(operations?.getAttribute('href')).toBe('/project/upsrtc');
    expect(menu.querySelector('[data-testid="depot-sign-out"]')).not.toBeNull();
  });

  it('keeps the disclaimer in the page flow after the content, with no space reserved', () => {
    const { container } = render(
      <DepotShell>
        <p>page</p>
      </DepotShell>,
    );
    const main = container.querySelector('#depot-main') as HTMLElement;
    const footer = screen.getByTestId('footer-disclaimer');
    expect(main.className).not.toContain('--depot-footer-h');
    expect(main.className).toContain('px-4 pb-8');
    expect(main.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.className).not.toMatch(/\b(fixed|sticky)\b/);
  });
});
