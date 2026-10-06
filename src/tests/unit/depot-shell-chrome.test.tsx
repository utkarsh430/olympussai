import { cleanup, render, screen } from '@testing-library/react';
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

describe('the rail from 900px', () => {
  it('stretches the full height of the row, so its surface and hairline never stop early', () => {
    render(<DepotNav />);
    const rail = screen.getByTestId('depot-nav');
    const own = classes(rail);
    expect(own).toEqual(expect.arrayContaining(['border-r', 'bg-depot-page']));
    // Stretched by the flex row, never shrunk to its link list or capped in height.
    expect(own).not.toContain('min-[900px]:self-start');
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

  it('keeps Operations and Sign out behind the Menu below 900px, and inline from 900px', () => {
    render(<DepotTopBar />);
    const menu = classes(screen.getByTestId('depot-bar-menu'));
    expect(menu).toContain('min-[900px]:hidden');
    expect(menu).not.toContain('sm:hidden');

    const operations = classes(screen.getByTestId('depot-back-to-operations'));
    expect(operations).toEqual(expect.arrayContaining(['hidden', 'min-[900px]:inline-flex']));
    const signOut = screen.getByTestId('depot-sign-out').parentElement;
    expect(classes(signOut)).toEqual(expect.arrayContaining(['hidden', 'min-[900px]:contents']));
  });
});
