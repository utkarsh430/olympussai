// War-room incident list + review (ticket AC3: "lists the day's incidents
// (eligible/exogenous/structural) with action and outcome"). Joins
// bunching_incidents (the detection system's own record) with
// war_room_incident_reviews (the war-room's classification/action/outcome,
// this module's write path) and outcomes (the system-measured result,
// where one exists) so the dashboard shows both what the reviewer decided
// and what was actually measured.
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import type { SubmitIncidentReviewRequest } from '../models/pilotSchemas.js';

export interface WarRoomIncidentRow {
  incidentId: string;
  routeDirectionId: string;
  severity: string;
  causeClass: string;
  controllability: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  // Review fields — null until the war room has reviewed the incident.
  classification: string | null;
  actionTaken: string | null;
  reviewOutcome: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  // Measured outcome, when POST-recorded via the outcomes table (may not
  // exist yet for a recently opened incident).
  measuredCompliance: string | null;
  measuredRecoverySeconds: number | null;
  measuredGuardrailEvents: Record<string, unknown>[];
}

interface RawWarRoomIncidentRow {
  incident_id: string;
  route_direction_id: string;
  severity: string;
  cause_class: string;
  controllability: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  classification: string | null;
  action_taken: string | null;
  review_outcome: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  measured_compliance: string | null;
  measured_recovery_seconds: string | null;
  measured_guardrail_events: Record<string, unknown>[] | null;
}

function mapRow(row: RawWarRoomIncidentRow): WarRoomIncidentRow {
  return {
    incidentId: row.incident_id,
    routeDirectionId: row.route_direction_id,
    severity: row.severity,
    causeClass: row.cause_class,
    controllability: row.controllability,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    classification: row.classification,
    actionTaken: row.action_taken,
    reviewOutcome: row.review_outcome,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    measuredCompliance: row.measured_compliance,
    measuredRecoverySeconds: row.measured_recovery_seconds === null ? null : Number(row.measured_recovery_seconds),
    measuredGuardrailEvents: row.measured_guardrail_events ?? [],
  };
}

/** `date` is a YYYY-MM-DD calendar day (UTC) — defaults to today. Lists every incident that STARTED that day, regardless of whether it has since closed, which is what a war-room reviewing "the day's incidents" wants. */
export async function listWarRoomIncidents(
  options: { date?: string; routeDirectionId?: string } = {},
  pool: Pool = getPool(),
): Promise<WarRoomIncidentRow[]> {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const params: unknown[] = [date];
  let routeFilter = '';
  if (options.routeDirectionId) {
    params.push(options.routeDirectionId);
    routeFilter = `and bi.route_direction_id = $${params.length}`;
  }

  const { rows } = await pool.query<RawWarRoomIncidentRow>(
    `select bi.id as incident_id, bi.route_direction_id, bi.severity, bi.cause_class, bi.controllability,
            bi.status, bi.started_at, bi.ended_at,
            wr.classification, wr.action_taken, wr.outcome as review_outcome, wr.reviewed_by, wr.reviewed_at,
            o.compliance as measured_compliance, o.recovery_seconds as measured_recovery_seconds,
            o.guardrail_events as measured_guardrail_events
       from bunching_incidents bi
       left join war_room_incident_reviews wr on wr.incident_id = bi.id
       left join outcomes o on o.incident_id = bi.id
      where bi.started_at::date = $1::date
        ${routeFilter}
      order by bi.started_at desc`,
    params,
  );
  return rows.map(mapRow);
}

export async function submitIncidentReview(
  incidentId: string,
  input: SubmitIncidentReviewRequest,
  pool: Pool = getPool(),
): Promise<WarRoomIncidentRow> {
  const { rows: incidentRows } = await pool.query<{ id: string }>(
    `select id from bunching_incidents where id = $1`,
    [incidentId],
  );
  if (!incidentRows[0]) {
    throw new AppError('incident_not_found', `bunching incident ${incidentId} not found`, 404);
  }

  await pool.query(
    `insert into war_room_incident_reviews (incident_id, classification, action_taken, outcome, reviewed_by, reviewed_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (incident_id)
     do update set classification = excluded.classification, action_taken = excluded.action_taken,
                   outcome = excluded.outcome, reviewed_by = excluded.reviewed_by, reviewed_at = now()`,
    [incidentId, input.classification, input.actionTaken ?? null, input.outcome ?? null, input.reviewedBy],
  );

  const { rows } = await pool.query<RawWarRoomIncidentRow>(
    `select bi.id as incident_id, bi.route_direction_id, bi.severity, bi.cause_class, bi.controllability,
            bi.status, bi.started_at, bi.ended_at,
            wr.classification, wr.action_taken, wr.outcome as review_outcome, wr.reviewed_by, wr.reviewed_at,
            o.compliance as measured_compliance, o.recovery_seconds as measured_recovery_seconds,
            o.guardrail_events as measured_guardrail_events
       from bunching_incidents bi
       left join war_room_incident_reviews wr on wr.incident_id = bi.id
       left join outcomes o on o.incident_id = bi.id
      where bi.id = $1`,
    [incidentId],
  );
  return mapRow(rows[0]!);
}
