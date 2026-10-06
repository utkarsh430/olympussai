import { describe, expect, it } from 'vitest';
import { NETWORK_NAV } from '@/lib/depot/nav';
import { railGroups, shellNav } from '@/lib/depot/shellModel';

const DEPOTS = [{ id: '49', name: 'KAUSHAMBI', kind: 'depot' as const, fleet: 200 }];

describe('shellNav', () => {
  it('has only the network groups in network scope', () => {
    const nav = shellNav('/project/depots/league', DEPOTS);
    expect(nav.depotGroup).toBeNull();
    expect(railGroups(nav)).toBe(NETWORK_NAV);
  });

  it('leads the rail with the depot by name and its pages', () => {
    const nav = shellNav('/project/depots/d/49/roster', DEPOTS);
    expect(nav.depotGroup?.heading).toBe('KAUSHAMBI');
    expect(nav.depotGroup?.items[0]).toMatchObject({ label: 'Cockpit', href: '/project/depots/d/49' });
    expect(railGroups(nav).map((g) => g.heading)).toEqual([
      'KAUSHAMBI',
      ...NETWORK_NAV.map((g) => g.heading),
    ]);
  });

  it('keeps the depot group, headed by id, while the list is unavailable', () => {
    expect(shellNav('/project/depots/d/49', null).depotGroup?.heading).toBe('Depot 49');
  });

  it('shows no depot group for a depot the feed lacks or a malformed id', () => {
    expect(shellNav('/project/depots/d/999999/yard', DEPOTS).depotGroup).toBeNull();
    expect(shellNav('/project/depots/d/%E0%A4/yard', DEPOTS).depotGroup).toBeNull();
  });
});
