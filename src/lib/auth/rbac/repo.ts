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

export interface DispatcherActionRecord {
  id: string;
  dispatcherUserId: string;
  actionType: string;
  reason: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface OpsRepo {
  findUserByEmail(email: string): Promise<OpsUserRecord | null>;
  findUserById(id: string): Promise<OpsUserRecord | null>;
  listUsers(): Promise<OpsUserRecord[]>;
  disableUser(id: string, disabledBy: string): Promise<OpsUserRecord | null>;
  countAdmins(): Promise<number>;

  createInvite(input: {
    email: string;
    role: OpsRole;
    invitedBy: string;
    tokenHash: string;
    expiresAt: Date;
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
  /** Atomically marks the action consumed IFF it was not already consumed. Returns null if already consumed or missing. */
  consumeDispatcherAction(id: string): Promise<DispatcherActionRecord | null>;
}

function mapUserRow(row: Record<string, unknown>): OpsUserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: row.role as OpsRole,
    passwordHash: String(row.password_hash),
    status: row.status as 'active' | 'disabled',
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
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function mapDispatcherActionRow(row: Record<string, unknown>): DispatcherActionRecord {
  return {
    id: String(row.id),
    dispatcherUserId: String(row.dispatcher_user_id),
    actionType: String(row.action_type),
    reason: String(row.reason),
    consumedAt: row.consumed_at ? new Date(row.consumed_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
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

  async createInvite(input: {
    email: string;
    role: OpsRole;
    invitedBy: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<OpsInviteRecord> {
    const pool = getOpsPool();
    const { rows } = await pool.query(
      `insert into ops_invites (email, role, invited_by, token_hash, expires_at)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [input.email, input.role, input.invitedBy, input.tokenHash, input.expiresAt.toISOString()],
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
        `insert into ops_users (email, name, role, password_hash, invite_id, created_by)
         values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [invite.email, input.name, invite.role, input.passwordHash, invite.id, invite.invited_by],
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
       where id = $1 and consumed_at is null
       returning *`,
      [id],
    );
    return rows[0] ? mapDispatcherActionRow(rows[0]) : null;
  }
}

let repo: OpsRepo | null = null;

/** The Postgres-backed repo, lazily constructed. Route handlers use this. */
export function getOpsRepo(): OpsRepo {
  if (!repo) repo = new PgOpsRepo();
  return repo;
}
