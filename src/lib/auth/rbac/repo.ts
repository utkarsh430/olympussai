/**
 * Ops RBAC repository — the only place that reads/writes ops_users,
 * ops_invites, ops_audit_log, ops_dispatcher_actions (db/migrations/).
 *
 * Node runtime only (pulls in src/lib/db/pool.ts). Defined as an interface
 * with a Postgres-backed implementation so route-handler logic (validation,
 * role checks, response shaping) is unit-testable against an in-memory fake
 * without a live database — same reasoning as why session.ts/config.ts stay
 * dependency-free: keep the parts with real branching logic testable.
 */
import 'server-only';
import { getOpsPool } from '@/lib/db/pool';
import type { OpsRole } from './roles';
import { deriveInviteStatus, type OpsInviteStatus } from './inviteStatus';

export { deriveInviteStatus, type OpsInviteStatus };

export interface OpsUserRecord {
  id: string;
  email: string;
  name: string;
  role: OpsRole;
  passwordHash: string;
  status: 'active' | 'disabled';
  /**
   * The vehicle this driver/pilot_driver is assigned to, admin-set only
   * (db/migrations/20260806180000__ops_users_vehicle_assignment.sql) via
   * POST /api/ops/admin/users/:id/vehicle. Null means "not yet assigned" —
   * callers MUST NOT fall back to a client-supplied vehicleId when this is
   * null; that was the A01 gap this column closes.
   */
  vehicleId: string | null;
  createdAt: string;
}

export interface OpsInviteRecord {
  id: string;
  email: string;
  role: OpsRole;
  tokenHash: string;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  /** Optional vehicle assignment copied onto the new ops_users row by acceptInvite(). */
  vehicleId: string | null;
  createdAt: string;
}

export interface AuditEventInput {
  actorUserId: string;
  actorRole: OpsRole;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export interface DispatcherActionInput {
  dispatcherUserId: string;
  actionType: string;
  reason: string;
  routeDirectionId?: string | null;
  vehicleId?: string | null;
  incidentId?: string | null;
}

/**
 * How far this approval has got on its way to becoming a real command in the
 * control service (db/migrations/20260808110000__ops_dispatcher_action_dispatch.sql).
 * Strictly finer-grained than the queue's approved/rejected/pending triage,
 * which is still derived from consumed_at/rejected_at alone.
 */
export type DispatcherActionDispatchState = 'pending' | 'claimed' | 'dispatched' | 'failed' | 'rejected';

export interface DispatcherActionRecord {
  id: string;
  dispatcherUserId: string;
  actionType: string;
  reason: string;
  routeDirectionId: string | null;
  vehicleId: string | null;
  incidentId: string | null;
  consumedAt: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  createdAt: string;
  dispatchState: DispatcherActionDispatchState;
  claimedAt: string | null;
  claimedBy: string | null;
  /** control-service `commands.id` this approval authorized. The only durable web<->control link; null for a recorded 'override', which never reaches the control service. */
  controlServiceCommandId: string | null;
  controlServiceError: string | null;
  dispatchAttempts: number;
}

/** Derived triage state of a dispatcher action for the approval-queue UI. */
export type DispatcherActionDecisionState = 'pending' | 'approved' | 'rejected';

export function decisionStateOf(action: Pick<DispatcherActionRecord, 'consumedAt' | 'rejectedAt'>): DispatcherActionDecisionState {
  if (action.rejectedAt) return 'rejected';
  if (action.consumedAt) return 'approved';
  return 'pending';
}

/** The four disruptive action types this ticket's approval queue is scoped to (AC: "skip/short-turn/standby/boarding-limits"). */
export const DISRUPTIVE_ACTION_TYPES = ['stop_skip', 'short_turn', 'standby_injection', 'boarding_limit'] as const;
export type DisruptiveActionType = (typeof DISRUPTIVE_ACTION_TYPES)[number];

export function isDisruptiveActionType(actionType: string): actionType is DisruptiveActionType {
  return (DISRUPTIVE_ACTION_TYPES as readonly string[]).includes(actionType);
}

export interface KillSwitchRecord {
  id: string;
  scope: 'network' | 'route';
  routeDirectionId: string | null;
  engagedAt: string;
  engagedBy: string;
  reason: string;
  disengagedAt: string | null;
  disengagedBy: string | null;
  disengageReason: string | null;
}

export interface EngageKillSwitchInput {
  scope: 'network' | 'route';
  routeDirectionId?: string | null;
  engagedBy: string;
  reason: string;
}

export interface BreakdownReportInput {
  driverUserId: string;
  vehicleReg: string;
  category: string;
  description: string;
}

export interface BreakdownReportRecord {
  id: string;
  driverUserId: string;
  vehicleReg: string;
  category: string;
  description: string;
  createdAt: string;
}

/**
 * A breakdown report as read back for the fleet/driver GET surfaces —
 * BreakdownReportRecord plus the reporting driver's name/email (joined from
 * ops_users), which the POST path's caller never needs. Kept as its own
 * type rather than widening BreakdownReportRecord, so createBreakdownReport
 * stays a plain single-table insert with no join.
 */
export interface BreakdownReportListItem extends BreakdownReportRecord {
  reporterName: string;
  reporterEmail: string;
}

export interface BreakdownReportListFilter {
  /** Clamped to 1-200, same idiom as listDispatcherActions's limit. Defaults to 50. */
  limit?: number;
  /** ISO-8601 cursor: only reports created strictly before this instant. */
  before?: string;
  category?: string;
  vehicleReg?: string;
  /** Scopes to one driver's own reports (the "mine" GET surface). Omit for the fleet-wide view. */
  driverUserId?: string;
}

export interface BreakdownReportListPage {
  items: BreakdownReportListItem[];
  /** ISO-8601 createdAt of the last item, to pass back as `before` for the next page. Null when there is no next page. */
  nextCursor: string | null;
}

export interface OpsRepo {
  findUserByEmail(email: string): Promise<OpsUserRecord | null>;
  findUserById(id: string): Promise<OpsUserRecord | null>;
  listUsers(): Promise<OpsUserRecord[]>;
  disableUser(id: string, disabledBy: string): Promise<OpsUserRecord | null>;
  countAdmins(): Promise<number>;
  /**
   * Admin-only assignment of a driver/pilot_driver to a vehicle
   * (POST /api/ops/admin/users/:id/vehicle). Pass `null` to unassign.
   * Returns null if the user does not exist.
   */
  setUserVehicle(id: string, vehicleId: string | null): Promise<OpsUserRecord | null>;

  createInvite(input: {
    email: string;
    role: OpsRole;
    invitedBy: string;
    tokenHash: string;
    expiresAt: Date;
    vehicleId?: string | null;
  }): Promise<OpsInviteRecord>;
  findInviteByTokenHash(tokenHash: string): Promise<OpsInviteRecord | null>;
  findInviteById(id: string): Promise<OpsInviteRecord | null>;
  /** Invites not yet accepted or revoked (includes expired-but-unaccepted ones, so the admin can resend/rotate them). */
  listOutstandingInvites(): Promise<OpsInviteRecord[]>;
  /**
   * Rotates an invite's token/expiry for a resend (the raw token is never
   * persisted, so a resend cannot reuse the original one). Returns null if
   * the invite does not exist or is no longer pending (already
   * accepted/revoked) — callers must treat that as a 404/409, not retry.
   */
  regenerateInviteToken(input: {
    id: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<OpsInviteRecord | null>;
  /** Atomically consumes the invite and creates the user row. Throws if already consumed/expired/revoked. */
  acceptInvite(input: {
    tokenHash: string;
    name: string;
    passwordHash: string;
  }): Promise<OpsUserRecord>;

  /** Fails closed: throws if the write fails, never swallows an audit-write error. */
  recordAuditEvent(input: AuditEventInput): Promise<{ id: string; createdAt: string }>;

  createDispatcherAction(input: DispatcherActionInput): Promise<DispatcherActionRecord>;
  findDispatcherAction(id: string): Promise<DispatcherActionRecord | null>;
  /**
   * Atomically marks the action consumed IFF it was not already consumed.
   * Returns null if already consumed or missing.
   *
   * Retained unchanged, but NO LONGER the command path's authorization step —
   * see claimDispatcherAction for why an irreversible consume-before-dispatch
   * was unsafe. Still the right primitive for any flow where "approved" and
   * "done" are the same instant.
   */
  consumeDispatcherAction(id: string): Promise<DispatcherActionRecord | null>;

  /**
   * Phase 1 of the two-phase dispatch. Takes the action for ONE in-flight
   * attempt (dispatch_state -> 'claimed', dispatch_attempts + 1) while
   * deliberately leaving `consumed_at` NULL, so a failed attempt can be
   * released and retried instead of permanently burning a human approval —
   * which is exactly what the old consume-then-dispatch order did, with no
   * un-consume path anywhere in the codebase.
   *
   * Claimable when the action is neither consumed nor rejected AND is
   * 'pending', 'failed', or a 'claimed' whose claim is older than 2 minutes.
   * That last case makes a web process crashing between claim and dispatch
   * self-healing rather than needing a human. Reclaiming is safe precisely
   * because the mirrored uuid makes a re-dispatch idempotent: if the original
   * attempt actually reached the control service, the retry gets a 409
   * `dispatcher_action_already_used` and reconciles against the command that
   * already exists rather than creating a second one.
   *
   * Returns null when the action is not claimable — callers MUST treat that
   * as a refusal, never as "claim it anyway".
   */
  claimDispatcherAction(id: string, claimedBy: string): Promise<DispatcherActionRecord | null>;
  /**
   * Phase 2, success. Stamps `consumed_at` (so the approval queue reads
   * "approved" exactly as it always has) and records the control-service
   * command id, which is the only durable link between this approval and the
   * command it authorized. `commandId` is null for a recorded 'override',
   * which by design never reaches the control service.
   */
  markDispatcherActionDispatched(id: string, commandId: string | null): Promise<DispatcherActionRecord | null>;
  /**
   * Phase 2, failure. Records why and drops the claim, leaving `consumed_at`
   * NULL so the approval stays live and retryable. Only ever acts on a row
   * still in 'claimed', so it can never undo a dispatch that succeeded.
   */
  releaseDispatcherActionClaim(id: string, error: string): Promise<DispatcherActionRecord | null>;
  /** Atomically marks the action rejected IFF it was neither consumed nor already rejected. Returns null if either has already happened, or the id is missing. */
  rejectDispatcherAction(input: { id: string; rejectedBy: string; reason: string }): Promise<DispatcherActionRecord | null>;
  /**
   * The approval queue's backing list. `status` narrows to one decision
   * state ('pending' by default reads the live queue); omit it for the
   * full history a queue/timeline view needs. `incidentId` scopes to one
   * incident's decisions (incident timeline's "decision" stage).
   */
  listDispatcherActions(filter?: { status?: DispatcherActionDecisionState; incidentId?: string; limit?: number }): Promise<DispatcherActionRecord[]>;

  createBreakdownReport(input: BreakdownReportInput): Promise<BreakdownReportRecord>;
  /**
   * The fleet-wide and driver-own-history read surfaces backing GET
   * /api/ops/fleet/breakdown-reports and GET
   * /api/ops/driver/breakdown-reports. Keyset-paginated (`order by
   * created_at desc, id desc`, fetches `limit + 1` rows to determine
   * whether there is a next page) rather than offset-paginated, so pages
   * stay stable while new reports are filed concurrently. Pass
   * `driverUserId` to scope to one driver's own reports; omit it for the
   * fleet-wide view.
   */
  listBreakdownReports(filter?: BreakdownReportListFilter): Promise<BreakdownReportListPage>;

  /** Currently-active (not yet disengaged) kill switches, or every switch (including history) when `activeOnly` is false. */
  listKillSwitches(activeOnly?: boolean): Promise<KillSwitchRecord[]>;
  /** Every kill switch that would block a command with this scope right now: the network-wide one (if any) plus the route-scoped one for `routeDirectionId` (if given and one is active). */
  getActiveKillSwitches(routeDirectionId?: string | null): Promise<KillSwitchRecord[]>;
  /** Throws OpsKillSwitchConflictError if an active switch already exists for this exact scope key (DB-enforced via a partial unique index; this surfaces it as a typed error instead of a raw 23505). */
  engageKillSwitch(input: EngageKillSwitchInput): Promise<KillSwitchRecord>;
  /** Atomically marks the switch disengaged IFF it was still active. Returns null if already disengaged or missing. */
  disengageKillSwitch(input: { id: string; disengagedBy: string; reason: string }): Promise<KillSwitchRecord | null>;
}

/** Thrown by engageKillSwitch() when an active switch already exists for the requested scope (network, or this route-direction). */
export class OpsKillSwitchConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpsKillSwitchConflictError';
  }
}

function mapUserRow(row: Record<string, unknown>): OpsUserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: row.role as OpsRole,
    passwordHash: String(row.password_hash),
    status: row.status as 'active' | 'disabled',
    vehicleId: row.vehicle_id == null ? null : String(row.vehicle_id),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function mapInviteRow(row: Record<string, unknown>): OpsInviteRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    role: row.role as OpsRole,
    tokenHash: String(row.token_hash),
    invitedBy: String(row.invited_by),
    expiresAt: new Date(row.expires_at as string).toISOString(),
    acceptedAt: row.accepted_at ? new Date(row.accepted_at as string).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string).toISOString() : null,
    vehicleId: row.vehicle_id == null ? null : String(row.vehicle_id),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function mapDispatcherActionRow(row: Record<string, unknown>): DispatcherActionRecord {
  return {
    id: String(row.id),
    dispatcherUserId: String(row.dispatcher_user_id),
    actionType: String(row.action_type),
    reason: String(row.reason),
    routeDirectionId: row.route_direction_id ? String(row.route_direction_id) : null,
    vehicleId: row.vehicle_id ? String(row.vehicle_id) : null,
    incidentId: row.incident_id ? String(row.incident_id) : null,
    consumedAt: row.consumed_at ? new Date(row.consumed_at as string).toISOString() : null,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at as string).toISOString() : null,
    rejectedBy: row.rejected_by ? String(row.rejected_by) : null,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    createdAt: new Date(row.created_at as string).toISOString(),
    // Defaulted rather than asserted: a row read from a database where
    // 20260808110000__ops_dispatcher_action_dispatch.sql has not been applied
    // yet has no such columns, and 'pending'/0/null is exactly what that row
    // means operationally.
    dispatchState: (row.dispatch_state as DispatcherActionDispatchState | undefined) ?? 'pending',
    claimedAt: row.claimed_at ? new Date(row.claimed_at as string).toISOString() : null,
    claimedBy: row.claimed_by ? String(row.claimed_by) : null,
    controlServiceCommandId: row.control_service_command_id ? String(row.control_service_command_id) : null,
    controlServiceError: row.control_service_error ? String(row.control_service_error) : null,
    dispatchAttempts: Number(row.dispatch_attempts ?? 0),
  };
}

function mapKillSwitchRow(row: Record<string, unknown>): KillSwitchRecord {
  return {
    id: String(row.id),
    scope: row.scope as 'network' | 'route',
    routeDirectionId: row.route_direction_id ? String(row.route_direction_id) : null,
    engagedAt: new Date(row.engaged_at as string).toISOString(),
    engagedBy: String(row.engaged_by),
    reason: String(row.reason),
    disengagedAt: row.disengaged_at ? new Date(row.disengaged_at as string).toISOString() : null,
    disengagedBy: row.disengaged_by ? String(row.disengaged_by) : null,
    disengageReason: row.disengage_reason ? String(row.disengage_reason) : null,
  };
}

function mapBreakdownReportRow(row: Record<string, unknown>): BreakdownReportRecord {
  return {
    id: String(row.id),
    driverUserId: String(row.driver_user_id),
    vehicleReg: String(row.vehicle_reg),
    category: String(row.category),
    description: String(row.description),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function mapBreakdownReportListItemRow(row: Record<string, unknown>): BreakdownReportListItem {
  return {
    ...mapBreakdownReportRow(row),
    reporterName: String(row.reporter_name),
    reporterEmail: String(row.reporter_email),
  };
}

/** Thrown by acceptInvite() when the token is unknown, expired, revoked or already used. */
export class InviteNotAcceptableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteNotAcceptableError';
  }
}

class PgOpsRepo implements OpsRepo {
  async findUserByEmail(email: string): Promise<OpsUserRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      'select * from ops_users where lower(email) = lower($1) limit 1',
      [email],
    );
    return rows[0] ? mapUserRow(rows[0]) : null;
  }

  async findUserById(id: string): Promise<OpsUserRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query('select * from ops_users where id = $1 limit 1', [id]);
    return rows[0] ? mapUserRow(rows[0]) : null;
  }

  async listUsers(): Promise<OpsUserRecord[]> {
    const pool = getOpsPool();
    const { rows } = await pool.query('select * from ops_users order by created_at desc');
    return rows.map(mapUserRow);
  }

  async disableUser(id: string, disabledBy: string): Promise<OpsUserRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `update ops_users
         set status = 'disabled', disabled_at = now(), disabled_by = $2
       where id = $1
       returning *`,
      [id, disabledBy],
    );
    return rows[0] ? mapUserRow(rows[0]) : null;
  }

  async countAdmins(): Promise<number> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      "select count(*)::int as n from ops_users where role = 'admin' and status = 'active'",
    );
    return Number(rows[0]?.n ?? 0);
  }

  async setUserVehicle(id: string, vehicleId: string | null): Promise<OpsUserRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `update ops_users
          set vehicle_id = $2
        where id = $1
        returning *`,
      [id, vehicleId],
    );
    return rows[0] ? mapUserRow(rows[0]) : null;
  }

  async createInvite(input: {
    email: string;
    role: OpsRole;
    invitedBy: string;
    tokenHash: string;
    expiresAt: Date;
    vehicleId?: string | null;
  }): Promise<OpsInviteRecord> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `insert into ops_invites (email, role, invited_by, token_hash, expires_at, vehicle_id)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [
        input.email,
        input.role,
        input.invitedBy,
        input.tokenHash,
        input.expiresAt.toISOString(),
        input.vehicleId ?? null,
      ],
    );
    return mapInviteRow(rows[0]);
  }

  async findInviteByTokenHash(tokenHash: string): Promise<OpsInviteRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query('select * from ops_invites where token_hash = $1 limit 1', [
      tokenHash,
    ]);
    return rows[0] ? mapInviteRow(rows[0]) : null;
  }

  async findInviteById(id: string): Promise<OpsInviteRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query('select * from ops_invites where id = $1 limit 1', [id]);
    return rows[0] ? mapInviteRow(rows[0]) : null;
  }

  async listOutstandingInvites(): Promise<OpsInviteRecord[]> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `select * from ops_invites
        where accepted_at is null and revoked_at is null
        order by created_at desc`,
    );
    return rows.map(mapInviteRow);
  }

  async regenerateInviteToken(input: {
    id: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<OpsInviteRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `update ops_invites
          set token_hash = $2, expires_at = $3
        where id = $1 and accepted_at is null and revoked_at is null
        returning *`,
      [input.id, input.tokenHash, input.expiresAt.toISOString()],
    );
    return rows[0] ? mapInviteRow(rows[0]) : null;
  }

  async acceptInvite(input: {
    tokenHash: string;
    name: string;
    passwordHash: string;
  }): Promise<OpsUserRecord> {
    const pool = getOpsPool();
    const client = await pool.connect();
    try {
      await client.query('begin');

      const inviteResult = await client.query(
        `select * from ops_invites where token_hash = $1 for update`,
        [input.tokenHash],
      );
      const invite = inviteResult.rows[0];
      if (!invite) throw new InviteNotAcceptableError('Invite not found.');
      if (invite.accepted_at) throw new InviteNotAcceptableError('Invite already accepted.');
      if (invite.revoked_at) throw new InviteNotAcceptableError('Invite has been revoked.');
      if (new Date(invite.expires_at).getTime() <= Date.now()) {
        throw new InviteNotAcceptableError('Invite has expired.');
      }

      const userResult = await client.query(
        `insert into ops_users (email, name, role, password_hash, invite_id, created_by, vehicle_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning *`,
        [
          invite.email,
          input.name,
          invite.role,
          input.passwordHash,
          invite.id,
          invite.invited_by,
          invite.vehicle_id ?? null,
        ],
      );

      await client.query('update ops_invites set accepted_at = now() where id = $1', [invite.id]);

      await client.query('commit');
      return mapUserRow(userResult.rows[0]);
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordAuditEvent(input: AuditEventInput): Promise<{ id: string; createdAt: string }> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `insert into ops_audit_log (actor_user_id, actor_role, action, resource_type, resource_id, metadata, ip)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, created_at`,
      [
        input.actorUserId,
        input.actorRole,
        input.action,
        input.resourceType ?? null,
        input.resourceId ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.ip ?? null,
      ],
    );
    return { id: String(rows[0].id), createdAt: new Date(rows[0].created_at).toISOString() };
  }

  async createDispatcherAction(input: DispatcherActionInput): Promise<DispatcherActionRecord> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `insert into ops_dispatcher_actions
         (dispatcher_user_id, action_type, reason, route_direction_id, vehicle_id, incident_id)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [
        input.dispatcherUserId,
        input.actionType,
        input.reason,
        input.routeDirectionId ?? null,
        input.vehicleId ?? null,
        input.incidentId ?? null,
      ],
    );
    return mapDispatcherActionRow(rows[0]);
  }

  async findDispatcherAction(id: string): Promise<DispatcherActionRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      'select * from ops_dispatcher_actions where id = $1 limit 1',
      [id],
    );
    return rows[0] ? mapDispatcherActionRow(rows[0]) : null;
  }

  async consumeDispatcherAction(id: string): Promise<DispatcherActionRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `update ops_dispatcher_actions
         set consumed_at = now()
       where id = $1 and consumed_at is null and rejected_at is null
       returning *`,
      [id],
    );
    return rows[0] ? mapDispatcherActionRow(rows[0]) : null;
  }

  async claimDispatcherAction(id: string, claimedBy: string): Promise<DispatcherActionRecord | null> {
    const pool = getOpsPool();
    // One atomic statement, so two concurrent dispatch attempts cannot both
    // claim the same approval: the loser's UPDATE matches zero rows because
    // the winner already moved dispatch_state off its claimable value.
    const { rows } = await pool.query(
      `update ops_dispatcher_actions
          set dispatch_state = 'claimed',
              claimed_at = now(),
              claimed_by = $2,
              dispatch_attempts = dispatch_attempts + 1
        where id = $1
          and consumed_at is null
          and rejected_at is null
          and (
            dispatch_state = 'pending'
            or dispatch_state = 'failed'
            -- Stale-claim reclaim: a process that died mid-dispatch would
            -- otherwise wedge this approval forever. Safe because the
            -- mirrored uuid makes a re-dispatch a no-op if the original
            -- attempt actually landed.
            or (dispatch_state = 'claimed' and claimed_at < now() - interval '2 minutes')
          )
        returning *`,
      [id, claimedBy],
    );
    return rows[0] ? mapDispatcherActionRow(rows[0]) : null;
  }

  async markDispatcherActionDispatched(id: string, commandId: string | null): Promise<DispatcherActionRecord | null> {
    const pool = getOpsPool();
    // coalesce(consumed_at, now()) so a reconciled retry (control had already
    // created the command; this app is only now recording that) does not
    // rewrite the original approval timestamp.
    const { rows } = await pool.query(
      `update ops_dispatcher_actions
          set dispatch_state = 'dispatched',
              consumed_at = coalesce(consumed_at, now()),
              control_service_command_id = $2,
              control_service_error = null
        where id = $1
        returning *`,
      [id, commandId],
    );
    return rows[0] ? mapDispatcherActionRow(rows[0]) : null;
  }

  async releaseDispatcherActionClaim(id: string, error: string): Promise<DispatcherActionRecord | null> {
    const pool = getOpsPool();
    // `and dispatch_state = 'claimed'` is the safety clause: a late release
    // (e.g. from a request that timed out locally after the dispatch had in
    // fact succeeded) can never walk a 'dispatched' row back to 'failed' and
    // invite a duplicate command.
    const { rows } = await pool.query(
      `update ops_dispatcher_actions
          set dispatch_state = 'failed',
              control_service_error = $2,
              claimed_by = null
        where id = $1 and dispatch_state = 'claimed'
        returning *`,
      [id, error.slice(0, 2000)],
    );
    return rows[0] ? mapDispatcherActionRow(rows[0]) : null;
  }

  async rejectDispatcherAction(input: { id: string; rejectedBy: string; reason: string }): Promise<DispatcherActionRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `update ops_dispatcher_actions
         set rejected_at = now(), rejected_by = $2, rejection_reason = $3
       where id = $1 and consumed_at is null and rejected_at is null
       returning *`,
      [input.id, input.rejectedBy, input.reason],
    );
    return rows[0] ? mapDispatcherActionRow(rows[0]) : null;
  }

  async listDispatcherActions(filter: { status?: DispatcherActionDecisionState; incidentId?: string; limit?: number } = {}): Promise<DispatcherActionRecord[]> {
    const pool = getOpsPool();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.status === 'pending') {
      conditions.push('consumed_at is null and rejected_at is null');
    } else if (filter.status === 'approved') {
      conditions.push('consumed_at is not null');
    } else if (filter.status === 'rejected') {
      conditions.push('rejected_at is not null');
    }

    if (filter.incidentId) {
      params.push(filter.incidentId);
      conditions.push(`incident_id = $${params.length}`);
    }

    const rawLimit = filter.limit ?? 100;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500) : 100;
    params.push(limit);
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
    const { rows } = await pool.query(
      `select * from ops_dispatcher_actions ${where} order by created_at desc limit $${params.length}`,
      params,
    );
    return rows.map(mapDispatcherActionRow);
  }

  async createBreakdownReport(input: BreakdownReportInput): Promise<BreakdownReportRecord> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `insert into ops_breakdown_reports
         (driver_user_id, vehicle_reg, category, description)
       values ($1, $2, $3, $4)
       returning *`,
      [input.driverUserId, input.vehicleReg, input.category, input.description],
    );
    return mapBreakdownReportRow(rows[0]);
  }

  async listBreakdownReports(filter: BreakdownReportListFilter = {}): Promise<BreakdownReportListPage> {
    const pool = getOpsPool();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.driverUserId) {
      params.push(filter.driverUserId);
      conditions.push(`r.driver_user_id = $${params.length}`);
    }
    if (filter.category) {
      params.push(filter.category);
      conditions.push(`r.category = $${params.length}`);
    }
    if (filter.vehicleReg) {
      params.push(filter.vehicleReg);
      conditions.push(`r.vehicle_reg = $${params.length}`);
    }
    if (filter.before) {
      params.push(filter.before);
      conditions.push(`r.created_at < $${params.length}`);
    }

    const rawLimit = filter.limit ?? 50;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 50;
    // Fetch one extra row to determine whether there is a next page without a separate count query.
    params.push(limit + 1);

    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
    const { rows } = await pool.query(
      `select r.*, u.name as reporter_name, u.email as reporter_email
         from ops_breakdown_reports r
         join ops_users u on u.id = r.driver_user_id
         ${where}
        order by r.created_at desc, r.id desc
        limit $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map(mapBreakdownReportListItemRow);

    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.createdAt ?? null) : null,
    };
  }

  async listKillSwitches(activeOnly = true): Promise<KillSwitchRecord[]> {
    const pool = getOpsPool();
    const where = activeOnly ? 'where disengaged_at is null' : '';
    const { rows } = await pool.query(
      `select * from ops_kill_switches ${where} order by engaged_at desc`,
    );
    return rows.map(mapKillSwitchRow);
  }

  async getActiveKillSwitches(routeDirectionId?: string | null): Promise<KillSwitchRecord[]> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `select * from ops_kill_switches
        where disengaged_at is null
          and (scope = 'network' or (scope = 'route' and route_direction_id = $1))`,
      [routeDirectionId ?? null],
    );
    return rows.map(mapKillSwitchRow);
  }

  async engageKillSwitch(input: EngageKillSwitchInput): Promise<KillSwitchRecord> {
    const pool = getOpsPool();
    try {
      const { rows } = await pool.query(
        `insert into ops_kill_switches (scope, route_direction_id, engaged_by, reason)
         values ($1, $2, $3, $4)
         returning *`,
        [input.scope, input.scope === 'route' ? (input.routeDirectionId ?? null) : null, input.engagedBy, input.reason],
      );
      return mapKillSwitchRow(rows[0]);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505') {
        throw new OpsKillSwitchConflictError(
          input.scope === 'network'
            ? 'A network-wide kill switch is already engaged.'
            : `A kill switch is already engaged for route-direction ${input.routeDirectionId ?? ''}.`,
        );
      }
      throw error;
    }
  }

  async disengageKillSwitch(input: { id: string; disengagedBy: string; reason: string }): Promise<KillSwitchRecord | null> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `update ops_kill_switches
         set disengaged_at = now(), disengaged_by = $2, disengage_reason = $3
       where id = $1 and disengaged_at is null
       returning *`,
      [input.id, input.disengagedBy, input.reason],
    );
    return rows[0] ? mapKillSwitchRow(rows[0]) : null;
  }
}

let repo: OpsRepo | null = null;

/** The Postgres-backed repo, lazily constructed. Route handlers use this. */
export function getOpsRepo(): OpsRepo {
  if (!repo) repo = new PgOpsRepo();
  return repo;
}
