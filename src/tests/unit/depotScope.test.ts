// The pure half of the depot ownership boundary: how a live vehicle is
// matched to a depot, and what happens to everything that does not match.
//
// These are the properties the server-side scoping in depotAccess.ts,
// fleetData.ts and the /api/ops/fleet/* routes all rest on, so they are
// tested here without a database or a route handler. The wire-level proof
// that the routes actually apply them lives in depotBoundary.test.ts.
import { describe, it, expect } from 'vitest';
import { collapseDepots } from '../../../scripts/seed-ops-depots';
import {
  normalizeDepotCode,
  busDepotCode,
  busInScope,
  filterBusesToScope,
  filterVehicleStatesToScope,
  scopeLabel,
  OPS_FLEET_SCOPE_ALL,
  type OpsFleetScope,
} from '@/lib/ops/depotScope';
import type { CanonicalLiveBus } from '@/models/canonical';

function bus(overrides: Partial<CanonicalLiveBus> = {}): CanonicalLiveBus {
  return {
    id: 'UP25FT4823',
    registrationNumber: 'UP25FT4823',
    latitude: 28.35,
    longitude: 79.42,
    speedKmph: 22,
    headingDegrees: 90,
    depotName: 'BAREILLY',
    routeId: 'R1',
    routeName: 'Bareilly Express',
    serviceNumber: 'S1',
    tripId: 'T1',
    vehicleType: null,
    gpsTimestamp: '2026-08-12T06:00:00Z',
    lastUpdatedAt: '2026-08-12T06:00:00Z',
    ignitionOn: true,
    rawStatus: 'RUNNING',
    tripDate: '2026-08-12',
    dataQuality: 'good',
    ...overrides,
  };
}

const BAREILLY: OpsFleetScope = { kind: 'depot', depotCode: 'BAREILLY', depotName: 'Bareilly' };
const LUCKNOW: OpsFleetScope = { kind: 'depot', depotCode: 'LUCKNOW', depotName: 'Lucknow' };

describe('normalizeDepotCode', () => {
  it('uppercases, trims and collapses internal whitespace', () => {
    expect(normalizeDepotCode('bareilly')).toBe('BAREILLY');
    expect(normalizeDepotCode('  Bareilly  ')).toBe('BAREILLY');
    expect(normalizeDepotCode('PITAL   NAGRI')).toBe('PITAL NAGRI');
    expect(normalizeDepotCode('\tMuzaffar\nNagar ')).toBe('MUZAFFAR NAGAR');
  });

  it('treats absent, empty and whitespace-only names as unattributed', () => {
    expect(normalizeDepotCode(null)).toBeNull();
    expect(normalizeDepotCode(undefined)).toBeNull();
    expect(normalizeDepotCode('')).toBeNull();
    expect(normalizeDepotCode('   ')).toBeNull();
  });

  // The one mistake this function must never make. These are real depot
  // names from the live feed whose suffixes distinguish them from a
  // same-named neighbour; merging any pair would hand one depot's vehicles
  // to another depot's operator.
  it('keeps genuinely distinct depots distinct', () => {
    expect(normalizeDepotCode('SAHARANPUR(A)')).not.toBe(normalizeDepotCode('SAHARANPUR'));
    expect(normalizeDepotCode('BAREILLY(R)')).not.toBe(normalizeDepotCode('BAREILLY'));
    expect(normalizeDepotCode('AZAMGARH(R)')).not.toBe(normalizeDepotCode('AZAMGARH'));
    expect(normalizeDepotCode('ENFORCEMENT_Bareilly')).not.toBe(normalizeDepotCode('BAREILLY'));
    expect(normalizeDepotCode('ENFORCEMENT_Agra')).not.toBe(normalizeDepotCode('ENFORCEMENT_Aligarh'));
  });
});

describe('busDepotCode', () => {
  it('derives the code from the vehicle depot name', () => {
    expect(busDepotCode(bus({ depotName: 'bareilly' }))).toBe('BAREILLY');
  });

  it('is null for a vehicle the feed reports with no depot', () => {
    // The normalizer already maps the feed's literal "None" to null, so a
    // null depotName is how an unattributed vehicle actually arrives here.
    expect(busDepotCode(bus({ depotName: null }))).toBeNull();
  });
});

describe('busInScope', () => {
  it('admits everything under the statewide scope', () => {
    expect(busInScope(bus({ depotName: 'BAREILLY' }), OPS_FLEET_SCOPE_ALL)).toBe(true);
    expect(busInScope(bus({ depotName: null }), OPS_FLEET_SCOPE_ALL)).toBe(true);
  });

  it('admits a vehicle only into its own depot', () => {
    expect(busInScope(bus({ depotName: 'BAREILLY' }), BAREILLY)).toBe(true);
    expect(busInScope(bus({ depotName: 'BAREILLY' }), LUCKNOW)).toBe(false);
  });

  it('matches across casing and whitespace drift in the feed', () => {
    expect(busInScope(bus({ depotName: ' bareilly ' }), BAREILLY)).toBe(true);
  });

  // The decision recorded in the migration: an unattributed vehicle is owned
  // by nobody, not shared by everybody.
  it('shows an unattributed vehicle to NO depot', () => {
    for (const depotName of [null, '', '   ']) {
      expect(busInScope(bus({ depotName }), BAREILLY)).toBe(false);
      expect(busInScope(bus({ depotName }), LUCKNOW)).toBe(false);
    }
  });
});

describe('filterBusesToScope', () => {
  const fleet = [
    bus({ id: 'a', depotName: 'BAREILLY' }),
    bus({ id: 'b', depotName: 'LUCKNOW' }),
    bus({ id: 'c', depotName: 'bareilly' }),
    bus({ id: 'd', depotName: null }),
  ];

  it('narrows to one depot', () => {
    expect(filterBusesToScope(fleet, BAREILLY).map((b) => b.id)).toEqual(['a', 'c']);
    expect(filterBusesToScope(fleet, LUCKNOW).map((b) => b.id)).toEqual(['b']);
  });

  it('produces disjoint sets for two different depots', () => {
    const mine = new Set(filterBusesToScope(fleet, BAREILLY).map((b) => b.id));
    const theirs = new Set(filterBusesToScope(fleet, LUCKNOW).map((b) => b.id));
    for (const id of mine) expect(theirs.has(id)).toBe(false);
  });

  it('keeps the whole fleet for the statewide scope', () => {
    expect(filterBusesToScope(fleet, OPS_FLEET_SCOPE_ALL)).toHaveLength(4);
  });

  it('never returns the source array itself, so a caller cannot mutate a cached snapshot', () => {
    expect(filterBusesToScope(fleet, OPS_FLEET_SCOPE_ALL)).not.toBe(fleet);
  });
});

describe('filterVehicleStatesToScope', () => {
  const states = [{ vehicleId: 'a' }, { vehicleId: 'b' }, { vehicleId: 'unknown-to-the-feed' }];

  it('keeps only states whose vehicle is in the scoped fleet', () => {
    const scopedFleet = [bus({ id: 'a' })];
    expect(filterVehicleStatesToScope(states, BAREILLY, scopedFleet).map((s) => s.vehicleId)).toEqual(['a']);
  });

  it('drops a vehicle the live feed cannot attribute to any depot', () => {
    expect(filterVehicleStatesToScope(states, BAREILLY, []).map((s) => s.vehicleId)).toEqual([]);
  });

  it('leaves the statewide scope untouched', () => {
    expect(filterVehicleStatesToScope(states, OPS_FLEET_SCOPE_ALL, [])).toHaveLength(3);
  });
});

// The seed script imports normalizeDepotCode from the module above rather
// than copying it, so seeding and matching cannot drift. What is worth
// testing here is the honesty of what it does with messy upstream data.
describe('collapseDepots (registry seeding)', () => {
  it('produces one registry row per canonical depot', () => {
    const { depots } = collapseDepots([
      { depot_name: 'BAREILLY', home_depot: '81' },
      { depot_name: 'bareilly', home_depot: '81' },
      { depot_name: 'LUCKNOW', home_depot: '9' },
    ]);
    expect(depots.map((d) => d.code)).toEqual(['BAREILLY', 'LUCKNOW']);
  });

  it('never creates a registry row for an unattributed vehicle', () => {
    const { depots, unattributed } = collapseDepots([
      { depot_name: null },
      { depot_name: '' },
      { depot_name: '   ' },
      // The feed's own spelling of null. A depot literally named "None" must
      // never become something an operator can be assigned to.
      { depot_name: 'None' },
      { depot_name: 'BAREILLY', home_depot: '81' },
    ]);
    expect(depots.map((d) => d.code)).toEqual(['BAREILLY']);
    expect(unattributed).toBe(4);
  });

  it('reports spelling variants it merged instead of hiding them', () => {
    const { spellingVariants } = collapseDepots([
      { depot_name: 'PITAL NAGRI', home_depot: '114' },
      { depot_name: 'pital  nagri', home_depot: '114' },
    ]);
    expect(spellingVariants).toHaveLength(1);
    expect(spellingVariants[0]?.code).toBe('PITAL NAGRI');
    expect(spellingVariants[0]?.spellings).toHaveLength(2);
  });

  // Ambiguity is surfaced for a human, never guessed at — and because
  // upstream ids are provenance only, a conflict cannot mis-scope anyone.
  it('reports an upstream id shared by two depot names', () => {
    const { idConflicts } = collapseDepots([
      { depot_name: 'BAREILLY', home_depot: '81' },
      { depot_name: 'BAREILLY(R)', home_depot: '81' },
    ]);
    expect(idConflicts).toContainEqual({
      kind: 'id-has-many-codes',
      id: '81',
      codes: ['BAREILLY', 'BAREILLY(R)'],
    });
  });

  it('reports one depot name carrying two upstream ids', () => {
    const { idConflicts } = collapseDepots([
      { depot_name: 'AGRA', home_depot: '1' },
      { depot_name: 'AGRA', home_depot: '2' },
    ]);
    expect(idConflicts).toContainEqual({ kind: 'code-has-many-ids', code: 'AGRA', ids: ['1', '2'] });
  });

  it('leaves upstream_depot_id null rather than guessing when a depot carries conflicting ids', () => {
    const { depots } = collapseDepots([
      { depot_name: 'AGRA', home_depot: '1' },
      { depot_name: 'AGRA', home_depot: '2' },
    ]);
    expect(depots[0]?.upstreamIds.size).toBe(2);
  });
});

describe('scopeLabel', () => {
  it('names the depot, or says all depots for the statewide scope', () => {
    expect(scopeLabel(BAREILLY)).toBe('Bareilly');
    expect(scopeLabel(OPS_FLEET_SCOPE_ALL)).toBe('all depots');
  });
});
