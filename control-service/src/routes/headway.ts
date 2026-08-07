// Headway/EWT/CV metrics + reactive bunching incidents - web -> control-
// service, service-token authenticated. Detection and display only: none
// of these handlers ever create a `commands` row or invoke the MPC solver.
//
//   POST /v1/route-directions/:routeDirectionId/headway/compute
//     Computes a fresh sample from current vehicle_states, persists one
//     headway_states row per leader/follower pair, runs the reactive
//     bunching rule, and returns the pair metrics + CV/EWT aggregate +
//     any incident changes. This is the "compute" side of the ticket's
//     "computed ... and queryable via API" acceptance criterion; callers
//     (e.g. the web app's observability dashboard poll) driving this on an
//     interval is what produces the sample history the reactive rule
//     looks back over.
//   GET /v1/incidents?routeDirectionId=
//     Currently open (non-closed) bunching incidents, optionally scoped to
//     one route-direction.
//   GET /v1/route-directions
//     Active route-directions this service knows about, for a dashboard's
//     route-direction picker.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import {
  computeRouteDirectionHeadway,
  getIncident,
  listActiveRouteDirections,
  listOpenIncidents,
} from '../headway/service.js';

export const headwayRouter = Router();

const routeDirectionParamSchema = z.object({
  routeDirectionId: z.string().min(1),
});

const incidentsQuerySchema = z.object({
  routeDirectionId: z.string().min(1).optional(),
});

const incidentIdParamSchema = z.object({
  id: z.string().min(1),
});

headwayRouter.post(
  '/v1/route-directions/:routeDirectionId/headway/compute',
  asyncHandler(async (req, res) => {
    const parsed = routeDirectionParamSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'Invalid route-direction id', 400, parsed.error.flatten()));
      return;
    }
    const result = await computeRouteDirectionHeadway(parsed.data.routeDirectionId);
    res.status(200).json(result);
  }),
);

headwayRouter.get(
  '/v1/incidents',
  asyncHandler(async (req, res) => {
    const parsed = incidentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'Invalid query parameters', 400, parsed.error.flatten()));
      return;
    }
    const incidents = await listOpenIncidents(parsed.data.routeDirectionId);
    res.status(200).json({ incidents });
  }),
);

headwayRouter.get(
  '/v1/incidents/:id',
  asyncHandler(async (req, res) => {
    const parsed = incidentIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'Invalid incident id', 400, parsed.error.flatten()));
      return;
    }
    const incident = await getIncident(parsed.data.id);
    if (!incident) {
      sendError(res, new AppError('incident_not_found', `incident ${parsed.data.id} not found`, 404));
      return;
    }
    res.status(200).json({ incident });
  }),
);

headwayRouter.get(
  '/v1/route-directions',
  asyncHandler(async (_req, res) => {
    const routeDirections = await listActiveRouteDirections();
    res.status(200).json({ routeDirections });
  }),
);
