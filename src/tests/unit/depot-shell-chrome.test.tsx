import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepotNav } from '@/components/depot/shell/DepotNav';
import { DepotTopBar } from '@/components/depot/shell/DepotTopBar';

vi.mock('next/navigation', () => ({
  usePathname: (): string => '/project/depots/league',
  useRouter: (): { push: () => void } => ({ push: () => {} }),
}));
vi.mock('@/hooks/useProjectSignOut', () => ({
  useProjectSignOut: (): unknown => ({ signOut: () => {}, pending: false }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({ data: null, error: null, loading: true }),
}));

afterEach(cleanup);

function classes(element: Element | null): readonly string[] {
  return (element?.getAttribute('class') ?? '').split(/\s+/);
}

describe('the rail from 1280px', () => {
  it('stretches the full height of the row, so its surface and hairline never stop early', () => {
    render(<DepotNav />);
    const rail = screen.getByTestId('depot-nav');
    const own = classes(rail);
    expect(own).toEqual(
      expect.arrayContaining(['hidden', 'xl:block', 'xl:w-[232px]', 'border-r', 'bg-depot-page']),
    );
    expect(own.some((name) => name.startsWith('min-[900px]'))).toBe(false);
    // Stretched by the flex row, never shrunk to its link list or capped in height.
    expect(own).not.toContain('xl:self-start');
    expect(own.some((name) => name.includes('max-h-'))).toBe(false);
  });

  it('keeps its links in a sticky column under the bar that scrolls inside itself', () => {
    render(<DepotNav />);
    const column = screen.getByTestId('depot-nav-column');
    expect(screen.getByTestId('depot-nav').contains(column)).toBe(true);
    expect(classes(column)).toEqual(
      expect.arrayContaining([
        'sticky',
        'top-[var(--depot-bar-h)]',
        'max-h-[calc(100dvh-var(--depot-bar-h))]',
        'overflow-y-auto',
      ]),
    );
  });
});

describe('the top bar', () => {
  it('is one row at every width: never a column of two rows', () => {
    render(<DepotTopBar />);
    const bar = classes(screen.getByTestId('depot-top-bar'));
    expect(bar).toEqual(expect.arrayContaining(['flex', 'items-center', 'h-[3.25rem]']));
    expect(bar.filter((name) => name.includes('flex-col'))).toEqual([]);
    expect(bar).toContain('sm:h-[var(--depot-bar-h)]');
  });

  it('marks the product with a 20px glyph below 640px, never initials, and names it in words', () => {
    render(<DepotTopBar />);
    const brand = screen.getByTestId('depot-brand');
    expect(brand.textContent).toBe('Depot Management');
    expect(brand.textContent).not.toContain('DM');
    const glyph = brand.querySelector('svg');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(classes(glyph)).toEqual(expect.arrayContaining(['h-5', 'w-5', 'sm:hidden']));
    const name = screen.getByText('Depot Management');
    expect(classes(name)).toContain('max-sm:sr-only');
  });

  it('keeps Operations and Sign out behind the Menu below 1280px, and inline from 1280px', () => {
    render(<DepotTopBar />);
    const menu = classes(screen.getByTestId('depot-bar-menu'));
    expect(menu).toContain('xl:hidden');
    expect(menu).not.toContain('sm:hidden');

    const operations = classes(screen.getByTestId('depot-back-to-operations'));
    expect(operations).toEqual(expect.arrayContaining(['hidden', 'xl:inline-flex']));
    const signOut = screen.getByTestId('depot-sign-out').parentElement;
    expect(classes(signOut)).toEqual(expect.arrayContaining(['hidden', 'xl:contents']));
  });

  it('sets the in-row Operations and Sign out as quiet buttons, and the menu ones outlined', () => {
    render(<DepotTopBar />);
    expect(classes(screen.getByTestId('depot-back-to-operations'))).toContain(
      'depot-bar-button-quiet',
    );
    expect(classes(screen.getByTestId('depot-sign-out'))).toContain('depot-bar-button-quiet');

    act(() => within(screen.getByTestId('depot-bar-menu')).getByRole('button').click());
    const menu = within(screen.getByTestId('depot-bar-menu'));
    expect(classes(menu.getByRole('link', { name: /Operations/ }))).not.toContain(
      'depot-bar-button-quiet',
    );
    expect(classes(menu.getByTestId('depot-sign-out'))).not.toContain('depot-bar-button-quiet');
  });

  it('opens the menu panel under the bar, aligned to the bar row at 640 to 1279px', () => {
    render(<DepotTopBar />);
    act(() => within(screen.getByTestId('depot-bar-menu')).getByRole('button').click());
    const menu = within(screen.getByTestId('depot-bar-menu'));
    const panel = menu.getByRole('link', { name: /Operations/ }).parentElement;
    expect(classes(panel)).toEqual(
      expect.arrayContaining(['absolute', 'top-full', 'px-4', 'sm:px-6']),
    );
  });
});
