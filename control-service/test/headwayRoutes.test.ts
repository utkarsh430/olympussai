// HTTP-layer tests for the headway/incident routes: auth, request
// validation, and response shape. The orchestration logic itself
// (computeRouteDirectionHeadway) is covered by test/headwayService.test.ts
// against a mocked repository - here the whole service module is mocked,
// the same way test/commandsRoute.test.ts mocks db/commands.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/headway/service.js', () => ({
  computeRouteDirectionHeadway: vi.fn(),
  getLatestRouteDirectionHeadway: vi.fn(),
  listOpenIncidents: vi.fn(),
  countOpenIncidents: vi.fn(),
  getIncident: vi.fn(),
  listActiveRouteDirections: vi.fn(),
}));

const { createApp } = await import('../src/app.js');
const {
  computeRouteDirectionHeadway,
  getLatestRouteDirectionHeadway,
  listOpenIncidents,
  countOpenIncidents,
  getIncident,
  listActiveRouteDirections,
} = await import('../src/headway/service.js');
const { AppError } = await import('../src/lib/errors.js');
type HeadwayComputeResult = Awaited<ReturnType<typeof computeRouteDirectionHeadway>>;

const AUTH_HEADER = 'Bearer test-service-token-secret-value';

describe('headway routes', () => {
  beforeEach(() => {
    vi.mocked(computeRouteDirectionHeadway).mockReset();
    vi.mocked(getLatestRouteDirectionHeadway).mockReset();
    vi.mocked(listOpenIncidents).mockReset();
    vi.mocked(countOpenIncidents).mockReset();
    vi.mocked(getIncident).mockReset();
    vi.mocked(listActiveRouteDirections).mockReset();
  });

  // The read endpoint exists so a dashboard poll stops APPENDING to the
  // very history the reactive bunching rule reads back over. Two open
  // dashboards polling compute would have halved the effective detection
  // window; a refresh could manufacture an incident.
  describe('GET /v1/route-directions/:routeDirectionId/headway', () => {
    const latest: HeadwayComputeResult = {
      routeDirectionId: 'rd-1',
      computedAt: '2026-08-05T08:00:00.000Z',
      pairs: [],
      aggregate: {
        routeDirectionId: 'rd-1',
        sampleCount: 0,
        meanHeadwaySeconds: null,
        stddevHeadwaySeconds: null,
        cv: null,
        ewtSeconds: null,
        targetHeadwaySeconds: 300,
      },
      incidents: [],
    };

    it('requires the service token', async () => {
      const res = await request(createApp()).get('/v1/route-directions/rd-1/headway');
      expect(res.status).toBe(401);
      expect(getLatestRouteDirectionHeadway).not.toHaveBeenCalled();
    });

    it('returns the latest persisted sample set WITHOUT computing a new one', async () => {
      vi.mocked(getLatestRouteDirectionHeadway).mockResolvedValue(latest);

      const res = await request(createApp())
        .get('/v1/route-directions/rd-1/headway')
        .set('authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.routeDirectionId).toBe('rd-1');
      expect(getLatestRouteDirectionHeadway).toHaveBeenCalledWith('rd-1');
      // The load-bearing assertion: reading must not write.
      expect(computeRouteDirectionHeadway).not.toHaveBeenCalled();
    });

    it('surfaces an unknown route-direction as a 404, not an empty 200', async () => {
      vi.mocked(getLatestRouteDirectionHeadway).mockRejectedValue(
        new AppError('unknown_route_direction', 'No active route-direction rd-nope', 404),
      );

      const res = await request(createApp())
        .get('/v1/route-directions/rd-nope/headway')
        .set('authorization', AUTH_HEADER);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('unknown_route_direction');
    });
  });

  describe('POST /v1/route-directions/:routeDirectionId/headway/compute', () => {
    it('requires the service token', async () => {
      const app = createApp();
      const res = await request(app).post('/v1/route-directions/rd-1/headway/compute');
      expect(res.status).toBe(401);
      expect(computeRouteDirectionHeadway).not.toHaveBeenCalled();
    });

    it('computes and returns pairs/aggregate/incidents on success', async () => {
      const payload: HeadwayComputeResult = {
        routeDirectionId: 'rd-1',
        computedAt: new Date().toISOString(),
        pairs: [
          {
            id: 'h-1',
            routeDirectionId: 'rd-1',
            leaderVehicleId: 'veh-a',
            followerVehicleId: 'veh-b',
            gapMeters: 500,
            hFwdSeconds: 100,
            hBwdSeconds: 50,
            targetHeadwaySeconds: 300,
            deviationSeconds: -200,
            confidence: 0.8,
            forecastHFwdSeconds: null,
            computedAt: new Date().toISOString(),
          },
        ],
        aggregate: {
          routeDirectionId: 'rd-1',
          sampleCount: 1,
          meanHeadwaySeconds: 100,
          stddevHeadwaySeconds: 0,
          cv: 0,
          ewtSeconds: 0,
          targetHeadwaySeconds: 300,
        },
        incidents: [
          {
            routeDirectionId: 'rd-1',
            leaderVehicleId: 'veh-a',
            followerVehicleId: 'veh-b',
            action: 'opened',
            severity: 'bunched',
            incidentId: 'inc-1',
            ratio: 0.2,
          },
        ],
      };
      vi.mocked(computeRouteDirectionHeadway).mockResolvedValueOnce(payload);

      const app = createApp();
      const res = await request(app)
        .post('/v1/route-directions/rd-1/headway/compute')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(payload);
      expect(computeRouteDirectionHeadway).toHaveBeenCalledWith('rd-1');
    });

    it('propagates a no_active_policy 404 from the service', async () => {
      vi.mocked(computeRouteDirectionHeadway).mockRejectedValueOnce(
        new AppError('no_active_policy', 'No active route policy for route-direction rd-unknown', 404),
      );

      const app = createApp();
      const res = await request(app)
        .post('/v1/route-directions/rd-unknown/headway/compute')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('no_active_policy');
    });
  });

  describe('GET /v1/incidents', () => {
    it('requires the service token', async () => {
      const app = createApp();
      const res = await request(app).get('/v1/incidents');
      expect(res.status).toBe(401);
    });

    it('returns open incidents, optionally scoped by routeDirectionId', async () => {
      const incidents = [
        {
          id: 'inc-1',
          routeDirectionId: 'rd-1',
          severity: 'bunched',
          causeClass: 'unknown',
          controllability: 'controllable',
          status: 'open',
          startedAt: new Date().toISOString(),
          endedAt: null,
          evidence: {},
          members: [
            { vehicleId: 'veh-a', role: 'leader' },
            { vehicleId: 'veh-b', role: 'follower' },
          ],
        },
      ];
      vi.mocked(listOpenIncidents).mockResolvedValueOnce(incidents);

      const app = createApp();
      const res = await request(app)
        .get('/v1/incidents')
        .query({ routeDirectionId: 'rd-1' })
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.incidents).toEqual(incidents);
      expect(res.body.totalOpenCount).toBe(incidents.length);
      expect(listOpenIncidents).toHaveBeenCalledWith('rd-1', undefined);
      // Unlimited: the slice IS the total, so no separate count query is issued.
      expect(countOpenIncidents).not.toHaveBeenCalled();
    });

    it('works with no routeDirectionId filter', async () => {
      vi.mocked(listOpenIncidents).mockResolvedValueOnce([]);
      const app = createApp();
      const res = await request(app).get('/v1/incidents').set('Authorization', AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(listOpenIncidents).toHaveBeenCalledWith(undefined, undefined);
    });

    it('applies limit and reports the true total separately when the result was capped', async () => {
      const incidents = Array.from({ length: 2 }, (_, i) => ({
        id: `inc-${i}`,
        routeDirectionId: 'rd-1',
        severity: 'bunched',
        causeClass: 'unknown',
        controllability: 'controllable',
        status: 'open',
        startedAt: new Date().toISOString(),
        endedAt: null,
        evidence: {},
        members: [],
      }));
      vi.mocked(listOpenIncidents).mockResolvedValueOnce(incidents);
      vi.mocked(countOpenIncidents).mockResolvedValueOnce(8582);

      const app = createApp();
      const res = await request(app)
        .get('/v1/incidents')
        .query({ routeDirectionId: 'rd-1', limit: '2' })
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.incidents).toEqual(incidents);
      expect(res.body.totalOpenCount).toBe(8582);
      expect(listOpenIncidents).toHaveBeenCalledWith('rd-1', 2);
      expect(countOpenIncidents).toHaveBeenCalledWith('rd-1');
    });

    it('rejects a limit outside the accepted range', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/v1/incidents')
        .query({ limit: '0' })
        .set('Authorization', AUTH_HEADER);
      expect(res.status).toBe(400);
      expect(listOpenIncidents).not.toHaveBeenCalled();
    });
  });

  describe('GET /v1/incidents/:id', () => {
    it('requires the service token', async () => {
      const app = createApp();
      const res = await request(app).get('/v1/incidents/inc-1');
      expect(res.status).toBe(401);
    });

    it('returns the incident regardless of status (open or closed)', async () => {
      const incident = {
        id: 'inc-1',
        routeDirectionId: 'rd-1',
        severity: 'bunched',
        causeClass: 'unknown',
        controllability: 'controllable',
        status: 'closed',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        evidence: {},
        members: [{ vehicleId: 'veh-a', role: 'leader' }],
      };
      vi.mocked(getIncident).mockResolvedValueOnce(incident);

      const app = createApp();
      const res = await request(app).get('/v1/incidents/inc-1').set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.incident).toEqual(incident);
      expect(getIncident).toHaveBeenCalledWith('inc-1');
    });

    it('404s when the incident does not exist', async () => {
      vi.mocked(getIncident).mockResolvedValueOnce(null);
      const app = createApp();
      const res = await request(app).get('/v1/incidents/missing').set('Authorization', AUTH_HEADER);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('incident_not_found');
    });
  });

  describe('GET /v1/route-directions', () => {
    it('requires the service token', async () => {
      const app = createApp();
      const res = await request(app).get('/v1/route-directions');
      expect(res.status).toBe(401);
    });

    it('returns active route-directions', async () => {
      const routeDirections = [
        {
          routeDirectionId: 'rd-1',
          routeId: 'route-1',
          directionCode: 'UP',
          isLoop: false,
          totalDistanceMeters: 2000,
          hasActivePolicy: true,
        },
      ];
      vi.mocked(listActiveRouteDirections).mockResolvedValueOnce(routeDirections);

      const app = createApp();
      const res = await request(app).get('/v1/route-directions').set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.routeDirections).toEqual(routeDirections);
    });

    // The picker's own honesty depends on this reaching the wire: a corridor
    // with geometry but no policy is offered like any other and then shows
    // nothing. If the flag is dropped in serialization the marker silently
    // disappears and the list goes back to looking uniform.
    it('carries hasActivePolicy through to the response for corridors that cannot detect', async () => {
      vi.mocked(listActiveRouteDirections).mockResolvedValueOnce([
        {
          routeDirectionId: 'rd-shaped-only',
          routeId: 'route-2',
          directionCode: 'DOWN',
          isLoop: false,
          totalDistanceMeters: 3000,
          hasActivePolicy: false,
        },
      ]);

      const res = await request(createApp()).get('/v1/route-directions').set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.routeDirections[0].hasActivePolicy).toBe(false);
    });
  });
});
