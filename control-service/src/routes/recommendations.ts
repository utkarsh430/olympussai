// The standing-proposal feed: what the automatic decision cycle currently
// says about every corridor it has looked at.
//
//   GET /v1/recommendations?limit=
//
// ─── THE GAP THIS CLOSES ─────────────────────────────────────────────────
//
// `scheduler/decisionCycle.ts` has run every 90 s since it landed, solving
// every eligible corridor and writing a `recommendations` row. Nothing read
// that table. The only reader of `db/recommendations.ts` in the whole service
// was the cycle itself, whose `findLatestRecommendation` feeds its own
// duplicate check; no route served the table and no console fetched it. So
// everything a dispatcher ever saw came from the SYNCHRONOUS solve taken when
// they opened a corridor themselves - the exact "somebody has to be looking
// at the right corridor at the right moment" problem the automatic cycle was
// built to remove. Its output was written and discarded.
//
// This is the read that gives it a consumer.
//
// ─── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────
//
// Compute anything. It runs no control law and takes no solve; it reads rows
// the cycle already wrote. That is the whole point - a solve per corridor per
// page load would run the control laws across the network every time an
// operator glanced at a list, which is the same reason `/v1/alerts` next door
// does not solve either.
//
// Issue anything. There is no path from this handler to a `commands` row.
// Every row it serves is `status = 'proposed'`, and the response shape cannot
// even carry an approvable candidate: `StandingRecommendation` summarises what
// the row SAID and never ships the `CandidateAction` objects themselves, so a
// console physically cannot render one of these with an approve affordance.
// See `db/recommendations.ts#StandingRecommendation` for why that is a
// structural guarantee rather than a request.
//
// Pretend a stored row is a live one. Every row carries `ageSeconds` measured
// on the database clock and a `freshness` verdict against the same 90 s window
// `mpc/safety.ts` grades a candidate's state by, and the feed carries
// `latestCreatedAt` for the whole table so an empty list can be told apart
// from a controller that has stopped writing.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import { loadEnv } from '../config/env.js';
import {
  findNewestRecommendationCreatedAt,
  listStandingRecommendations,
  RECOMMENDATION_FRESH_WITHIN_SECONDS,
  type StandingRecommendationFeed,
} from '../db/recommendations.js';

export const recommendationsRouter = Router();

/**
 * `limit` is validated for SHAPE here and bounded in the handler, which is a
 * split `/v1/alerts` does not need: its ceiling is a literal in the schema.
 * This one's ceiling is `RECOMMENDATION_FEED_MAX_LIMIT`, an env value, so a
 * second `.max()` here would be a duplicate ceiling that could disagree with
 * the configured one. A nonsense limit is refused; a too-large one is clamped
 * and the response's `totalWithinWindow` says what the page is a slice of.
 */
const feedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

recommendationsRouter.get(
  '/v1/recommendations',
  asyncHandler(async (req, res) => {
    const parsed = feedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'Invalid query parameters', 400, parsed.error.flatten()));
      return;
    }

    const env = loadEnv();
    const maxLimit = env.RECOMMENDATION_FEED_MAX_LIMIT;
    const limit = Math.min(parsed.data.limit ?? maxLimit, maxLimit);

    // The window IS the cycle's own repeat interval, read from the same env
    // value the cycle uses, rather than a second number invented here. See
    // listStandingRecommendations for why those two must not be able to
    // disagree about how long a proposal stands.
    const windowSeconds = env.DECISION_CYCLE_REPEAT_AFTER_SECONDS;

    // Both reads, together: the windowed list and "has the controller written
    // anything at all". The second is not an optimisation to skip when the
    // first comes back non-empty - it is what a console needs to say WHY the
    // list is the length it is, including when that length is zero.
    const [{ recommendations, totalWithinWindow }, latestCreatedAt] = await Promise.all([
      listStandingRecommendations({
        windowSeconds,
        limit,
        freshWithinSeconds: RECOMMENDATION_FRESH_WITHIN_SECONDS,
      }),
      findNewestRecommendationCreatedAt(),
    ]);

    const feed: StandingRecommendationFeed = {
      recommendations,
      windowSeconds,
      freshWithinSeconds: RECOMMENDATION_FRESH_WITHIN_SECONDS,
      totalWithinWindow,
      latestCreatedAt,
      generatedAt: new Date().toISOString(),
    };
    res.status(200).json(feed);
  }),
);
