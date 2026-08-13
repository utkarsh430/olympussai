/**
 * The depot ownership boundary, as a pure rule.
 *
 * Deliberately has no 'server-only' guard and does no I/O, for the same
 * reason fleetView.ts does not: it must be testable and importable from both
 * Server Components and plain unit tests. The I/O half — resolving WHICH
 * depot the caller owns, from their own ops_users row — is server-only and
 * lives in depotAccess.ts. Keeping the two apart is what lets the matching
 * rule be exhaustively tested without a database.
 *
 * This is an authorization boundary, not a display filter
 * (db/migrations/20260812150000__ops_depot_ownership.sql). Two properties
 * carry that weight and both are tested:
 *
 *   1. `normalizeDepotCode` is the ONLY way a depot code is ever derived,
 *      both when the registry is seeded and when a live vehicle is matched.
 *      One function means seeding and matching cannot drift apart.
 *   2. A vehicle that matches no depot is owned by no depot. It is not
 *      bucketed into whichever depot is asking, and there is no "everything"
 *      scope a depot caller can reach.
 */
import type { CanonicalLiveBus } from '@/models/canonical';

/**
 * Canonical depot key: trim, collapse internal whitespace, uppercase.
 *
 * Measured against a full live snapshot (9,170 vehicles, 143 distinct
 * depot_name values) this normalization changed nothing — the feed is
 * already clean and self-consistent, with no casing variants, no stray
 * whitespace and no near-duplicate spellings. It is applied anyway because
 * the boundary must not depend on that staying true, and because the cost of
 * being wrong is asymmetric: a normalization that is slightly too generous
 * merges two spellings of one depot, while no normalization at all lets a
 * single trailing space silently hide a depot's whole fleet from its own
 * operator.
 *
 * What it deliberately does NOT do is fuzzy matching, transliteration, or
 * punctuation stripping. "SAHARANPUR(A)", "BAREILLY(R)" and "AZAMGARH(R)"
 * carry suffixes that distinguish them from same-city depots, and the 22
 * "ENFORCEMENT_*" entries are a separate operational fleet, not spelling
 * drift. Collapsing any of those would merge depots that are genuinely
 * distinct — the one mistake this file must never make, because merging
 * depots grants one depot's operator another depot's vehicles.
 *
 * Returns null for anything that is not a usable depot name, which is the
 * unattributed case: null, undefined, empty, or whitespace-only.
 */
export function normalizeDepotCode(name: string | null | undefined): string | null {
  if (name === null || name === undefined) return null;
  const collapsed = name.trim().replace(/\s+/g, ' ');
  if (collapsed === '') return null;
  return collapsed.toUpperCase();
}

/**
 * The depot code a live vehicle belongs to, or null when it belongs to none.
 *
 * Null here is the honest answer for a vehicle the feed reports with no
 * depot, an empty depot, or the literal string "None" (which
 * src/lib/upsrtc/normalizer.ts already maps to a null depotName). Such a
 * vehicle is shown to no depot operator at all.
 */
export function busDepotCode(bus: Pick<CanonicalLiveBus, 'depotName'>): string | null {
  return normalizeDepotCode(bus.depotName);
}

/**
 * Who a fleet read is being performed for.
 *
 * A discriminated union rather than an optional `depotCode?: string`, because
 * an optional field has a default, and the safe default for an authorization
 * boundary does not exist: "no depot code supplied" must never quietly mean
 * "all depots". Every caller states which of the two it is, and adding a new
 * fleet read means choosing one on purpose.
 *
 * There is no third variant for "unassigned depot user". That case never
 * reaches a fleet read at all — depotAccess.ts refuses it before any data is
 * fetched, so an unassigned operator cannot be represented as a scope.
 */
export type OpsFleetScope =
  | {
      /**
       * The whole statewide fleet. Only for roles whose job is statewide:
       * dispatcher, control_room, planner. Never reachable by a depot-role
       * caller, whatever their assignment.
       */
      kind: 'all';
    }
  | {
      /** Exactly one depot's vehicles, matched on the canonical code. */
      kind: 'depot';
      depotCode: string;
      /** The registry's display spelling, for UI labels only — never used to match. */
      depotName: string;
    };

/** The statewide scope, named so call sites read as a deliberate choice rather than an omission. */
export const OPS_FLEET_SCOPE_ALL: OpsFleetScope = { kind: 'all' };

/** Whether one vehicle is inside a scope. The single place the boundary is decided. */
export function busInScope(bus: Pick<CanonicalLiveBus, 'depotName'>, scope: OpsFleetScope): boolean {
  if (scope.kind === 'all') return true;
  const code = busDepotCode(bus);
  // A vehicle with no resolvable depot matches no depot scope. Never `??
  // scope.depotCode` and never a truthiness shortcut that would let null
  // fall through — that is exactly how an unattributed fleet leaks.
  return code !== null && code === scope.depotCode;
}

/** Narrow a vehicle list to a scope. Returns the same array instance for the statewide scope. */
export function filterBusesToScope<T extends Pick<CanonicalLiveBus, 'depotName'>>(
  buses: readonly T[],
  scope: OpsFleetScope,
): T[] {
  if (scope.kind === 'all') return [...buses];
  return buses.filter((bus) => busInScope(bus, scope));
}

/** Human label for the depot a scope covers, used in dashboard headings. */
export function scopeLabel(scope: OpsFleetScope): string {
  return scope.kind === 'all' ? 'all depots' : scope.depotName;
}

/**
 * Narrow control-service vehicle states to a scope, using an already-scoped
 * live fleet as the membership list.
 *
 * The two datastores are deliberately never joined
 * (docs/CONTROL_SERVICE_INTEGRATION.md §1, §3), so a control-service vehicle
 * state carries no depot of its own. It carries `vehicleId`, and
 * control-service's `vehicles` table is documented as "keyed the same way as
 * src/models/canonical.ts CanonicalLiveBus.id/registrationNumber" — so the
 * scoped live fleet, which DOES know each vehicle's depot, is the membership
 * list. Intersecting against it means a control-service row can only ever be
 * shown when a vehicle of that id is in the caller's own depot.
 *
 * Fails closed by construction: a vehicle state whose id is absent from the
 * scoped fleet is dropped. That includes a vehicle the live feed is not
 * currently reporting, which is the right answer for a boundary — the depot
 * of a vehicle nobody can currently attribute is unknown, and unknown is not
 * a reason to show it.
 */
export function filterVehicleStatesToScope<T extends { vehicleId: string }>(
  vehicleStates: readonly T[],
  scope: OpsFleetScope,
  scopedFleet: readonly Pick<CanonicalLiveBus, 'id'>[],
): T[] {
  if (scope.kind === 'all') return [...vehicleStates];
  const inScope = new Set(scopedFleet.map((bus) => bus.id));
  return vehicleStates.filter((state) => inScope.has(state.vehicleId));
}
