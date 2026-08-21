// Network-wide controller settings — the switches that change WHAT the
// decision engine optimises, as opposed to route_policies which tunes how
// hard it optimises on one corridor.
//
//   GET /v1/settings
//     The current switches, plus who set them and why.
//   PUT /v1/settings
//     Flip one. Requires an actor and a reason; see below.
//
// ─── WHY A WRITE ENDPOINT NEEDS A REASON ─────────────────────────────────
//
// This is the only writable configuration in this service that changes the
// controller's objective across every corridor at once. `ops_kill_switches`
// in the web app set the precedent for that class of change: engaging and
// disengaging are both attributed, both carry free-text reasons, and neither
// can happen silently. A switch that can be flipped anonymously is one whose
// state nobody can explain a month later, when the only evidence left is that
// the controller has been behaving differently since some Tuesday.
//
// The actor is supplied BY THE CALLER (the web app passes the signed-in
// operator's email) rather than derived here, because this service
// authenticates a service token, not a person - the same reason
// `dispatcher_actions` are mirrored inline by the web app rather than
// resolved from a session this service cannot see.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import { readControlSettings, writeControlSettings } from '../db/settings.js';
import { logger } from '../lib/logger.js';

export const settingsRouter = Router();

const updateSettingsSchema = z.object({
  weighOccupancy: z.boolean(),
  /** Who is making this change. Free text; the web app sends the operator's email. */
  updatedBy: z.string().trim().min(1).max(320),
  /**
   * Why. Required and non-empty for the same reason the kill switch requires
   * one: the value of this row six months from now is entirely in this field.
   */
  updateReason: z.string().trim().min(1).max(2000),
});

settingsRouter.get(
  '/v1/settings',
  asyncHandler(async (_req, res) => {
    res.status(200).json(await readControlSettings());
  }),
);

settingsRouter.put(
  '/v1/settings',
  asyncHandler(async (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'Invalid settings payload', 400, parsed.error.flatten()));
      return;
    }

    const settings = await writeControlSettings(parsed.data);

    // Logged at INFO on every change, never only on the way in. This is the
    // audit trail for a decision that changes the controller network-wide,
    // and the database row only ever holds the LATEST change - the history
    // lives here.
    logger.info(
      {
        weighOccupancy: settings.weighOccupancy,
        updatedBy: settings.updatedBy,
        updateReason: settings.updateReason,
      },
      'control settings changed',
    );

    res.status(200).json(settings);
  }),
);
