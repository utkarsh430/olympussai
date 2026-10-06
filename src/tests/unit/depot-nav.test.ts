import { describe, expect, it } from 'vitest';
import { DEPOTS_ROOT, NETWORK_NAV, isNavItemActive } from '@/lib/depot/nav';

describe('isNavItemActive', () => {
  const exactItem = { href: '/project/depots', label: 'Overview', exact: true };
  const sectionItem = { href: '/project/depots/league', label: 'League' };

  it('matches an exact item only on its own path, ignoring a trailing slash', () => {
    expect(isNavItemActive('/project/depots', exactItem)).toBe(true);
    expect(isNavItemActive('/project/depots/', exactItem)).toBe(true);
    expect(isNavItemActive('/project/depots/league', exactItem)).toBe(false);
  });

  it('matches a section item on its path and any descendant', () => {
    expect(isNavItemActive('/project/depots/league', sectionItem)).toBe(true);
    expect(isNavItemActive('/project/depots/league/', sectionItem)).toBe(true);
    expect(isNavItemActive('/project/depots/league/x', sectionItem)).toBe(true);
  });

  it('does not match a sibling that merely shares a prefix', () => {
    expect(isNavItemActive('/project/depots/leagues', sectionItem)).toBe(false);
  });
});

describe('NETWORK_NAV', () => {
  it('has at least one group and every link lives under the depots root', () => {
    expect(NETWORK_NAV.length).toBeGreaterThan(0);
    for (const group of NETWORK_NAV) {
      for (const item of group.items) {
        expect(item.href.startsWith(DEPOTS_ROOT)).toBe(true);
      }
    }
  });
});
