// @vitest-environment node
//
// getObservabilitySnapshot is server-only (fetch to the control service),
// same rationale as src/tests/unit/fleetData.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

describe('getObservabilitySnapshot', () => {
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

  it('returns an unavailable snapshot (never throws) when the control service is not configured', async () => {
    delete process.env.CONTROL_SERVICE_BASE_URL;
    const { getObservabilitySnapshot } = await import('@/lib/controlService/observabilityData');

    const snapshot = await getObservabilitySnapshot(undefined, Date.now());

    expect(snapshot.source).toBe('unavailable');
    expect(snapshot.error).toBeTruthy();
    expect(snapshot.routeDirections).toEqual([]);
    expect(snapshot.headway).toBeNull();
  });

  it('returns a live snapshot with positions, headway aggregate and incidents for the selected route-direction', async () => {
    const fetchMock = vi.fn().mockImplementation((url: URL) => {
      const path = url.pathname;
      if (path === '/v1/route-directions') {
        return Promise.resolve(
          jsonResponse({ routeDirections: [{ routeDirectionId: 'dir-1', routeId: 'R1', directionCode: 'up', isLoop: false, totalDistanceMeters: 18000 }] }),
        );
      }
      if (path === '/v1/vehicle-states') {
        return Promise.resolve(
          jsonResponse({
            vehicleStates: [
              {
                vehicleId: 'V1',
                tripId: null,
                routeDirectionId: 'dir-1',
                distanceAlongRouteMeters: 500,
                speedKmph: 18,
                stopState: 'off_route',
                currentStopId: null,
                confidence: 0.9,
                observedAt: new Date().toISOString(),
              },
            ],
          }),
        );
      }
      // GET .../headway, not POST .../headway/compute: the dashboard reads
      // the persisted sample set, it does not append to the history its own
      // bunching alerts are derived from.
      if (path.endsWith('/headway')) {
        return Promise.resolve(
          jsonResponse({
            routeDirectionId: 'dir-1',
            computedAt: new Date().toISOString(),
            pairs: [],
            aggregate: {
              routeDirectionId: 'dir-1',
              sampleCount: 0,
              meanHeadwaySeconds: null,
              stddevHeadwaySeconds: null,
              cv: null,
              ewtSeconds: null,
              targetHeadwaySeconds: 300,
            },
            incidents: [],
          }),
        );
      }
      if (path === '/v1/incidents') {
        return Promise.resolve(jsonResponse({ incidents: [] }));
      }
      throw new Error(`unexpected path ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getObservabilitySnapshot } = await import('@/lib/controlService/observabilityData');
    const snapshot = await getObservabilitySnapshot('dir-1', Date.now());

    expect(snapshot.source).toBe('live');
    expect(snapshot.selectedRouteDirectionId).toBe('dir-1');
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.headway?.aggregate.targetHeadwaySeconds).toBe(300);
    expect(snapshot.incidents).toEqual([]);
  });

  it('serves the last-known-good cached snapshot (flagged stale) when a later call fails', async () => {
    const goodResponses = (path: string) => {
      if (path === '/v1/route-directions') {
        return jsonResponse({ routeDirections: [{ routeDirectionId: 'dir-1', routeId: 'R1', directionCode: 'up', isLoop: false, totalDistanceMeters: 18000 }] });
      }
      if (path === '/v1/vehicle-states') return jsonResponse({ vehicleStates: [] });
      if (path.endsWith('/headway')) {
        return jsonResponse({
          routeDirectionId: 'dir-1',
          computedAt: new Date().toISOString(),
          pairs: [],
          aggregate: { routeDirectionId: 'dir-1', sampleCount: 0, meanHeadwaySeconds: null, stddevHeadwaySeconds: null, cv: null, ewtSeconds: null, targetHeadwaySeconds: 300 },
          incidents: [],
        });
      }
      return jsonResponse({ incidents: [] });
    };

    const fetchMock = vi
      .fn()
      .mockImplementationOnce((url: URL) => Promise.resolve(goodResponses(url.pathname)))
      .mockImplementationOnce((url: URL) => Promise.resolve(goodResponses(url.pathname)))
      .mockImplementationOnce((url: URL) => Promise.resolve(goodResponses(url.pathname)))
      .mockImplementationOnce((url: URL) => Promise.resolve(goodResponses(url.pathname)))
      .mockRejectedValue(new Error('control service unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const { getObservabilitySnapshot } = await import('@/lib/controlService/observabilityData');

    const first = await getObservabilitySnapshot('dir-1', Date.now());
    expect(first.source).toBe('live');

    const second = await getObservabilitySnapshot('dir-1', Date.now());
    expect(second.source).toBe('unavailable');
    expect(second.stale).toBe(true);
    expect(second.selectedRouteDirectionId).toBe('dir-1');
  });

  /**
   * The signal the status band needs to tell an outage from a corridor with
   * nothing to report.
   *
   * `no_active_policy` is a 404 the control service raises on purpose, for a
   * corridor whose timetable produced no usable headway target. Before this,
   * the snapshot recorded only the prose message, so every caller had to
   * describe a service that had just answered three times as one that "did not
   * answer" - see src/lib/ops/controlRoomOverview.ts#noActivePolicyFrom.
   */
  describe('error provenance', () => {
    const routeDirections = {
      routeDirections: [
        { routeDirectionId: 'dir-1', routeId: 'R1', directionCode: 'up', isLoop: false, totalDistanceMeters: 18000 },
      ],
    };

    it("keeps the service's own error code when it answered with a per-corridor error", async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: URL) => {
          if (url.pathname === '/v1/route-directions') return Promise.resolve(jsonResponse(routeDirections));
          if (url.pathname.endsWith('/headway')) {
            // Byte-for-byte what the live control service returns.
            return Promise.resolve({
              ok: false,
              status: 404,
              json: async () => ({
                error: { code: 'no_active_policy', message: 'No active route policy for route-direction dir-1' },
              }),
            });
          }
          return Promise.resolve(jsonResponse({ vehicleStates: [], incidents: [] }));
        }),
      );

      const { getObservabilitySnapshot } = await import('@/lib/controlService/observabilityData');
      const snapshot = await getObservabilitySnapshot('dir-1', Date.now());

      expect(snapshot.errorCode).toBe('no_active_policy');
      expect(snapshot.error).toMatch(/No active route policy/);
    });

    // Without this, the console reported "no corridor selected" AND "this
    // corridor has no active headway policy" at the same time - two
    // contradictory claims about a corridor it could no longer name, because
    // the successfully-fetched corridor list was discarded along with the
    // headway error that had nothing to do with it.
    it('keeps the corridor list and selection it already fetched', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: URL) => {
          if (url.pathname === '/v1/route-directions') return Promise.resolve(jsonResponse(routeDirections));
          if (url.pathname.endsWith('/headway')) {
            return Promise.resolve({
              ok: false,
              status: 404,
              json: async () => ({ error: { code: 'no_active_policy', message: 'No active route policy' } }),
            });
          }
          return Promise.resolve(jsonResponse({ vehicleStates: [], incidents: [] }));
        }),
      );

      const { getObservabilitySnapshot } = await import('@/lib/controlService/observabilityData');
      const snapshot = await getObservabilitySnapshot('dir-1', Date.now());

      expect(snapshot.errorCode).toBe('no_active_policy');
      expect(snapshot.selectedRouteDirectionId).toBe('dir-1');
      expect(snapshot.routeDirections).toHaveLength(1);
      expect(snapshot.headway).toBeNull();
      // Never another corridor's cached incidents attributed to this one.
      expect(snapshot.incidents).toEqual([]);
      expect(snapshot.positions).toEqual([]);
    });

    it('leaves the code null when the service genuinely did not answer', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: URL) => {
          if (url.pathname === '/v1/route-directions') return Promise.resolve(jsonResponse(routeDirections));
          return Promise.reject(new Error('socket hang up'));
        }),
      );

      const { getObservabilitySnapshot } = await import('@/lib/controlService/observabilityData');
      const snapshot = await getObservabilitySnapshot('dir-1', Date.now());

      expect(snapshot.source).toBe('unavailable');
      expect(snapshot.errorCode).toBeNull();
    });

    it('carries no code on a healthy read', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: URL) => {
          if (url.pathname === '/v1/route-directions') return Promise.resolve(jsonResponse(routeDirections));
          if (url.pathname.endsWith('/headway')) {
            return Promise.resolve(
              jsonResponse({
                routeDirectionId: 'dir-1',
                computedAt: new Date().toISOString(),
                pairs: [],
                aggregate: {
                  routeDirectionId: 'dir-1',
                  sampleCount: 0,
                  meanHeadwaySeconds: null,
                  stddevHeadwaySeconds: null,
                  cv: null,
                  ewtSeconds: null,
                  targetHeadwaySeconds: 300,
                },
                incidents: [],
              }),
            );
          }
          return Promise.resolve(jsonResponse({ vehicleStates: [], incidents: [] }));
        }),
      );

      const { getObservabilitySnapshot } = await import('@/lib/controlService/observabilityData');
      const snapshot = await getObservabilitySnapshot('dir-1', Date.now());

      expect(snapshot.source).toBe('live');
      expect(snapshot.errorCode).toBeNull();
    });
  });
});
