// @vitest-environment node
//
// src/lib/controlService/pilotData.ts is server-only (fetch to the
// control service), same rationale as observabilityData.test.ts. Covers
// the fallback ladder (unconfigured -> unavailable, live -> cached
// fallback on later failure) plus the two write paths, which must send
// the caller's own identity as changedBy/reviewedBy rather than trusting
// anything client-supplied.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

const rolloutStageRow = {
  routeDirectionId: 'dir-1',
  routeId: 'R1',
  directionCode: 'up',
  directionName: 'Northbound',
  publicName: 'Route 1',
  stage: 'shadow',
  reason: null,
  updatedBy: null,
  updatedAt: null,
};

describe('pilotData', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CONTROL_SERVICE_BASE_URL = 'https://control.example.test';
    process.env.CONTROL_SERVICE_SERVICE_TOKEN = 'test-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CONTROL_SERVICE_BASE_URL;
    delete process.env.CONTROL_SERVICE_SERVICE_TOKEN;
  });

  it('getRolloutStages returns an unavailable snapshot (never throws) when the control service is not configured', async () => {
    delete process.env.CONTROL_SERVICE_BASE_URL;
    const { getRolloutStages } = await import('@/lib/controlService/pilotData');

    const snapshot = await getRolloutStages(Date.now());

    expect(snapshot.source).toBe('unavailable');
    expect(snapshot.error).toBeTruthy();
    expect(snapshot.data).toEqual([]);
  });

  it('getRolloutStages returns a live snapshot and caches it as last-known-good for a later failure', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ rolloutStages: [rolloutStageRow] })))
      .mockRejectedValue(new Error('control service unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const { getRolloutStages } = await import('@/lib/controlService/pilotData');

    const first = await getRolloutStages(Date.now());
    expect(first.source).toBe('live');
    expect(first.data).toEqual([rolloutStageRow]);

    const second = await getRolloutStages(Date.now());
    expect(second.source).toBe('unavailable');
    expect(second.stale).toBe(true);
    expect(second.data).toEqual([rolloutStageRow]);
  });

  it('setRolloutStage sends the caller-resolved changedBy, never a client-supplied identity', async () => {
    const fetchMock = vi.fn().mockImplementation((url: URL, init: RequestInit) => {
      expect(url.pathname).toBe('/v1/route-directions/dir-1/rollout-stage');
      expect(init.method).toBe('PUT');
      const body = JSON.parse(init.body as string) as { stage: string; changedBy: string; reason: string | null };
      expect(body).toEqual({ stage: 'advisory', changedBy: 'admin@example.com', reason: 'pilot week 3' });
      return Promise.resolve(jsonResponse({ rolloutStage: { ...rolloutStageRow, stage: 'advisory' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { setRolloutStage } = await import('@/lib/controlService/pilotData');
    const updated = await setRolloutStage('dir-1', 'admin@example.com', { stage: 'advisory', reason: 'pilot week 3' });

    expect(updated.stage).toBe('advisory');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getDailyKpiSnapshots and getWarRoomIncidents fall back to an unavailable snapshot without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const { getDailyKpiSnapshots, getWarRoomIncidents } = await import('@/lib/controlService/pilotData');

    const kpi = await getDailyKpiSnapshots('2026-08-06', undefined, Date.now());
    expect(kpi.source).toBe('unavailable');
    expect(kpi.data).toEqual([]);

    const warRoom = await getWarRoomIncidents('2026-08-06', undefined, Date.now());
    expect(warRoom.source).toBe('unavailable');
    expect(warRoom.data).toEqual([]);
  });

  it('submitIncidentReview sends the caller-resolved reviewedBy, never a client-supplied identity', async () => {
    const incident = {
      incidentId: 'inc-1',
      routeDirectionId: 'dir-1',
      severity: 'bunched',
      causeClass: 'endogenous',
      controllability: 'controllable',
      status: 'closed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      classification: 'eligible',
      actionTaken: 'two-way hold',
      reviewOutcome: 'gap closed',
      reviewedBy: 'control-room@example.com',
      reviewedAt: new Date().toISOString(),
      measuredCompliance: null,
      measuredRecoverySeconds: null,
      measuredGuardrailEvents: [],
    };
    const fetchMock = vi.fn().mockImplementation((url: URL, init: RequestInit) => {
      expect(url.pathname).toBe('/v1/war-room/incidents/inc-1/review');
      const body = JSON.parse(init.body as string) as { reviewedBy: string };
      expect(body.reviewedBy).toBe('control-room@example.com');
      return Promise.resolve(jsonResponse({ incident }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { submitIncidentReview } = await import('@/lib/controlService/pilotData');
    const result = await submitIncidentReview('inc-1', 'control-room@example.com', {
      classification: 'eligible',
      actionTaken: 'two-way hold',
      outcome: 'gap closed',
    });

    expect(result.reviewedBy).toBe('control-room@example.com');
  });
});
