// POST /v1/mpc/solve - web -> control-service, service-token
// authenticated. Runs the MPC solver for one route-direction cycle and
// returns the candidate/selected action set. Timed by the `mpc.solve`
// Sentry span.
//
// Non-mutating despite the verb: it reads the in-memory state store plus
// the active-command set and writes nothing. POST (not GET) because the
// solve is a computation over a request body, and because its result must
// never be cached - the hard safety filter grades candidate staleness
// against the wall clock at solve time, so a re-served older response is
// a response whose freshness verdict has silently expired.
//
// The one caller is the web app's control room, through
// src/lib/controlService/recommendations.ts ->
// POST /api/ops/control-room/recommendations. Nothing here auto-issues
// anything: a returned action is a proposal a human must approve and
// dispatch through the dispatcher-approval path (POST /v1/commands, which
// still refuses to insert a command without an unconsumed approval row).
import { Router } from 'express';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import { mpcSolveRequestSchema } from '../models/schemas.js';
import { solve } from '../mpc/solver.js';

export const mpcRouter = Router();

mpcRouter.post(
  '/v1/mpc/solve',
  asyncHandler(async (req, res) => {
    const parsed = mpcSolveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'Invalid MPC solve request', 400, parsed.error.flatten()));
      return;
    }
    const result = await solve(parsed.data.routeDirectionId);
    res.status(200).json(result);
  }),
);
