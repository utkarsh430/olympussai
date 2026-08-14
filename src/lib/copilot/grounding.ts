/**
 * Read-only evidence gathering for the copilot module. Every function here
 * is a SELECT (against the control service's REST API, read-only, or this
 * app's own ops datastore) — nothing in this file writes to
 * bunching_incidents, commands, dispatcher_actions, or any table owned by
 * the command-creation/approval path, and nothing here imports
 * src/lib/auth/rbac/repo.ts (which is where consumeDispatcherAction /
 * createDispatcherAction live). See src/lib/copilot/service.ts's doc
 * comment for the module-wide boundary this maintains
 * (docs/olympuss/COPILOT.md, ticket AC "No code path in the copilot module
 * can call the command-creation/approval service") and
 * src/tests/unit/copilotBoundary.test.ts, which asserts it by scanning this
 * module's source for forbidden imports.
 */
import 'server-only';
import { getOpsPool } from '@/lib/db/pool';
import { fetchControlService, ControlServiceConfigError } from '@/lib/controlService/client';
import { incidentsResponseSchema, type BunchingIncident } from '@/models/control';

/**
 * A grounding fetch bounded to `items.length` records, plus the true
 * `totalCount` of records that matched before any limit was applied.
 * `totalCount > items.length` means the model is being shown a slice, not
 * the full evidence set - every prompt-building caller must be able to
 * tell the difference so the copilot can say so rather than reasoning over
 * a fraction of the evidence while sounding comprehensive about all of it.
 */
export interface GroundingSlice<T> {
  items: T[];
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Control-service incidents (read-only GET /v1/incidents)
// ---------------------------------------------------------------------------

/**
 * Open (non-closed) bunching incidents, optionally scoped to one
 * route-direction. The control service exposes no "closed incident" lookup
 * yet among currently-open incidents - grounding is therefore limited to
 * what is currently open, which the copilot always states plainly rather
 * than implying it searched a fuller history it does not have access to.
 *
 * `limit`, when given, is clamped the same way listAuditEventsForGrounding /
 * listBreakdownReportsForGrounding clamp theirs (1-100) and passed to the
 * control service so the network fetch itself - not just the prompt built
 * from it - stays bounded; the live network has grown to 19k+ open
 * incidents (12+MB unbounded), which is what previously blew the Claude
 * CLI's 10MB stdin cap. Omit `limit` to get every open incident, which
 * findOpenIncidentById below relies on so a lookup by id is never missed
 * just because the incident isn't among the most recent N.
 */
export async function listOpenIncidentsForGrounding(
  routeDirectionId?: string,
  limit?: number,
): Promise<GroundingSlice<BunchingIncident>> {
  const clampedLimit = limit === undefined ? undefined : Math.min(Math.max(limit, 1), 100);
  const raw = await fetchControlService('/v1/incidents', {
    query: { routeDirectionId, limit: clampedLimit === undefined ? undefined : String(clampedLimit) },
  });
  const { incidents, totalOpenCount } = incidentsResponseSchema.parse(raw);
  return { items: incidents, totalCount: totalOpenCount ?? incidents.length };
}

export interface IncidentLookupResult {
  incident: BunchingIncident | null;
  /** True when the control service itself was unreachable/misconfigured, as opposed to a genuine "not found". */
  controlServiceUnavailable: boolean;
  unavailableReason: string | null;
}

/** Finds one open incident by id. Returns incident: null (not an error) if it is not currently open — e.g. already closed, or never existed. */
export async function findOpenIncidentById(
  incidentId: string,
  routeDirectionId?: string,
): Promise<IncidentLookupResult> {
  try {
    // Deliberately unbounded (no limit passed): this needs to find ONE
    // specific incident wherever it falls in the open set, not just among
    // the most recent slice a bounded caller would ask for.
    const { items: incidents } = await listOpenIncidentsForGrounding(routeDirectionId);
    return {
      incident: incidents.find((incident) => incident.id === incidentId) ?? null,
      controlServiceUnavailable: false,
      unavailableReason: null,
    };
  } catch (error) {
    const reason = error instanceof ControlServiceConfigError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Unknown control service error';
    return { incident: null, controlServiceUnavailable: true, unavailableReason: reason };
  }
}

// ---------------------------------------------------------------------------
// This app's own ops audit trail (read-only SELECT against ops_audit_log /
// ops_breakdown_reports — never ops_dispatcher_actions' consume path, and
// this module never writes to either table).
// ---------------------------------------------------------------------------

export interface AuditEventForGrounding {
  id: string;
  actorRole: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEventQuery {
  since?: Date;
  until?: Date;
  limit?: number;
}

/**
 * Builds the shared `where`/params prefix for the two ops-table grounding
 * queries below, so the row select and its companion `count(*)` (used to
 * report the true total behind a limited slice) stay in exact sync.
 */
function buildSinceUntilFilter(query: AuditEventQuery): { whereClause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.since) {
    params.push(query.since.toISOString());
    conditions.push(`created_at >= $${params.length}`);
  }
  if (query.until) {
    params.push(query.until.toISOString());
    conditions.push(`created_at <= $${params.length}`);
  }
  return { whereClause: conditions.length > 0 ? `where ${conditions.join(' and ')}` : '', params };
}

/** Recent ops_audit_log rows, most recent first. Read-only: `select` only, never referenced by any write path in this module. */
export async function listAuditEventsForGrounding(
  query: AuditEventQuery = {},
): Promise<GroundingSlice<AuditEventForGrounding>> {
  const pool = getOpsPool();
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const { whereClause, params } = buildSinceUntilFilter(query);

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `select id, actor_role, action, resource_type, resource_id, metadata, created_at
         from ops_audit_log
         ${whereClause}
        order by created_at desc
        limit $${params.length + 1}`,
      [...params, limit],
    ),
    pool.query(`select count(*)::text as count from ops_audit_log ${whereClause}`, params),
  ]);

  const items = rows.map((row) => ({
    id: String(row.id),
    actorRole: String(row.actor_role),
    action: String(row.action),
    resourceType: row.resource_type ? String(row.resource_type) : null,
    resourceId: row.resource_id ? String(row.resource_id) : null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string).toISOString(),
  }));
  return { items, totalCount: Number(countRows[0]?.count ?? items.length) };
}

export interface BreakdownReportForGrounding {
  id: string;
  vehicleReg: string;
  category: string;
  description: string;
  createdAt: string;
}

/** Recent ops_breakdown_reports rows, most recent first. Read-only, same rule as listAuditEventsForGrounding. */
export async function listBreakdownReportsForGrounding(
  query: AuditEventQuery = {},
): Promise<GroundingSlice<BreakdownReportForGrounding>> {
  const pool = getOpsPool();
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const { whereClause, params } = buildSinceUntilFilter(query);

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `select id, vehicle_reg, category, description, created_at
         from ops_breakdown_reports
         ${whereClause}
        order by created_at desc
        limit $${params.length + 1}`,
      [...params, limit],
    ),
    pool.query(`select count(*)::text as count from ops_breakdown_reports ${whereClause}`, params),
  ]);

  const items = rows.map((row) => ({
    id: String(row.id),
    vehicleReg: String(row.vehicle_reg),
    category: String(row.category),
    description: String(row.description),
    createdAt: new Date(row.created_at as string).toISOString(),
  }));
  return { items, totalCount: Number(countRows[0]?.count ?? items.length) };
}
