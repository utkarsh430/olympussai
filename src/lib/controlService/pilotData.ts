import 'server-only';

/**
 * Server-only data source for the pilot-staging dashboard: rollout stages,
 * daily KPI snapshots, guardrail breaches, and war-room incidents. Same
 * fallback shape as src/lib/controlService/observabilityData.ts — fresh
 * control-service response -> last-known-good cached response (flagged
 * stale) -> an explicit "control service unavailable" state
 * (docs/CONTROL_SERVICE_INTEGRATION.md §2 fallback ladder) — so the
 * dashboard never renders blank just because one poll failed.
 *
 * Mutations (setRolloutStage, submitIncidentReview) are NOT cached and
 * always call through live; they're invoked from the ops API routes below
 * this app's own admin/control_room role guards, never directly from a
 * page render.
 */
import {
  ControlServiceConfigError,
  fetchControlService,
} from './client';
import {
  rolloutStagesResponseSchema,
  rolloutStageResponseSchema,
  rolloutStageAuditResponseSchema,
  guardrailBreachesResponseSchema,
  dailyKpiResponseSchema,
  warRoomIncidentsResponseSchema,
  warRoomIncidentReviewResponseSchema,
  type RolloutStageRow,
  type RolloutStageAuditEntry,
  type GuardrailBreach,
  type DailyKpiSnapshot,
  type WarRoomIncident,
  type SetRolloutStageRequest,
  type SubmitIncidentReviewRequest,
} from '@/models/control';
import { TtlCache } from '@/lib/upsrtc/cache';

const CACHE_TTL_MS = 10_000;
const rolloutStagesCache = new TtlCache<PilotSnapshot<RolloutStageRow[]>>(CACHE_TTL_MS);
const dailyKpiCache = new TtlCache<PilotSnapshot<DailyKpiSnapshot[]>>(CACHE_TTL_MS);
const warRoomCache = new TtlCache<PilotSnapshot<WarRoomIncident[]>>(CACHE_TTL_MS);
const guardrailBreachCache = new TtlCache<PilotSnapshot<GuardrailBreach[]>>(5_000);

export interface PilotSnapshot<T> {
  source: 'live' | 'unavailable';
  stale: boolean;
  error: string | null;
  fetchedAt: string;
  data: T;
}

function unavailableSnapshot<T>(cache: TtlCache<PilotSnapshot<T>>, key: string, reason: string, now: number, empty: T): PilotSnapshot<T> {
  const lastGood = cache.getLastGood(key);
  if (lastGood) {
    return { ...lastGood.value, source: 'unavailable', stale: true, error: reason, fetchedAt: new Date(now).toISOString() };
  }
  return { source: 'unavailable', stale: true, error: reason, fetchedAt: new Date(now).toISOString(), data: empty };
}

function messageFor(cause: unknown): string {
  return cause instanceof ControlServiceConfigError
    ? cause.message
    : cause instanceof Error
      ? cause.message
      : 'Unknown control service error';
}

export async function getRolloutStages(now: number = Date.now()): Promise<PilotSnapshot<RolloutStageRow[]>> {
  try {
    const raw = await fetchControlService('/v1/rollout-stages');
    const { rolloutStages } = rolloutStagesResponseSchema.parse(raw);
    const snapshot: PilotSnapshot<RolloutStageRow[]> = {
      source: 'live',
      stale: false,
      error: null,
      fetchedAt: new Date(now).toISOString(),
      data: rolloutStages,
    };
    rolloutStagesCache.set('rollout-stages', snapshot, now);
    return snapshot;
  } catch (cause) {
    return unavailableSnapshot(rolloutStagesCache, 'rollout-stages', messageFor(cause), now, []);
  }
}

export async function getRolloutStageAudit(routeDirectionId: string): Promise<RolloutStageAuditEntry[]> {
  const raw = await fetchControlService(`/v1/route-directions/${encodeURIComponent(routeDirectionId)}/rollout-stage/audit`);
  return rolloutStageAuditResponseSchema.parse(raw).auditLog;
}

/**
 * Admin write path (ticket AC1). `changedBy` is always the caller's own
 * authenticated identity, resolved server-side by the ops API route
 * before this is called — never taken from client input.
 */
export async function setRolloutStage(
  routeDirectionId: string,
  changedBy: string,
  input: SetRolloutStageRequest,
): Promise<RolloutStageRow> {
  const raw = await fetchControlService(`/v1/route-directions/${encodeURIComponent(routeDirectionId)}/rollout-stage`, {
    method: 'PUT',
    body: { stage: input.stage, changedBy, reason: input.reason ?? null },
  });
  return rolloutStageResponseSchema.parse(raw).rolloutStage;
}

export async function getGuardrailBreaches(
  routeDirectionId?: string,
  now: number = Date.now(),
): Promise<PilotSnapshot<GuardrailBreach[]>> {
  const key = routeDirectionId ?? 'all';
  try {
    const raw = await fetchControlService('/v1/guardrail-breaches', { query: { routeDirectionId } });
    const { breaches } = guardrailBreachesResponseSchema.parse(raw);
    const snapshot: PilotSnapshot<GuardrailBreach[]> = {
      source: 'live',
      stale: false,
      error: null,
      fetchedAt: new Date(now).toISOString(),
      data: breaches,
    };
    guardrailBreachCache.set(key, snapshot, now);
    return snapshot;
  } catch (cause) {
    return unavailableSnapshot(guardrailBreachCache, key, messageFor(cause), now, []);
  }
}

export async function getDailyKpiSnapshots(
  date?: string,
  routeDirectionId?: string,
  now: number = Date.now(),
): Promise<PilotSnapshot<DailyKpiSnapshot[]>> {
  const key = `${date ?? 'today'}:${routeDirectionId ?? 'all'}`;
  try {
    const raw = await fetchControlService('/v1/kpi/daily', { query: { date, routeDirectionId } });
    const { snapshots } = dailyKpiResponseSchema.parse(raw);
    const snapshot: PilotSnapshot<DailyKpiSnapshot[]> = {
      source: 'live',
      stale: false,
      error: null,
      fetchedAt: new Date(now).toISOString(),
      data: snapshots,
    };
    dailyKpiCache.set(key, snapshot, now);
    return snapshot;
  } catch (cause) {
    return unavailableSnapshot(dailyKpiCache, key, messageFor(cause), now, []);
  }
}

export async function getWarRoomIncidents(
  date?: string,
  routeDirectionId?: string,
  now: number = Date.now(),
): Promise<PilotSnapshot<WarRoomIncident[]>> {
  const key = `${date ?? 'today'}:${routeDirectionId ?? 'all'}`;
  try {
    const raw = await fetchControlService('/v1/war-room/incidents', { query: { date, routeDirectionId } });
    const { incidents } = warRoomIncidentsResponseSchema.parse(raw);
    const snapshot: PilotSnapshot<WarRoomIncident[]> = {
      source: 'live',
      stale: false,
      error: null,
      fetchedAt: new Date(now).toISOString(),
      data: incidents,
    };
    warRoomCache.set(key, snapshot, now);
    return snapshot;
  } catch (cause) {
    return unavailableSnapshot(warRoomCache, key, messageFor(cause), now, []);
  }
}

/** War-room write path (ticket AC3). `reviewedBy` is the caller's own authenticated identity, same rule as setRolloutStage's `changedBy`. */
export async function submitIncidentReview(
  incidentId: string,
  reviewedBy: string,
  input: Omit<SubmitIncidentReviewRequest, 'reviewedBy'>,
): Promise<WarRoomIncident> {
  const raw = await fetchControlService(`/v1/war-room/incidents/${encodeURIComponent(incidentId)}/review`, {
    method: 'PUT',
    body: { ...input, reviewedBy },
  });
  return warRoomIncidentReviewResponseSchema.parse(raw).incident;
}
