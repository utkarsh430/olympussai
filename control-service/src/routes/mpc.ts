// POST /v1/mpc/solve - web -> control-service, service-token
// authenticated. Runs the MPC solver for one route-direction cycle and
// returns the candidate/selected action set. Timed by the `mpc.solve`
// Sentry span.
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
