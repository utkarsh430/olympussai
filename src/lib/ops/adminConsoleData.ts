import 'server-only';

/**
 * The reads behind the admin console, each one degrading to "I could not see
 * this" rather than to an empty list.
 *
 * The distinction is the whole contract with `adminConsoleModel`: that module
 * refuses to print a number for a source that did not answer, and it can only
 * honour that if every reader here reports its own health honestly instead of
 * swallowing a failure into a zero. So each read is wrapped individually — one
 * dead upstream costs its own tiles and nothing else, and a `Promise.all` that
 * rejects as a whole (the failure mode that once made the control room report
 * an outage at a service that had just answered) is impossible by
 * construction.
 *
 * Nothing here is cached beyond what its own data source already does
 * (`pilotData`'s ten-second last-known-good). An admin screen is read rarely
 * and acted on immediately; a stale roster behind a role change would be worse
 * than the extra query.
 */
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { deriveInviteStatus } from '@/lib/auth/rbac/inviteStatus';
import { getRolloutStages } from '@/lib/controlService/pilotData';
import { fetchControlService } from '@/lib/controlService/client';
import { routeDirectionsResponseSchema, type RolloutStage } from '@/models/control';
import { permitsCommands } from './rolloutPosture';
import {
  tallyStages,
  emptyStageTally,
  type AdminConsoleFacts,
  type AdminInviteFacts,
  type AdminNetworkFacts,
  type AdminRolloutFacts,
  type AdminRosterFacts,
} from './adminConsoleModel';

/** Roles for which a missing vehicle assignment means "receives no instructions". */
const VEHICLE_ASSIGNABLE_ROLES: readonly string[] = ['driver', 'pilot_driver'];

export async function readRosterFacts(): Promise<AdminRosterFacts> {
  const empty: AdminRosterFacts = {
    ok: false,
    total: 0,
    active: 0,
    disabled: 0,
    activeAdmins: 0,
    depotOperatorsWithoutDepot: 0,
    driversWithoutVehicle: 0,
  };

  try {
    const users = await getOpsRepo().listUsers();
    const active = users.filter((user) => user.status === 'active');
    return {
      ok: true,
      total: users.length,
      active: active.length,
      disabled: users.length - active.length,
      activeAdmins: active.filter((user) => user.role === 'admin').length,
      // Counted over ACTIVE accounts only: a disabled operator with no depot is
      // not a gap anybody needs to close.
      depotOperatorsWithoutDepot: active.filter(
        (user) => user.role === 'depot' && !user.depotId,
      ).length,
      driversWithoutVehicle: active.filter(
        (user) => VEHICLE_ASSIGNABLE_ROLES.includes(user.role) && !user.vehicleId,
      ).length,
    };
  } catch (error) {
    console.error('[ops/admin] could not read the operator roster', error);
    return empty;
  }
}

export async function readInviteFacts(): Promise<AdminInviteFacts> {
  try {
    const invites = await getOpsRepo().listOutstandingInvites();
    const statuses = invites.map((invite) => deriveInviteStatus(invite));
    return {
      ok: true,
      pending: statuses.filter((status) => status === 'pending').length,
      expired: statuses.filter((status) => status === 'expired').length,
    };
  } catch (error) {
    console.error('[ops/admin] could not read outstanding invites', error);
    return { ok: false, pending: 0, expired: 0 };
  }
}

/**
 * The two control-service reads the console's network numbers come from, taken
 * ONCE and kept together.
 *
 * They are two different populations and the difference matters:
 * `/v1/route-directions` is corridors with geometry — everything an operator
 * can select, see on the map, or supervise — while `/v1/rollout-stages` is
 * every route-direction anybody has ever staged, geometry or not. Reading them
 * separately made the console quote both totals side by side with no way to
 * say why they disagreed. Read together, the gap becomes a fact the console can
 * report instead of a discrepancy a reader has to explain away.
 */
async function readControlNetwork(): Promise<{
  routeDirections: { routeDirectionId: string; hasActivePolicy?: boolean }[] | null;
  stages: { routeDirectionId: string; stage: string }[] | null;
}> {
  const [routeDirections, stages] = await Promise.all([
    (async () => {
      try {
        const raw = await fetchControlService('/v1/route-directions');
        return routeDirectionsResponseSchema.parse(raw).routeDirections;
      } catch (error) {
        console.error('[ops/admin] could not read the corridor list', error);
        return null;
      }
    })(),
    (async () => {
      const snapshot = await getRolloutStages();
      // A stale-but-populated snapshot is still a posture somebody may act on;
      // an empty one from a failed read is not a reading at all.
      if (snapshot.source !== 'live' && snapshot.data.length === 0) return null;
      return snapshot.data;
    })(),
  ]);

  return { routeDirections, stages };
}

export function rolloutFactsFrom(
  stages: { routeDirectionId: string; stage: string }[] | null,
  routeDirections: { routeDirectionId: string }[] | null,
): AdminRolloutFacts {
  if (!stages) {
    return {
      ok: false,
      total: 0,
      permittingCommands: 0,
      byStage: emptyStageTally(),
      permittingWithoutGeometry: null,
    };
  }

  const { byStage, permittingCommands } = tallyStages(
    stages.map((row) => row.stage as RolloutStage),
  );

  // Null, not zero, when the mapped list could not be read: the comparison has
  // no second side, and reporting "0 unmapped" would be an invented all-clear.
  let permittingWithoutGeometry: number | null = null;
  if (routeDirections) {
    const mapped = new Set(routeDirections.map((rd) => rd.routeDirectionId));
    permittingWithoutGeometry = stages.filter(
      (row) => permitsCommands(row.stage as RolloutStage) && !mapped.has(row.routeDirectionId),
    ).length;
  }

  return {
    ok: true,
    total: stages.length,
    permittingCommands,
    byStage,
    permittingWithoutGeometry,
  };
}

export function networkFactsFrom(
  routeDirections: { hasActivePolicy?: boolean }[] | null,
): AdminNetworkFacts {
  if (!routeDirections) return { ok: false, mapped: 0, detecting: null };

  // `undefined` is a control service that predates the field, NOT a corridor
  // without a policy — counting it as false would report zero detection
  // coverage against a network that may be fully policied. Identical
  // reasoning, and identical treatment, to
  // src/lib/ops/controlRoomOverview.ts's `corridorCoverageFrom`.
  const reportsPolicy = routeDirections.some((rd) => rd.hasActivePolicy !== undefined);
  return {
    ok: true,
    mapped: routeDirections.length,
    detecting: reportsPolicy
      ? routeDirections.filter((rd) => rd.hasActivePolicy === true).length
      : null,
  };
}

/** Everything the overview needs, read concurrently, each failing on its own. */
export async function readAdminConsoleFacts(): Promise<AdminConsoleFacts> {
  const [roster, invites, control] = await Promise.all([
    readRosterFacts(),
    readInviteFacts(),
    readControlNetwork(),
  ]);
  return {
    roster,
    invites,
    rollout: rolloutFactsFrom(control.stages, control.routeDirections),
    network: networkFactsFrom(control.routeDirections),
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   THE CORRIDOR LIST BEHIND /ops/admin/network
   ───────────────────────────────────────────────────────────────────────── */

/**
 * One corridor, as an administrator needs to see it: can it detect anything,
 * and what is it allowed to do.
 *
 * The two halves come from two different control-service reads and neither is
 * a superset of the other, so they are JOINED rather than picked between:
 * `/v1/route-directions` is the authoritative list and the only source of
 * `hasActivePolicy`, while `/v1/rollout-stages` is the only source of the
 * human-readable corridor name and the stage. A corridor present in the first
 * and missing from the second is a real state (nothing has ever staged it), and
 * it renders as the default posture rather than being dropped.
 */
export interface AdminCorridor {
  readonly routeDirectionId: string;
  readonly routeId: string;
  readonly directionCode: string;
  /** From the rollout-stage list; null when that read did not cover this corridor. */
  readonly publicName: string | null;
  /**
   * Whether the control service reports an active headway policy — i.e.
   * whether this corridor can detect bunching at all. Null means this control
   * service does not say, which is NOT the same as "no".
   */
  readonly detects: boolean | null;
  /** Null when no stage row exists; the caller renders the documented default. */
  readonly stage: RolloutStage | null;
}

export interface AdminCorridorSnapshot {
  readonly ok: boolean;
  readonly error: string | null;
  readonly corridors: readonly AdminCorridor[];
  readonly mapped: number;
  readonly detecting: number | null;
  /** True when the stage half could not be read, so names and stages are missing but the list is real. */
  readonly stagesMissing: boolean;
}

export async function readAdminCorridors(): Promise<AdminCorridorSnapshot> {
  let routeDirections;
  try {
    const raw = await fetchControlService('/v1/route-directions');
    routeDirections = routeDirectionsResponseSchema.parse(raw).routeDirections;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown control service error';
    console.error('[ops/admin/network] could not read the corridor list', error);
    return {
      ok: false,
      error: message,
      corridors: [],
      mapped: 0,
      detecting: null,
      stagesMissing: true,
    };
  }

  // Best effort, and its failure does not fail the page: the corridor list and
  // its detection coverage — the numbers this screen exists for — came from the
  // read above and are already true.
  const stages = await getRolloutStages();
  const stagesMissing = stages.source !== 'live' && stages.data.length === 0;
  const byId = new Map(stages.data.map((row) => [row.routeDirectionId, row]));

  const reportsPolicy = routeDirections.some((rd) => rd.hasActivePolicy !== undefined);

  const corridors: AdminCorridor[] = routeDirections.map((rd) => {
    const staged = byId.get(rd.routeDirectionId);
    return {
      routeDirectionId: rd.routeDirectionId,
      routeId: rd.routeId,
      directionCode: rd.directionCode,
      publicName: staged?.publicName ?? null,
      detects: rd.hasActivePolicy ?? null,
      stage: (staged?.stage as RolloutStage | undefined) ?? null,
    };
  });

  return {
    ok: true,
    error: null,
    corridors,
    mapped: corridors.length,
    detecting: reportsPolicy ? corridors.filter((c) => c.detects === true).length : null,
    stagesMissing,
  };
}
