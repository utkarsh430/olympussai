// POST /v1/positions - the service's sensory input. Service-token
// authenticated, same as every other /v1 route.
//
// Batch rather than single-event on purpose: a poll cycle carries ~665
// vehicles, and partial success (one unregistered bus among 664 good
// fixes) simply cannot be expressed by a per-request status code. So the
// response is ALWAYS 200 unless the envelope itself is malformed, and the
// per-event verdicts live in the body:
//
//   { accepted: number, rejected: [{ index, vehicleId, code, message }] }
//
// Also hosts POST /v1/admin/geometry/refresh, which invalidates the
// network-geometry cache. The cache's TTL is only a backstop - after an
// operator re-runs the route seeder this endpoint is the intended way to
// make the new shapes live immediately rather than up to SHAPE_CACHE_TTL_MS
// later.
import { Router } from 'express';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  ingestPositionsRequestSchema,
  type IngestPositionsResponse,
} from '../models/ingestionSchemas.js';
import { refreshNetworkCounts } from '../db/rehydrate.js';
import { ingestPositionEvents } from '../ingestion/pipeline.js';
import { getNetworkGeometryCache } from '../state-estimation/singleton.js';

export const positionsRouter = Router();

positionsRouter.post(
  '/v1/positions',
  asyncHandler(async (req, res) => {
    const parsed = ingestPositionsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // The envelope is the only thing that can produce a non-200 here:
      // if we cannot even tell how many events were sent, there is no
      // per-event result set to report.
      sendError(
        res,
        new AppError('invalid_request', 'Invalid position batch', 400, parsed.error.flatten()),
      );
      return;
    }

    const startedAt = Date.now();
    const { accepted, rejected } = await ingestPositionEvents(parsed.data.events, {
      autoRegisterVehicles: parsed.data.autoRegisterVehicles,
    });

    logger.info(
      {
        received: parsed.data.events.length,
        accepted,
        rejected: rejected.length,
        durationMs: Date.now() - startedAt,
      },
      'position batch ingested',
    );

    const body: IngestPositionsResponse = { accepted, rejected };
    res.status(200).json(body);
  }),
);

positionsRouter.post(
  '/v1/admin/geometry/refresh',
  asyncHandler(async (_req, res) => {
    const cache = getNetworkGeometryCache();
    cache.invalidate();
    // Also refreshes /readyz's networkCounts (db/rehydrate.ts) - this is
    // the immediate path an operator already uses right after reseeding to
    // make new shapes live, and it must make the new COUNTS live too rather
    // than leaving /readyz reporting the pre-seed number until a restart.
    const [snapshot, networkCounts] = await Promise.all([cache.warm(), refreshNetworkCounts()]);
    logger.info(
      { version: snapshot.version, shapeCount: snapshot.shapes.length, network: networkCounts },
      'network geometry cache refreshed on request',
    );
    res.status(200).json({ refreshed: true, ...cache.stats });
  }),
);
