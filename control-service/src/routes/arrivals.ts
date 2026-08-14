// GET /v1/vehicles/:vehicleId/arrivals - per-stop arrival prediction for one
// vehicle. Web -> control-service, service-token authenticated like every other
// /v1 route.
//
// ALWAYS 200 WHEN THE REQUEST IS WELL-FORMED, including when no prediction can
// be made. "We cannot predict this bus right now" is a normal, expected state
// on this fleet - 69% of vehicles are off route at any moment - not an error,
// and it carries a named reason plus an empty arrivals array in the body. The
// same choice POST /v1/positions makes for a partially-rejected batch, and the
// same one the driver PWA's command poll makes with `{ command: null }`.
//
// Turning a refusal into a 4xx would push every caller into a catch block,
// where the overwhelming temptation is to substitute whatever else is to hand -
// which on this product means the published timetable, presented as a
// prediction. The refusal is part of the answer, so it travels in the answer.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import { MAX_HORIZON_SECONDS, MAX_STOP_LIMIT } from '../arrival-prediction/predict.js';
import { getVehicleArrivals } from '../arrival-prediction/service.js';

export const arrivalsRouter = Router();

const vehicleParamSchema = z.object({
  vehicleId: z.string().min(1).max(64),
});

const arrivalsQuerySchema = z.object({
  /** Upcoming stops to return. Clamped again in the core; validated here so a typo is a 400, not a silent clamp. */
  limit: z.coerce.number().int().positive().max(MAX_STOP_LIMIT).optional(),
  horizonSeconds: z.coerce.number().int().positive().max(MAX_HORIZON_SECONDS).optional(),
});

arrivalsRouter.get(
  '/v1/vehicles/:vehicleId/arrivals',
  asyncHandler(async (req, res) => {
    const params = vehicleParamSchema.safeParse(req.params);
    if (!params.success) {
      sendError(res, new AppError('invalid_request', 'Invalid vehicle id', 400, params.error.flatten()));
      return;
    }
    const query = arrivalsQuerySchema.safeParse(req.query);
    if (!query.success) {
      sendError(res, new AppError('invalid_request', 'Invalid query parameters', 400, query.error.flatten()));
      return;
    }

    const result = await getVehicleArrivals(params.data.vehicleId, {
      stopLimit: query.data.limit,
      horizonSeconds: query.data.horizonSeconds,
    });
    res.status(200).json(result);
  }),
);
