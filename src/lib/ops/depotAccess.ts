/**
 * Resolving WHICH depot the caller owns — the server-side half of the depot
 * ownership boundary (db/migrations/20260812150000__ops_depot_ownership.sql).
 *
 * This module is the single place a depot scope is ever produced. Every
 * depot-scoped surface calls `resolveOpsFleetScope` with nothing but the
 * session claims and takes what it returns; none of them read `depot_id`
 * themselves, and none of them accept a depot from the request. That is the
 * property that makes the boundary hold against a direct API call: there is
 * no parameter to tamper with, because the depot is derived from the
 * caller's own ops_users row, exactly as the pilot-driver command routes
 * derive the vehicle from theirs.
 *
 * Server-only: it reads the ops datastore. The pure matching rule it feeds
 * lives in depotScope.ts and is tested without a database.
 */
import 'server-only';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import type { OpsSessionClaims } from '@/lib/auth/rbac/session';
import { OPS_FLEET_SCOPE_ALL, type OpsFleetScope } from './depotScope';

/**
 * Why a caller has no fleet scope. Every one of these is a refusal, never a
 * quiet widening to the statewide fleet.
 *
 *  - `depot_not_assigned`: a depot-role account with no depot yet. The
 *    expected, benign case immediately after an invite is accepted, fixed by
 *    one admin action. Surfaced to the operator as such.
 *  - `depot_missing`: a depot-role account whose depot_id points at a row
 *    that is not in the registry. The FK (on delete restrict) is supposed to
 *    make this unreachable; it is handled anyway because an authorization
 *    decision must not depend on a constraint being intact, and the safe
 *    answer to "I cannot tell which depot this is" is no data.
 */
export type OpsScopeDenial = 'depot_not_assigned' | 'depot_missing';

export type OpsScopeResolution =
  | { ok: true; scope: OpsFleetScope }
  | { ok: false; reason: OpsScopeDenial };

/**
 * The fleet scope for a signed-in ops caller.
 *
 * Throws nothing of its own; an OpsDbConfigError from the pool propagates so
 * the caller can answer 503 NOT_CONFIGURED the way every other ops surface
 * does. A thrown error is a refusal too — no path through this function
 * returns the statewide scope for a depot-role caller.
 *
 * ROLES OTHER THAN `depot` ARE UNCHANGED BY THIS TICKET and deliberately so.
 * dispatcher, control_room and planner are statewide jobs — a dispatcher
 * coordinating a corridor works across depots by definition. driver and
 * pilot_driver keep the statewide scope here as well: they reach a fleet read
 * only through GET /api/ops/fleet/schedule, whose driver-facing contract is
 * already owned by ops_users.vehicle_id's column comment (a read-only
 * schedule lookup, with a documented self-reported-registration fallback).
 * Narrowing that would change the driver surface, which this ticket does not
 * touch. `admin` has no operational dashboard and never calls a fleet read.
 */
export async function resolveOpsFleetScope(
  claims: Pick<OpsSessionClaims, 'sub' | 'role'>,
): Promise<OpsScopeResolution> {
  if (claims.role !== 'depot') {
    return { ok: true, scope: OPS_FLEET_SCOPE_ALL };
  }

  const repo = getOpsRepo();
  // The caller's OWN row, by session subject. Never a depot supplied by the
  // request in any form.
  const user = await repo.findUserById(claims.sub);
  if (!user || user.depotId === null) {
    return { ok: false, reason: 'depot_not_assigned' };
  }

  const depot = await repo.findDepotById(user.depotId);
  if (!depot) {
    return { ok: false, reason: 'depot_missing' };
  }

  return {
    ok: true,
    scope: { kind: 'depot', depotCode: depot.code, depotName: depot.name },
  };
}

/**
 * The wire refusal for a caller with no usable depot scope, in this repo's
 * established `{ error: { code, message } }` shape.
 *
 * 409 rather than 403, mirroring VEHICLE_NOT_ASSIGNED: the caller's role IS
 * permitted here, so this is not a role refusal — the account is in a state
 * that cannot be served, and an admin action resolves it. A 403 would tell
 * the operator to try another account, which is the wrong instruction.
 */
export const DEPOT_SCOPE_DENIAL_RESPONSE: Record<
  OpsScopeDenial,
  { code: string; message: string; status: number }
> = {
  depot_not_assigned: {
    code: 'DEPOT_NOT_ASSIGNED',
    message: 'No depot is assigned to your account yet. Contact your admin.',
    status: 409,
  },
  depot_missing: {
    code: 'DEPOT_NOT_ASSIGNED',
    message: 'The depot assigned to your account no longer exists. Contact your admin.',
    status: 409,
  },
};
