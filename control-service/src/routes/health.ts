// Health/readiness contract, exact shape per
// docs/CONTROL_SERVICE_DEPLOYMENT.md "Health/readiness contract":
//  - GET /healthz: liveness only, no DB call.
//  - GET /readyz: DB reachable + state rehydration complete; 503 while
//    rehydrating (or if rehydration failed / hasn't started).
import { Router } from 'express';
import { pingDb } from '../db/pool.js';
import { stateStore } from '../state/store.js';
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

    res.status(200).json({
      status: 'ready',
      stateRehydrationComplete: true,
      rehydrationStatus: stateStore.status,
      rehydratedAt: stateStore.rehydratedAt,
      dbReachable: true,
      counts: stateStore.counts(),
    });
  }),
);
