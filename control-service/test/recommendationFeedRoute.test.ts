// HTTP-layer tests for the standing-proposal feed (GET /v1/recommendations).
//
// The db module is mocked whole, the same way test/headwayRoutes.test.ts
// mocks the headway service - the SQL that shapes these rows is not what this
// file is about. What it IS about:
//
//   1. OFF IS A TRUE NO-OP. Not "behaves the same": the router is never
//      mounted, so the path 404s through the app's own catch-all and neither
//      reader is ever called. A flag that costs a query per request while
//      claiming to be off is not off.
//   2. A stored proposal is never dressed as a live one. The window comes
//      from the decision cycle's own repeat interval, and the freshness bar
//      from mpc/safety.ts, so neither is a second number invented at the
//      HTTP layer.
//   3. Nothing here can issue anything. The handler reads and returns rows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/db/recommendations.js', async () => {
  const actual = await vi.importActual<typeof import('../src/db/recommendations.js')>(
    '../src/db/recommendations.js',
  );
  return {
    ...actual,
    listStandingRecommendations: vi.fn(),
    findNewestRecommendationCreatedAt: vi.fn(),
  };
});

const { createApp } = await import('../src/app.js');
const { listStandingRecommendations, findNewestRecommendationCreatedAt } = await import(
  '../src/db/recommendations.js'
);
const { _resetEnvCacheForTests, loadEnv } = await import('../src/config/env.js');

const AUTH_HEADER = 'Bearer test-service-token-secret-value';

/** mpc/safety.ts's own state-freshness bound, which the feed grades rows against. */
const FRESH_WITHIN_SECONDS = 90;

const row = {
  id: 'rec-1',
  routeDirectionId: 'rd-1',
  routeId: 'route-1',
  routePublicName: '12A',
  directionCode: 'UP',
  directionName: 'City centre',
  incidentId: null,
  status: 'proposed',
  selectedActionType: 'two_way_hold',
  selectedVehicleId: 'UP25FT4823',
  selectedHoldSeconds: 45,
  candidateActionCount: 2,
  objectiveCost: -1200,
  expectedRecoverySeconds: 300,
  controllerVersion: 'mpc-1',
  paceAdvisories: [],
  createdAt: '2026-09-06T08:00:00.000Z',
  ageSeconds: 40,
  freshness: 'fresh' as const,
};

function withFlag(value: 'true' | 'false') {
  process.env.RECOMMENDATION_FEED_ENABLED = value;
  _resetEnvCacheForTests();
}

describe('GET /v1/recommendations', () => {
  beforeEach(() => {
    vi.mocked(listStandingRecommendations).mockReset();
    vi.mocked(findNewestRecommendationCreatedAt).mockReset();
    vi.mocked(listStandingRecommendations).mockResolvedValue({
      recommendations: [row],
      totalWithinWindow: 1,
    });
    vi.mocked(findNewestRecommendationCreatedAt).mockResolvedValue('2026-09-06T08:00:00.000Z');
  });

  afterEach(() => {
    delete process.env.RECOMMENDATION_FEED_ENABLED;
    _resetEnvCacheForTests();
  });

  describe('with RECOMMENDATION_FEED_ENABLED unset (the shipped default)', () => {
    it('is not mounted at all, and issues no query', async () => {
      _resetEnvCacheForTests();
      expect(loadEnv().RECOMMENDATION_FEED_ENABLED).toBe(false);

      const res = await request(createApp())
        .get('/v1/recommendations')
        .set('Authorization', AUTH_HEADER);

      // The app's own catch-all, byte for byte what this path answered before
      // this endpoint existed.
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
      expect(listStandingRecommendations).not.toHaveBeenCalled();
      expect(findNewestRecommendationCreatedAt).not.toHaveBeenCalled();
    });

    it('leaves every other route answering exactly as it did', async () => {
      _resetEnvCacheForTests();
      const res = await request(createApp()).get('/healthz');
      expect(res.status).toBe(200);
    });
  });

  describe('with the flag on', () => {
    beforeEach(() => withFlag('true'));

    it('requires the service token', async () => {
      const res = await request(createApp()).get('/v1/recommendations');
      expect(res.status).toBe(401);
      expect(listStandingRecommendations).not.toHaveBeenCalled();
    });

    it('serves the standing proposal per corridor, freshness-stamped', async () => {
      const res = await request(createApp())
        .get('/v1/recommendations')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.recommendations).toHaveLength(1);
      expect(res.body.recommendations[0].selectedActionType).toBe('two_way_hold');
      expect(res.body.totalWithinWindow).toBe(1);
      expect(res.body.freshWithinSeconds).toBe(FRESH_WITHIN_SECONDS);
    });

    // The response is a summary of what the row SAID. It must not carry the
    // CandidateAction objects themselves: those wear a safety verdict graded
    // against a clock that has moved on, and a console handed one would render
    // it with the same approve affordance a live candidate gets.
    it('never ships the approvable candidate payload', async () => {
      const res = await request(createApp())
        .get('/v1/recommendations')
        .set('Authorization', AUTH_HEADER);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('candidateActions');
      expect(body).not.toContain('safeCandidates');
      expect(res.body.recommendations[0].candidateActionCount).toBe(2);
    });

    // The window is the cycle's promise about unchanged advice, not a number
    // this layer picked. isMateriallyNewRecommendation re-writes a standing row
    // once it is older than this, so a row older than the window is one the
    // cycle had the chance to repeat and did not.
    it('windows on the decision cycle\'s own repeat interval', async () => {
      await request(createApp()).get('/v1/recommendations').set('Authorization', AUTH_HEADER);

      expect(listStandingRecommendations).toHaveBeenCalledWith(
        expect.objectContaining({
          windowSeconds: loadEnv().DECISION_CYCLE_REPEAT_AFTER_SECONDS,
          freshWithinSeconds: FRESH_WITHIN_SECONDS,
        }),
      );
    });

    // One ceiling, and it is the configured one. `totalWithinWindow` is what
    // tells a caller the page it got back is a slice.
    it('clamps limit to the configured ceiling', async () => {
      await request(createApp())
        .get('/v1/recommendations?limit=100000')
        .set('Authorization', AUTH_HEADER);

      expect(listStandingRecommendations).toHaveBeenCalledWith(
        expect.objectContaining({ limit: loadEnv().RECOMMENDATION_FEED_MAX_LIMIT }),
      );
    });

    it('rejects a nonsense limit rather than guessing one', async () => {
      const res = await request(createApp())
        .get('/v1/recommendations?limit=-3')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
      expect(listStandingRecommendations).not.toHaveBeenCalled();
    });

    // The one field that keeps an empty list from reading as an all-clear.
    // AGENTS.md records the same lesson for the alert inbox; here it is worse,
    // because a feed of proposals empties both when the controller proposed
    // nothing and when the controller is not running.
    it('reports the newest row in the table even when the window is empty', async () => {
      vi.mocked(listStandingRecommendations).mockResolvedValue({
        recommendations: [],
        totalWithinWindow: 0,
      });
      vi.mocked(findNewestRecommendationCreatedAt).mockResolvedValue('2026-09-06T02:00:00.000Z');

      const res = await request(createApp())
        .get('/v1/recommendations')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.recommendations).toEqual([]);
      expect(res.body.latestCreatedAt).toBe('2026-09-06T02:00:00.000Z');
    });

    it('says null when the controller has never written a proposal', async () => {
      vi.mocked(listStandingRecommendations).mockResolvedValue({
        recommendations: [],
        totalWithinWindow: 0,
      });
      vi.mocked(findNewestRecommendationCreatedAt).mockResolvedValue(null);

      const res = await request(createApp())
        .get('/v1/recommendations')
        .set('Authorization', AUTH_HEADER);

      expect(res.body.latestCreatedAt).toBeNull();
    });
  });
});
