import { describe, expect, it } from 'vitest';
import {
  NETWORK_SCOPE_KEY,
  depotHref,
  depotIdFromPath,
  depotNav,
  filterScopeOptions,
  isDepotNavItemActive,
  moveActiveIndex,
  rosterBusHref,
  scopeLabel,
  scopeLabelForPath,
  scopeOptions,
  type ScopeDepot,
} from '@/lib/depot/depotNav';

const ID = '1234';
const ROOT = `/project/depots/d/${ID}`;

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`no item at ${index}`);
  return value;
}

describe('depotNav', () => {
  const items = depotNav(ID);
  const cockpit = at(items, 0);
  const roster = at(items, 1);
  const yard = at(items, 2);

  it('lists Cockpit, Roster and Yard for one depot, cockpit matched exactly', () => {
    expect(depotNav(ID).map((item) => item.label)).toEqual([
      'Cockpit',
      'Roster',
      'Yard',
      'Duties',
      'Maintenance',
      'Crew',
      'Fuel and cost',
      'Revenue',
      'Trends',
    ]);
    expect(cockpit).toEqual({ href: ROOT, label: 'Cockpit', exact: true });
    expect(roster.href).toBe(`${ROOT}/roster`);
    expect(yard.href).toBe(`${ROOT}/yard`);
  });

  it('marks exactly one item active on each page', () => {
    const activeOn = (path: string): string[] =>
      depotNav(ID)
        .filter((item) => isDepotNavItemActive(path, item))
        .map((item) => item.label);
    expect(activeOn(ROOT)).toEqual(['Cockpit']);
    expect(activeOn(`${ROOT}/roster`)).toEqual(['Roster']);
    expect(activeOn(`${ROOT}/yard`)).toEqual(['Yard']);
    expect(activeOn(`${ROOT}/duties`)).toEqual(['Duties']);
    expect(activeOn(`${ROOT}/maintenance`)).toEqual(['Maintenance']);
    expect(activeOn(`${ROOT}/crew`)).toEqual(['Crew']);
    expect(activeOn(`${ROOT}/fuel`)).toEqual(['Fuel and cost']);
    expect(activeOn(`${ROOT}/revenue`)).toEqual(['Revenue']);
    expect(activeOn(`${ROOT}/trends`)).toEqual(['Trends']);
  });

  it('ignores a trailing slash, a query string and a hash', () => {
    expect(isDepotNavItemActive(`${ROOT}/`, cockpit)).toBe(true);
    expect(isDepotNavItemActive(`${ROOT}?tab=1`, cockpit)).toBe(true);
    expect(isDepotNavItemActive(`${ROOT}/roster/?bus=UP32AB1234`, roster)).toBe(true);
    expect(isDepotNavItemActive(`${ROOT}/roster?bus=UP32AB1234`, cockpit)).toBe(false);
    expect(isDepotNavItemActive(`${ROOT}/yard#map`, yard)).toBe(true);
  });

  it('does not mark another depot or a prefix sibling active', () => {
    expect(isDepotNavItemActive('/project/depots/d/12345/roster', roster)).toBe(false);
    expect(isDepotNavItemActive(`${ROOT}/rosters`, roster)).toBe(false);
  });
});

describe('depot scope hrefs', () => {
  it('builds the cockpit and the roster link with a pre-selected bus', () => {
    expect(depotHref(ID)).toBe(ROOT);
    expect(rosterBusHref(ID, 'UP32 AB/1234')).toBe(`${ROOT}/roster?bus=UP32%20AB%2F1234`);
  });

  it('reads the depot id from a depot-scope path and nothing else', () => {
    expect(depotIdFromPath(ROOT)).toBe(ID);
    expect(depotIdFromPath(`${ROOT}/roster`)).toBe(ID);
    expect(depotIdFromPath('/project/depots/d/unassigned/yard')).toBe('unassigned');
    expect(depotIdFromPath('/project/depots')).toBeNull();
    expect(depotIdFromPath('/project/depots/league')).toBeNull();
    expect(depotIdFromPath('/project/depots/d/not-an-id')).toBeNull();
  });
});

const DEPOTS: readonly ScopeDepot[] = [
  { id: '20', name: 'Varanasi', kind: 'depot', fleet: 142 },
  { id: '7', name: 'Agra Fort', kind: 'depot', fleet: 88 },
  { id: '31', name: 'Lucknow Electric', kind: 'electric', fleet: 1 },
];

describe('scopeOptions', () => {
  const options = scopeOptions(DEPOTS);

  it('puts Headquarters first, then depots by name with kind and fleet', () => {
    expect(options.map((o) => o.label)).toEqual([
      'Headquarters',
      'Agra Fort',
      'Lucknow Electric',
      'Varanasi',
    ]);
    expect(options[0]).toMatchObject({ key: NETWORK_SCOPE_KEY, href: '/project/depots' });
    expect(options[1]).toMatchObject({ href: '/project/depots/d/7', detail: 'Depot · 88 buses' });
    expect(options[2]?.detail).toBe('Electric fleet · 1 bus');
  });

  it('does not reorder the input', () => {
    const input = [...DEPOTS];
    scopeOptions(input);
    expect(input).toEqual(DEPOTS);
  });
});

describe('filterScopeOptions', () => {
  const options = scopeOptions(DEPOTS);

  it('returns every option for an empty or blank filter', () => {
    expect(filterScopeOptions(options, '')).toEqual(options);
    expect(filterScopeOptions(options, '   ')).toEqual(options);
  });

  it('matches name and id case-insensitively, keeping the order', () => {
    expect(filterScopeOptions(options, 'LUCK').map((o) => o.label)).toEqual(['Lucknow Electric']);
    expect(filterScopeOptions(options, 'a').map((o) => o.label)).toEqual(['Headquarters', 'Agra Fort', 'Varanasi']);
    expect(filterScopeOptions(options, '31').map((o) => o.label)).toEqual(['Lucknow Electric']);
    expect(filterScopeOptions(options, 'head').map((o) => o.label)).toEqual(['Headquarters']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterScopeOptions(options, 'zzz')).toEqual([]);
  });
});

describe('moveActiveIndex (wraps around)', () => {
  it('moves down and up, wrapping at both ends', () => {
    expect(moveActiveIndex(0, 'next', 3)).toBe(1);
    expect(moveActiveIndex(2, 'next', 3)).toBe(0);
    expect(moveActiveIndex(0, 'previous', 3)).toBe(2);
    expect(moveActiveIndex(1, 'previous', 3)).toBe(0);
  });

  it('starts from nothing active', () => {
    expect(moveActiveIndex(-1, 'next', 3)).toBe(0);
    expect(moveActiveIndex(-1, 'previous', 3)).toBe(2);
  });

  it('jumps to the first and last option', () => {
    expect(moveActiveIndex(1, 'first', 3)).toBe(0);
    expect(moveActiveIndex(1, 'last', 3)).toBe(2);
  });

  it('has no active option when the list is empty, and recovers from a stale index', () => {
    expect(moveActiveIndex(0, 'next', 0)).toBe(-1);
    expect(moveActiveIndex(-1, 'last', 0)).toBe(-1);
    expect(moveActiveIndex(9, 'next', 3)).toBe(0);
  });
});

describe('scopeLabel', () => {
  it('names the network, a known depot, or an id not yet in the list', () => {
    expect(scopeLabel(null, DEPOTS)).toBe('UPSRTC / Headquarters');
    expect(scopeLabel('20', DEPOTS)).toBe('UPSRTC / Varanasi');
    expect(scopeLabel('99', DEPOTS)).toBe('UPSRTC / Depot 99');
    expect(scopeLabel('99', null)).toBe('UPSRTC / Depot 99');
  });
});

describe('scopeLabelForPath', () => {
  it('never claims the network for a malformed depot address', () => {
    expect(scopeLabelForPath('/project/depots/d/abc', DEPOTS)).toBe('UPSRTC / Unknown depot');
    expect(scopeLabelForPath('/project/depots/d/20/roster', DEPOTS)).toBe('UPSRTC / Varanasi');
    expect(scopeLabelForPath('/project/depots/league', DEPOTS)).toBe('UPSRTC / Headquarters');
  });
});
