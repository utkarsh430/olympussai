import { z } from 'zod';

/**
 * The standing-proposal feed.
 *
 * Mirrors control-service's `StandingRecommendation` / `StandingRecommendationFeed`
 * (GET /v1/recommendations, `control-service/src/db/recommendations.ts`).
 *
 * ─── WHAT THIS IS AND WHY IT IS NOT THE SOLVE RESPONSE ───────────────────
 *
 * `scheduler/decisionCycle.ts` has solved every eligible corridor on a 90 s
 * timer since it landed and written a `recommendations` row each time. Nothing
 * read that table: the only reader of the write module was the cycle's own
 * duplicate check, no route served it and no console fetched it. Everything a
 * dispatcher ever saw came from the SYNCHRONOUS solve taken when they opened a
 * corridor themselves — which is the exact "somebody has to be looking at the
 * right corridor at the right moment" problem the automatic cycle exists to
 * remove. Its output was written and discarded.
 *
 * This is what a stored row looks like coming back.
 *
 * ─── IT IS DELIBERATELY NOT APPROVABLE, AND THAT IS STRUCTURAL ───────────
 *
 * There is no `candidateActions` here, and there will not be. A stored row's
 * `CandidateAction` objects carry a safety verdict graded against the clock at
 * solve time, and `RECOMMENDATION_ACTIONABLE_MS` (90 s, mpc/safety.ts's own
 * bound) is how long that verdict means anything. Nobody reads a list inside
 * 90 seconds of a row being written, so every row an operator sees here is one
 * whose verdict has lapsed or is about to.
 *
 * So the wire carries what the row SAID — the action type, which bus, how long
 * — and a count, and nothing shaped like a candidate. A console cannot render
 * an approve affordance for one of these because it never receives the object
 * such an affordance would act on. That is a stronger guarantee than asking a
 * console not to, and it is why this schema is a summary rather than a subset
 * of the solve response.
 *
 * What an operator acts on is a fresh solve through the existing path
 * (POST /api/ops/control-room/recommendations), which still runs the safety
 * filter against the current clock and still leads into the unchanged
 * dispatcher-approval path. This feed is what tells them to go and take one.
 */

export const paceAdvisorySchema = z.object({
  vehicleId: z.string(),
  routeDirectionId: z.string(),
  action: z.literal('reduce_pace'),
  currentSpeedKmph: z.number(),
  targetSpeedKmph: z.number(),
  scheduleSlackSeconds: z.number().nullable(),
  rationale: z.string(),
});
export type FeedPaceAdvisory = z.infer<typeof paceAdvisorySchema>;

/**
 * Whether a row is still inside the window its own verdict was graded for.
 *
 * `fresh` is NOT "safe to act on" — see the header. It means the automatic
 * cycle said this recently enough that a live solve is likely to still agree.
 * `lapsed` means enough time has passed that nothing has confirmed it.
 */
export const recommendationFreshnessSchema = z.enum(['fresh', 'lapsed']);
export type RecommendationFreshness = z.infer<typeof recommendationFreshnessSchema>;

export const standingRecommendationSchema = z.object({
  id: z.string(),
  routeDirectionId: z.string(),
  routeId: z.string(),
  /** The corridor NAMED. A network-wide list whose reader has chosen nothing cannot show bare uuids. */
  routePublicName: z.string(),
  directionCode: z.string(),
  directionName: z.string().nullable(),
  /** Null is normal, and is the EARLY case the automatic cycle exists for: drift no detector has raised yet. */
  incidentId: z.string().nullable(),
  status: z.string(),
  selectedActionType: z.string().nullable(),
  selectedVehicleId: z.string().nullable(),
  selectedHoldSeconds: z.number().nullable(),
  candidateActionCount: z.number(),
  objectiveCost: z.number().nullable(),
  expectedRecoverySeconds: z.number().nullable(),
  controllerVersion: z.string().nullable(),
  paceAdvisories: z.array(paceAdvisorySchema),
  createdAt: z.string(),
  /** Measured on the control service's database clock, never by subtracting timestamps here. */
  ageSeconds: z.number(),
  freshness: recommendationFreshnessSchema,
});
export type StandingRecommendation = z.infer<typeof standingRecommendationSchema>;

export const standingRecommendationFeedSchema = z.object({
  recommendations: z.array(standingRecommendationSchema),
  /** How far back the feed looked — the decision cycle's own repeat interval. */
  windowSeconds: z.number(),
  /** The age at which `freshness` flips to `lapsed`, published beside the flag it decides. */
  freshWithinSeconds: z.number(),
  /** Corridors with a standing row before the page limit, so a truncated list can say what it is a slice of. */
  totalWithinWindow: z.number(),
  /**
   * The newest row in the whole table, ignoring the window. The one field that
   * stops an empty feed reading as an all-clear.
   *
   * A list of standing proposals empties for two completely different reasons:
   * the controller looked and proposed nothing, or the controller is not
   * running at all. Null means it has never written one; a timestamp older
   * than `windowSeconds` means it has stopped. Neither is good news and a
   * console must say which one it is looking at.
   */
  latestCreatedAt: z.string().nullable(),
  generatedAt: z.string(),
});
export type StandingRecommendationFeed = z.infer<typeof standingRecommendationFeedSchema>;
