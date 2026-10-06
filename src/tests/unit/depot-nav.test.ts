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
  const items = NETWORK_NAV.flatMap((group) => group.items);

  it('has at least one group and every link lives under the depots root', () => {
    expect(NETWORK_NAV.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.href.startsWith(DEPOTS_ROOT)).toBe(true);
    }
  });

  it('links every network page that exists, each once', () => {
    expect(NETWORK_NAV.map((group) => group.heading)).toEqual([
      'Network',
      'Intelligence',
      'System',
    ]);
    expect(items.map((item) => [item.label, item.href])).toEqual([
      ['Overview', '/project/depots'],
      ['League table', '/project/depots/league'],
      ['Fleet distribution', '/project/depots/rebalance'],
      ['Routes', '/project/depots/routes'],
      ['Exceptions', '/project/depots/exceptions'],
      ['Economics', '/project/depots/economics'],
      ['Ask', '/project/depots/ask'],
      ['Data sources', '/project/depots/sources'],
    ]);
    expect(new Set(items.map((item) => item.href)).size).toBe(items.length);
  });

  it('marks exactly one item active on each of its pages', () => {
    for (const item of items) {
      const active = items.filter((candidate) => isNavItemActive(item.href, candidate));
      expect(active, item.href).toEqual([item]);
    }
  });
});
