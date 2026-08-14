// Control-strategy rehearsal on a real corridor - web -> control-service,
// service-token authenticated like every other /v1 route.
//
//   POST /v1/route-directions/:routeDirectionId/rehearsal
//     Runs the mesoscopic simulator twice over this corridor's real
//     geometry and real policy - once with no control, once with the
//     deployed control laws - and returns both, the decisions the laws
//     made, and a manifest saying which inputs were measured and which
//     were invented.
//
// READ-ONLY AND SIDE-EFFECT FREE. It issues no command, appends no
// headway_states row, opens no incident and touches no live vehicle state.
// That is not a promise made here but a structural property of what it
// calls: `src/simulation/**` is a pure in-memory computation over
// caller-supplied data, and `src/rehearsal/**` adds only SELECTs.
//
// A corridor with no measured target headway is REFUSED with the same 404
// `no_active_policy` the live headway path raises, from the same reader.
// 561 of the 759 seeded route-directions are in that state, and running a
// simulation against their sentinel would produce a full set of
// confident-looking numbers computed from a denominator that is not a
// measurement.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import { loadCorridorInputs } from '../rehearsal/corridor.js';
import { DEFAULT_MODELLED_INPUTS, REHEARSAL_DISTURBANCES, runRehearsal } from '../rehearsal/run.js';

export const rehearsalRouter = Router();

const paramsSchema = z.object({ routeDirectionId: z.string().min(1) });

/**
 * Bounds on the invented inputs.
 *
 * Every one of them is a refusal, not a clamp. A clamp would quietly run a
 * different simulation from the one that was asked for and return it as if
 * it were the answer - which on a surface whose entire purpose is to be
 * trustworthy about what it modelled is the worst available behaviour.
 *
 * The upper bounds also bound the work: vehicles x stops is the size of the
 * run, and 24 vehicles over the longest seeded corridor (48 stops) is about
 * 1,150 stop visits per arm, which stays inside the request budget.
 */
const bodySchema = z
  .object({
    cruiseSpeedKmph: z.number().min(5).max(120),
    travelTimeVariation: z.number().min(0).max(1),
    boardingRatePerMinute: z.number().min(0).max(120),
    alightingFraction: z.number().min(0).max(1),
    baseDwellSeconds: z.number().min(0).max(600),
    secondsPerBoarding: z.number().min(0).max(60),
    secondsPerAlighting: z.number().min(0).max(60),
    vehicleCapacity: z.number().int().min(1).max(400),
    vehicleCount: z.number().int().min(2).max(24),
    seed: z.number().int().min(0).max(2_147_483_647),
    disturbance: z.enum(
      REHEARSAL_DISTURBANCES as unknown as [string, ...string[]],
    ),
  })
  .partial();

rehearsalRouter.post(
  '/v1/route-directions/:routeDirectionId/rehearsal',
  asyncHandler(async (req, res) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      sendError(res, new AppError('invalid_request', 'Invalid route-direction id', 400, params.error.flatten()));
      return;
    }

    const body = bodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      sendError(res, new AppError('invalid_request', 'Invalid rehearsal inputs', 400, body.error.flatten()));
      return;
    }

    const corridor = await loadCorridorInputs(params.data.routeDirectionId);
    const result = runRehearsal(corridor, {
      ...DEFAULT_MODELLED_INPUTS,
      ...body.data,
      disturbance: (body.data.disturbance ?? DEFAULT_MODELLED_INPUTS.disturbance) as never,
    });

    res.status(200).json(result);
  }),
);
