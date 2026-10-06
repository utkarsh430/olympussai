import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepotShell } from '@/components/depot/shell/DepotShell';

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
  it('puts the skip link first, then the bar, then the depot group leading the rail', () => {
    const { container } = render(
      <DepotShell>
        <button type="button">First page control</button>
      </DepotShell>,
    );
    const all = focusables(container);
    expect(all[0]?.textContent).toBe('Skip to depot content');
    expect(all[0]?.getAttribute('href')).toBe('#depot-main');

    const rail = screen.getByTestId('depot-nav');
    expect(rail.querySelector('p')?.textContent).toBe('KAUSHAMBI');
    expect(focusables(rail)[0]?.textContent).toBe('Cockpit');
    // The bar comes before the navigation, the navigation before the page.
    const order = all.map((el) => el.textContent);
    expect(order.indexOf('Operations')).toBeLessThan(order.indexOf('Cockpit'));

    const main = container.querySelector('#depot-main');
    expect(main?.getAttribute('tabindex')).toBe('-1');
    expect(focusables(main as Element).map((el) => el.textContent)).toEqual(['First page control']);
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

  it('keeps the disclaimer in the page flow after the content, with no space reserved', () => {
    const { container } = render(
      <DepotShell>
        <p>page</p>
      </DepotShell>,
    );
    const main = container.querySelector('#depot-main') as HTMLElement;
    const footer = screen.getByTestId('footer-disclaimer');
    expect(main.className).not.toContain('--depot-footer-h');
    expect(main.className).toContain('px-4 pb-10');
    expect(main.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.className).not.toMatch(/\b(fixed|sticky)\b/);
  });
});
