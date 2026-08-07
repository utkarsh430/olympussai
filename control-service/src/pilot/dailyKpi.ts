// Daily KPI snapshot: EWT, CV, recovery rate, guardrail breaches, and
// compliance per route-direction per day (ticket AC2). Computed on demand
// from that day's raw rows and upserted into daily_kpi_snapshots so a past
// day's numbers stop moving once the day is over, while today's row keeps
// refreshing on every read — same "recompute on read, cache the result"
// shape as the web app's src/lib/controlService/observabilityData.ts.
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import { computeAggregate } from '../headway/metrics.js';
import type { HeadwayPairMetric } from '../headway/types.js';
import { listRolloutStages } from './rolloutStages.js';

export interface DailyKpiSnapshot {
  routeDirectionId: string;
  publicName: string;
  directionCode: string;
  snapshotDate: string;
  sampleCount: number;
  meanHeadwaySeconds: number | null;
  ewtSeconds: number | null;
  cv: number | null;
  incidentCount: number;
  recoveredIncidentCount: number;
  recoveryRate: number | null;
  guardrailBreachCount: number;
  complianceSampleCount: number;
  compliancePct: number | null;
  computedAt: string;
}

interface RawSnapshotRow {
  route_direction_id: string;
  public_name: string;
  direction_code: string;
  snapshot_date: string;
  sample_count: number;
  mean_headway_seconds: string | null;
  ewt_seconds: string | null;
  cv: string | null;
  incident_count: number;
  recovered_incident_count: number;
  recovery_rate: string | null;
  guardrail_breach_count: number;
  compliance_sample_count: number;
  compliance_pct: string | null;
  computed_at: string;
}

function mapRow(row: RawSnapshotRow): DailyKpiSnapshot {
  const num = (v: string | null) => (v === null ? null : Number(v));
  return {
    routeDirectionId: row.route_direction_id,
    publicName: row.public_name,
    directionCode: row.direction_code,
    snapshotDate: row.snapshot_date,
    sampleCount: row.sample_count,
    meanHeadwaySeconds: num(row.mean_headway_seconds),
    ewtSeconds: num(row.ewt_seconds),
    cv: num(row.cv),
    incidentCount: row.incident_count,
    recoveredIncidentCount: row.recovered_incident_count,
    recoveryRate: num(row.recovery_rate),
    guardrailBreachCount: row.guardrail_breach_count,
    complianceSampleCount: row.compliance_sample_count,
    compliancePct: num(row.compliance_pct),
    computedAt: row.computed_at,
  };
}

/**
 * Computes one route-direction's KPI snapshot for `date` (YYYY-MM-DD,
 * UTC calendar day) from raw rows and upserts it into daily_kpi_snapshots.
 * CV/EWT reuse headway/metrics.ts#computeAggregate — the same formula the
 * live observability dashboard uses — over that day's headway_states
 * forward-headway samples, so the two views can never silently diverge on
 * methodology.
 */
export async function computeDailyKpiSnapshot(
  routeDirectionId: string,
  date: string,
  pool: Pool = getPool(),
): Promise<void> {
  const { rows: headwayRows } = await pool.query<{ h_fwd_seconds: string | null; target_headway_seconds: string }>(
    `select h_fwd_seconds, target_headway_seconds
       from headway_states
      where route_direction_id = $1 and computed_at::date = $2::date`,
    [routeDirectionId, date],
  );
  const targetHeadwaySeconds = headwayRows.length > 0 ? Number(headwayRows[0]!.target_headway_seconds) : 0;
  const pairs: HeadwayPairMetric[] = headwayRows.map((r) => ({
    routeDirectionId,
    leaderVehicleId: '',
    followerVehicleId: '',
    gapMeters: 0,
    hFwdSeconds: r.h_fwd_seconds === null ? null : Number(r.h_fwd_seconds),
    hBwdSeconds: null,
    targetHeadwaySeconds,
    deviationSeconds: null,
    confidence: null,
  }));
  const aggregate =
    targetHeadwaySeconds > 0
      ? computeAggregate(pairs, routeDirectionId, targetHeadwaySeconds)
      : { sampleCount: 0, meanHeadwaySeconds: null, cv: null, ewtSeconds: null };

  const { rows: incidentRows } = await pool.query<{ status: string }>(
    `select status from bunching_incidents where route_direction_id = $1 and started_at::date = $2::date`,
    [routeDirectionId, date],
  );
  const incidentCount = incidentRows.length;
  const recoveredIncidentCount = incidentRows.filter((r) => r.status === 'closed').length;
  const recoveryRate = incidentCount > 0 ? recoveredIncidentCount / incidentCount : null;

  const { rows: breachRows } = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from guardrail_breach_log
      where route_direction_id = $1 and detected_at::date = $2::date`,
    [routeDirectionId, date],
  );
  const guardrailBreachCount = Number(breachRows[0]?.count ?? '0');

  const { rows: complianceRows } = await pool.query<{ compliance: string | null }>(
    `select o.compliance
       from outcomes o
       join bunching_incidents bi on bi.id = o.incident_id
      where bi.route_direction_id = $1 and bi.started_at::date = $2::date and o.compliance is not null`,
    [routeDirectionId, date],
  );
  const complianceSampleCount = complianceRows.length;
  const compliedCount = complianceRows.filter((r) => r.compliance === 'complied').length;
  const compliancePct = complianceSampleCount > 0 ? compliedCount / complianceSampleCount : null;

  await pool.query(
    `insert into daily_kpi_snapshots
       (route_direction_id, snapshot_date, sample_count, mean_headway_seconds, ewt_seconds, cv,
        incident_count, recovered_incident_count, recovery_rate, guardrail_breach_count,
        compliance_sample_count, compliance_pct, computed_at)
     values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
     on conflict (route_direction_id, snapshot_date)
     do update set sample_count = excluded.sample_count, mean_headway_seconds = excluded.mean_headway_seconds,
                   ewt_seconds = excluded.ewt_seconds, cv = excluded.cv, incident_count = excluded.incident_count,
                   recovered_incident_count = excluded.recovered_incident_count, recovery_rate = excluded.recovery_rate,
                   guardrail_breach_count = excluded.guardrail_breach_count,
                   compliance_sample_count = excluded.compliance_sample_count, compliance_pct = excluded.compliance_pct,
                   computed_at = now()`,
    [
      routeDirectionId,
      date,
      aggregate.sampleCount,
      aggregate.meanHeadwaySeconds,
      aggregate.ewtSeconds,
      aggregate.cv,
      incidentCount,
      recoveredIncidentCount,
      recoveryRate,
      guardrailBreachCount,
      complianceSampleCount,
      compliancePct,
    ],
  );
}

/**
 * Lists (recomputing first) the KPI snapshot for `date` (defaults to
 * today, UTC) across every active route-direction, or just
 * `routeDirectionId` when given.
 */
export async function listDailyKpiSnapshots(
  options: { date?: string; routeDirectionId?: string } = {},
  pool: Pool = getPool(),
): Promise<DailyKpiSnapshot[]> {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const stages = await listRolloutStages(pool);
  const targets = options.routeDirectionId
    ? stages.filter((s) => s.routeDirectionId === options.routeDirectionId)
    : stages;

  for (const target of targets) {
    await computeDailyKpiSnapshot(target.routeDirectionId, date, pool);
  }

  const params: unknown[] = [date];
  let routeFilter = '';
  if (options.routeDirectionId) {
    params.push(options.routeDirectionId);
    routeFilter = `and k.route_direction_id = $${params.length}`;
  }

  const { rows } = await pool.query<RawSnapshotRow>(
    `select k.route_direction_id, r.public_name, rd.direction_code, k.snapshot_date::text as snapshot_date,
            k.sample_count, k.mean_headway_seconds, k.ewt_seconds, k.cv, k.incident_count,
            k.recovered_incident_count, k.recovery_rate, k.guardrail_breach_count,
            k.compliance_sample_count, k.compliance_pct, k.computed_at
       from daily_kpi_snapshots k
       join route_directions rd on rd.id = k.route_direction_id
       join routes r on r.id = rd.route_id
      where k.snapshot_date = $1::date
        ${routeFilter}
      order by r.public_name, rd.direction_code`,
    params,
  );
  return rows.map(mapRow);
}
