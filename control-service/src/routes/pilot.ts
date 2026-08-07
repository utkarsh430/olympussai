// Pilot-staging REST surface — per-route rollout stage, guardrail
// breaches, daily KPI snapshots, and war-room incident review (ticket:
// "Pilot-staging dashboard with per-route rollout gates and daily KPIs").
// Service-token authenticated like every other router in app.ts.
//
//   GET   /v1/rollout-stages                                current stage per active route-direction
//   GET   /v1/route-directions/:id/rollout-stage             one route-direction's stage
//   PUT   /v1/route-directions/:id/rollout-stage              admin sets it (AC1) — takes effect on the very next command, no deploy
//   GET   /v1/route-directions/:id/rollout-stage/audit         stage-change history (AC4)
//   GET   /v1/guardrail-breaches                              real-time breach feed (AC4)
//   GET   /v1/kpi/daily                                       per-route daily EWT/CV/recovery/breaches/compliance (AC2)
//   GET   /v1/war-room/incidents                              the day's incidents + review + measured outcome (AC3)
//   PUT   /v1/war-room/incidents/:incidentId/review            war room records classification/action/outcome (AC3)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import {
  setRolloutStageRequestSchema,
  submitIncidentReviewRequestSchema,
  dailyKpiQuerySchema,
  warRoomQuerySchema,
  guardrailBreachQuerySchema,
} from '../models/pilotSchemas.js';
import { listRolloutStages, getRolloutStage, setRolloutStage, listRolloutStageAudit } from '../pilot/rolloutStages.js';
import { listGuardrailBreaches } from '../pilot/guardrailBreaches.js';
import { listDailyKpiSnapshots } from '../pilot/dailyKpi.js';
import { listWarRoomIncidents, submitIncidentReview } from '../pilot/warRoom.js';

export const pilotRouter = Router();

const routeDirectionIdParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });
const incidentIdParamSchema = z.object({ incidentId: z.string().uuid('incidentId must be a valid UUID') });

pilotRouter.get(
  '/v1/rollout-stages',
  asyncHandler(async (_req, res) => {
    const rolloutStages = await listRolloutStages();
    res.status(200).json({ rolloutStages });
  }),
);

pilotRouter.get(
  '/v1/route-directions/:id/rollout-stage',
  asyncHandler(async (req, res) => {
    const parsedParams = routeDirectionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      sendError(res, new AppError('invalid_request', 'id must be a valid UUID', 400, parsedParams.error.flatten()));
      return;
    }
    const rolloutStage = await getRolloutStage(parsedParams.data.id);
    if (!rolloutStage) {
      sendError(res, new AppError('route_direction_not_found', `route-direction ${parsedParams.data.id} not found`, 404));
      return;
    }
    res.status(200).json({ rolloutStage });
  }),
);

pilotRouter.put(
  '/v1/route-directions/:id/rollout-stage',
  asyncHandler(async (req, res) => {
    const parsedParams = routeDirectionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      sendError(res, new AppError('invalid_request', 'id must be a valid UUID', 400, parsedParams.error.flatten()));
      return;
    }
    const parsedBody = setRolloutStageRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      sendError(res, new AppError('invalid_request', 'Invalid rollout-stage payload', 400, parsedBody.error.flatten()));
      return;
    }
    const rolloutStage = await setRolloutStage(parsedParams.data.id, parsedBody.data);
    res.status(200).json({ rolloutStage });
  }),
);

pilotRouter.get(
  '/v1/route-directions/:id/rollout-stage/audit',
  asyncHandler(async (req, res) => {
    const parsedParams = routeDirectionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      sendError(res, new AppError('invalid_request', 'id must be a valid UUID', 400, parsedParams.error.flatten()));
      return;
    }
    const auditLog = await listRolloutStageAudit(parsedParams.data.id);
    res.status(200).json({ routeDirectionId: parsedParams.data.id, auditLog });
  }),
);

pilotRouter.get(
  '/v1/guardrail-breaches',
  asyncHandler(async (req, res) => {
    const parsed = guardrailBreachQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'Invalid query parameters', 400, parsed.error.flatten()));
      return;
    }
    const breaches = await listGuardrailBreaches(parsed.data);
    res.status(200).json({ breaches });
  }),
);

pilotRouter.get(
  '/v1/kpi/daily',
  asyncHandler(async (req, res) => {
    const parsed = dailyKpiQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'Invalid query parameters', 400, parsed.error.flatten()));
      return;
    }
    const snapshots = await listDailyKpiSnapshots(parsed.data);
    res.status(200).json({ date: parsed.data.date ?? new Date().toISOString().slice(0, 10), snapshots });
  }),
);

pilotRouter.get(
  '/v1/war-room/incidents',
  asyncHandler(async (req, res) => {
    const parsed = warRoomQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'Invalid query parameters', 400, parsed.error.flatten()));
      return;
    }
    const incidents = await listWarRoomIncidents(parsed.data);
    res.status(200).json({ date: parsed.data.date ?? new Date().toISOString().slice(0, 10), incidents });
  }),
);

pilotRouter.put(
  '/v1/war-room/incidents/:incidentId/review',
  asyncHandler(async (req, res) => {
    const parsedParams = incidentIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      sendError(res, new AppError('invalid_request', 'incidentId must be a valid UUID', 400, parsedParams.error.flatten()));
      return;
    }
    const parsedBody = submitIncidentReviewRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      sendError(res, new AppError('invalid_request', 'Invalid review payload', 400, parsedBody.error.flatten()));
      return;
    }
    const incident = await submitIncidentReview(parsedParams.data.incidentId, parsedBody.data);
    res.status(200).json({ incident });
  }),
);
