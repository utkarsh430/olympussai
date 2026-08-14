// Headway/EWT/CV metrics + reactive bunching incidents - web -> control-
// service, service-token authenticated. Detection and display only: none
// of these handlers ever create a `commands` row or invoke the MPC solver.
//
//   GET /v1/route-directions/:routeDirectionId/headway
//     READ of the latest persisted sample set. This is what a dashboard
//     poll should call.
//   POST /v1/route-directions/:routeDirectionId/headway/compute
//     Computes a fresh sample from current vehicle_states, persists one
//     headway_states row per leader/follower pair, runs the reactive
//     bunching rule, and returns the pair metrics + CV/EWT aggregate +
//     any incident changes.
//
//     The scheduled sweep (scheduler/headwayCompute.ts) is what drives
//     this on a fixed cadence in production; the endpoint remains for
//     manual and test use. A UI must NOT poll it: every call APPENDS to
//     headway_states, which is the exact history the reactive bunching
//     rule reads ("k consecutive samples over threshold"). A dashboard
//     polling compute therefore manufactures the evidence for its own
//     alerts, and two open dashboards would halve the effective detection
//     window. Reads read; writes are the scheduler's job.
//   GET /v1/incidents?routeDirectionId=&limit=
//     Currently open (non-closed) bunching incidents, optionally scoped to
//     one route-direction. `limit`, when given, caps the number of rows
//     returned (most recently-started first) and the response's
//     `totalOpenCount` reports how many actually matched, so a bounded
//     caller can tell it received a slice rather than the full set. Omit
//     `limit` for the original unbounded behavior.
//   GET /v1/route-directions
//     Active route-directions this service knows about, for a dashboard's
//     route-direction picker.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import {
  computeRouteDirectionHeadway,
  countOpenIncidents,
  getIncident,
  getLatestRouteDirectionHeadway,
  listActiveRouteDirections,
  listOpenIncidents,
} from '../headway/service.js';

export const headwayRouter = Router();

const routeDirectionParamSchema = z.object({
  routeDirectionId: z.string().min(1),
});

const incidentsQuerySchema = z.object({
  routeDirectionId: z.string().min(1).optional(),
  // Defensive server-side ceiling. Callers that care about a tighter bound
  // (e.g. the web app's copilot grounding path) clamp further on their own
  // side before ever sending this - this cap only stops a misbehaving or
  // future caller from asking for an unreasonably large slice.
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const incidentIdParamSchema = z.object({
  id: z.string().min(1),
});

headwayRouter.get(
  '/v1/route-directions/:routeDirectionId/headway',
  asyncHandler(async (req, res) => {
    const parsed = routeDirectionParamSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'Invalid route-direction id', 400, parsed.error.flatten()));
      return;
    }
    const result = await getLatestRouteDirectionHeadway(parsed.data.routeDirectionId);
    res.status(200).json(result);
  }),
);

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
    const { routeDirectionId, limit } = parsed.data;
    const incidents = await listOpenIncidents(routeDirectionId, limit);
    // Free when unlimited (the slice IS the total); only issues the extra
    // count query when a limit could actually have left rows out.
    const totalOpenCount = limit === undefined ? incidents.length : await countOpenIncidents(routeDirectionId);
    res.status(200).json({ incidents, totalOpenCount });
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
