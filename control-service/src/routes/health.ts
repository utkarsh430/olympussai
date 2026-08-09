// Health/readiness contract, exact shape per
// docs/CONTROL_SERVICE_DEPLOYMENT.md "Health/readiness contract":
//  - GET /healthz: liveness only, no DB call.
//  - GET /readyz: DB reachable + state rehydration complete + a network
//    that state estimation can actually match against; 503 otherwise.
//
// The third condition is the non-obvious one. With no seeded network
// (zero active route_directions carrying a route_shape) every query
// succeeds, rehydration "completes", and every position fix short-circuits
// to `off_route` because there is no geometry to match to - so headway,
// bunching detection and MPC all silently produce nothing. That instance
// is structurally incapable of doing its job while looking perfectly
// healthy, which is precisely the failure a readiness probe exists to
// catch. Guarded by REQUIRE_SEEDED_NETWORK so the supertest suites (which
// run createApp() with no database at all) still pass.
//
// `ingest.lastEventAt` is reported but deliberately NOT a 503 trigger. A
// gap in the GPS poller is an alerting concern, not a routing one:
// dropping a healthy instance out of rotation because an upstream feed
// went quiet would take the whole fleet's API down mid-deploy for a
// problem no restart can fix.
import { Router } from 'express';
import { loadEnv } from '../config/env.js';
import { pingDb } from '../db/pool.js';
import { getNetworkCounts } from '../db/rehydrate.js';
import { getIngestStats } from '../ingestion/pipeline.js';
import { stateStore } from '../state/store.js';
import {
  getNetworkGeometryCache,
  getStateEstimationService,
} from '../state-estimation/singleton.js';
import { asyncHandler } from '../lib/errors.js';

export const healthRouter = Router();

healthRouter.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

healthRouter.get(
  '/readyz',
  asyncHandler(async (_req, res) => {
    const rehydrationComplete = stateStore.isReady;

    if (!rehydrationComplete) {
      res.status(503).json({
        status: 'not_ready',
        stateRehydrationComplete: false,
        rehydrationStatus: stateStore.status,
        dbReachable: false,
      });
      return;
    }

    let dbReachable = true;
    try {
      await pingDb();
    } catch {
      dbReachable = false;
    }

    if (!dbReachable) {
      res.status(503).json({
        status: 'not_ready',
        stateRehydrationComplete: true,
        rehydrationStatus: stateStore.status,
        dbReachable: false,
      });
      return;
    }

    const networkCounts = getNetworkCounts();

    if (loadEnv().REQUIRE_SEEDED_NETWORK && networkCounts.routeDirectionsWithShape === 0) {
      res.status(503).json({
        status: 'not_ready',
        reason: 'network_not_seeded',
        stateRehydrationComplete: true,
        rehydrationStatus: stateStore.status,
        dbReachable: true,
        counts: { ...stateStore.counts(), ...networkCounts },
      });
      return;
    }

    const cacheStats = getNetworkGeometryCache().stats;

    res.status(200).json({
      status: 'ready',
      stateRehydrationComplete: true,
      rehydrationStatus: stateStore.status,
      rehydratedAt: stateStore.rehydratedAt,
      dbReachable: true,
      counts: { ...stateStore.counts(), ...networkCounts },
      estimator: {
        rehydrated: getStateEstimationService().isRehydrated,
        shapeCacheVersion: cacheStats.version,
        shapeCacheLoadedAt: cacheStats.loadedAt,
      },
      ingest: getIngestStats(),
    });
  }),
);
