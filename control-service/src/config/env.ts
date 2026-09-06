// Env var validation. Fails fast (throws) at boot if a required var is
// missing/malformed instead of surfacing a confusing runtime error later -
// same "validate inputs" default the web app applies to request bodies,
// applied here to process.env.
import { z } from 'zod';
import { UPSRTC_LIVE_URL } from '../ingestion/upsrtc/client.js';

/**
 * Env vars arrive as strings, so `z.coerce.boolean()` is unusable here - it
 * treats the string "false" as truthy. This accepts only the four spellings
 * an operator would plausibly write and maps them to a real boolean.
 */
const booleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'));

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // This service's own Postgres/PostGIS datastore. Never the web app's
  // Supabase connection string (docs/CONTROL_SERVICE_INTEGRATION.md section 3).
  CONTROL_SERVICE_DATABASE_URL: z.string().min(1, 'CONTROL_SERVICE_DATABASE_URL is required'),

  // Bearer token the Next.js app sends on web -> control-service REST calls.
  SERVICE_TOKEN_SECRET: z.string().min(16, 'SERVICE_TOKEN_SECRET must be set and non-trivial'),

  // HMAC-SHA256 key used to sign control-service -> web webhook deliveries.
  WEBHOOK_HMAC_SECRET: z.string().min(16, 'WEBHOOK_HMAC_SECRET must be set and non-trivial'),

  // Where signed webhooks are delivered - the web app's inbound handler
  // (docs/CONTROL_SERVICE_INTEGRATION.md section 1, e.g.
  // https://<web-app>/api/control-service/webhook).
  WEB_APP_WEBHOOK_URL: z.string().url().optional(),

  // How often the process-level timer sweeps TTL-expired commands to
  // `expired` (src/index.ts, control_service_expire_commands()). Deliver/
  // ack also expire lazily on access, so this is a backstop for commands
  // nobody happens to touch - it doesn't need to be aggressive.
  COMMAND_TTL_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),

  // How often commandDeliverySweep (src/scheduler/commandDeliverySweep.ts)
  // retries commands stuck in `authorized`. The primary delivery path is
  // now in-process and immediate (POST /v1/commands and .../supersede both
  // attempt delivery inline right after their commit) - this sweep only
  // matters after a crash between that commit and the inline attempt, or a
  // delivery that threw. Set shorter than COMMAND_TTL_SWEEP_INTERVAL_MS's
  // default (30s) simply so a stuck command gets more retry opportunities
  // within its TTL window, not because of any ordering between the two
  // jobs - they never compete for the same row (see scheduler/jobs.ts).
  COMMAND_DELIVERY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),

  // --- Ingestion / scheduler -------------------------------------------
  // How long a NetworkGeometryCache snapshot (active route-direction
  // shapes + their stops + the spatial grid) is served before a background
  // refresh. Geometry only changes when an operator re-runs the seeder, so
  // a stale-by-minutes shape is harmless; re-scanning route_shapes on every
  // position event is not. Doubles as the geometryRefresh job's interval.
  SHAPE_CACHE_TTL_MS: z.coerce.number().int().positive().default(15 * 60_000),

  // In-process GPS poller. Default OFF so exactly one instance of a
  // multi-instance deploy is opted in to polling the upstream feed
  // (otherwise every replica ingests the same 665 fixes).
  GPS_POLL_ENABLED: booleanFromEnv.default(false),
  GPS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  // Defaults to the shared UPSRTC_LIVE_URL constant rather than repeating the
  // literal: the seeder and the poller must never drift onto different
  // endpoints. Set GPS_POLL_URL only to point the poller somewhere else (a
  // replay fixture, a staging mirror) without moving the seeder too.
  GPS_POLL_URL: z.string().url().default(UPSRTC_LIVE_URL),
  /** A fix older than this is dropped rather than ingested - a stale fix must not resurrect a vehicle that has since gone dark. */
  GPS_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(300),

  // Headway compute sweep. Detection latency for the reactive bunching
  // rule is required_samples x HEADWAY_COMPUTE_INTERVAL_MS x
  // ceil(eligible / HEADWAY_BATCH_SIZE) - see src/scheduler/headwayCompute.ts.
  HEADWAY_COMPUTE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  HEADWAY_BATCH_SIZE: z.coerce.number().int().positive().default(60),
  /** Concurrent computeRouteDirectionHeadway calls. Pool max is 10; this leaves headroom for /v1 request traffic. */
  HEADWAY_COMPUTE_CONCURRENCY: z.coerce.number().int().positive().default(4),
  /** A vehicle_states row older than this doesn't count toward "this route-direction has a live pair". */
  HEADWAY_VEHICLE_FRESHNESS_SECONDS: z.coerce.number().int().positive().default(300),

  // ── Predictive bunching detection (src/headway/riskForecast.ts) ───────
  //
  // Projects each pair's forward headway forward in time and raises a
  // `predicted` incident before the gap collapses. Rides on the existing
  // headway sweep - it reads the samples that sweep already wrote and adds
  // one indexed query per pair, rather than introducing a second sweep.

  /**
   * How far ahead the forecast projects, as a MULTIPLE of the corridor's
   * target headway.
   *
   * Not a fixed number of seconds: the natural clock of a bunching process is
   * the headway itself, and a horizon that suits a 10-minute corridor makes
   * the tier structurally silent on a 30-minute one - which is this network's
   * median. See `forecastHorizonSeconds` in src/headway/riskForecast.ts for
   * the derivation and for the floor and ceiling that bound it.
   *
   * One headway of look-ahead is the span over which the current gap
   * structure plays out. Raise it to catch slower divergence at the cost of
   * more speculative alerts; lower it for a tier that only speaks about
   * imminent collapses.
   */
  BUNCHING_FORECAST_HORIZON_MULTIPLE: z.coerce.number().positive().default(1.0),

  BUNCHING_FORECAST_SAMPLE_WINDOW: z.coerce.number().int().positive().default(10),

  /**
   * Master switch for the predictive tier.
   *
   * Opt-out rather than opt-in: the reactive rule is unaffected either way,
   * and a corridor with too few samples to fit a trend already reports
   * nothing, so the failure mode of leaving this on is silence rather than
   * noise. Turn it off to compare alert volumes with and without prediction
   * during a pilot.
   */
  BUNCHING_PREDICTION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Whether the closed-form cost-optimal hold may be SELECTED, as opposed to
   * merely generated and shown.
   *
   * ─── WHY THIS DEFAULTS OFF ─────────────────────────────────────────────
   *
   * `optimalHoldSeconds` minimises the passenger-cost objective exactly, so a
   * `cost_optimal_hold` candidate will essentially always outrank the
   * tuned-gain laws on `objectiveCost` - it is the argmin of the very
   * function the ranking sorts by. Leaving it selectable would therefore not
   * be "adding a fourth option"; it would silently replace the entire
   * controller with the closed form, on every corridor, the moment it
   * shipped.
   *
   * That replacement is not yet earned, and the reason is bigger than lambda.
   *
   * The closed form's exchange rate between the time of passengers waiting and
   * the time of passengers aboard is lambda, currently PROXIED as 1/H* (see
   * `arrivalRatePaxPerSecond`). It was long assumed that fitting lambda from
   * real boardings was the precondition for turning this on. MEASURED against
   * simulated outcomes over 20,423 holds (HANDOFF.md section 7), it is not:
   *
   *   - the objective's COST side is accurate to about 17%
   *   - its BENEFIT side sees 1.4% of the waiting time a hold actually
   *     removes, and 10% with a correctly fitted lambda
   *   - so on the corridor where holding demonstrably helps, the objective
   *     reports it as a net COST
   *
   * The residual after calibration is the HORIZON, not the rate:
   * `lambda x d x (d + h_fwd - h_bwd)` estimates one stop's worth of a benefit
   * that accrues along the whole downstream route and to every following bus.
   * The argmin of a function that can see a tenth of the benefit will always
   * choose a hold near zero, so turning this on would not merely replace the
   * tuned gains - it would switch mid-route holding off.
   *
   * So: do NOT turn this on when lambda is fitted. Turn it on when the
   * objective's predicted benefit matches a measured one - which needs a
   * multi-stop wait term - and re-run the fleet trial across all three
   * corridors before and after. Until then the candidate is generated,
   * scored, safety-filtered and returned in `candidateActions` on every solve,
   * visible and auditable against what the gains chose, and the honest state
   * is that the two approaches disagree in the open and a human can see by
   * how much.
   */
  COST_OPTIMAL_SELECTION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Whether the four laws that never had one apply a self-harm check: refusing
   * to emit a hold their own objective scores as net harmful, exactly as
   * `mpc/costOptimalHold.ts` already does.
   *
   * OFF, and it should stay off. This is an instrument, not a fix.
   *
   * The gap it closes is real. With occupancy weighting on, the mean
   * `objectiveCost` of the candidates the controller actually SELECTS is
   * +1,021.4 passenger-seconds on urban, +1,874.0 on suburban and +4,271.4 on
   * inter-city - thousands of instructions the controller prices as harmful on
   * its own reading, with the one law that would have declined them silent
   * because it is not selectable (see COST_OPTIMAL_SELECTION_ENABLED above).
   *
   * The check inherits that objective's error whole. Its benefit term is a
   * ONE-STOP marginal estimate and sees 1.4% of the waiting time a hold really
   * removes, so on urban it reports a net cost on the corridor where holding
   * demonstrably works. MEASURED with this on, across all three corridors and
   * both occupancy phases, total passenger time - the GUARDRAIL - gets worse
   * every time, and on urban the controller stops holding almost entirely:
   * two-way coverage 3,325 -> 3 generating decisions. Full table in
   * docs/SELF_HARM_CHECK.md.
   *
   * Turn it on when the objective's predicted benefit matches a measured one -
   * which needs a multi-stop wait term, not merely a calibrated lambda - and
   * re-run all three corridors before and after. Same precondition, and the
   * same reason, as COST_OPTIMAL_SELECTION_ENABLED.
   *
   * MULTI_STOP_WAIT_TERM_ENABLED below is half of that precondition and moves
   * this measurably - with both on and occupancy weighted, urban goes from 246
   * holds to 3,309 and total passenger time from +0.17% to +1.62%, against
   * +0.68% unchecked. Still not the condition: that measures the GUARDRAIL and
   * not excess wait, and the other half is lambda.
   * docs/MULTI_STOP_WAIT_TERM.md section 7.
   */
  SELF_HARM_CHECK_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Whether the objective's waiting term is summed over the stops a hold's
   * correction is actually experienced at, instead of only the control point
   * the hold is issued from.
   *
   * OFF by default, and off is byte-identical: with this false nothing
   * supplies `mpc/objective.ts#PassengerCostInputs.downstreamStopCount`, a
   * null horizon prices as 1, and 1 is today's term exactly.
   *
   * ─── WHAT IT CHANGES ──────────────────────────────────────────────────
   *
   *   w_h x lambda x d x (d + h_fwd - h_bwd)   ->   ... x N
   *
   * where N is the stops the held vehicle still has to serve, counting the
   * one it is standing at. Reference architecture 2.2's waiting term is
   * `SUM_s` over stops; `mpc/objective.ts` evaluated it at one, which its own
   * header has always said. A hold does not move a headway at one stop - the
   * held bus arrives d later at every stop it has left, and the passengers at
   * all of them experience `h_fwd + d` and `h_bwd - d`. The derivation, and
   * why the perturbation is carried forward with no decay coefficient, is in
   * that file's header.
   *
   * ─── WHY IT IS WORTH DOING, AND WHAT IT DOES NOT FIX ──────────────────
   *
   * MEASURED (19 scenarios x 3 seeds x 120 vehicles, all three corridors, both
   * occupancy phases - full tables and reproduction in
   * docs/MULTI_STOP_WAIT_TERM.md). The objective's cost side is accurate to
   * 12-17%; its benefit side sees 1.3-3.0% of the waiting a hold actually
   * removes. The horizon is most of that error - it multiplies the benefit
   * term by the stops downstream, 13.5 on urban, 9.1 on suburban, 6.5 on
   * inter-city - and it is measured to be the right size: the wait term goes
   * to 14-16% of the truth, i.e. the shortfall divided by the horizon is O(1).
   * No decay coefficient, because three measurements of that residual give
   * three different orderings across the corridors and a decay constant is
   * exactly a claim about that ordering.
   *
   * It is NOT the whole fix, and this must not be read as one. The other
   * factor is lambda: `arrivalRatePaxPerSecond` proxies it as 1/H*, which is
   * 7.2x (urban) to 11.4x (inter-city) below the rate the corridor sees. The
   * two multiply - with a fitted lambda as well the wait term lands at
   * 117-177% of the measured truth. A positive multiplier CANNOT flip a sign
   * on its own, so on its own this flag does not make an occupancy-weighed
   * hold price as beneficial (urban's selected mean objectiveCost goes
   * +1,297.5 -> +1,135.5, and to +42.4 only with lambda), and it leaves the
   * occupancy-BLIND share of candidates priced >= 0 identical to the digit.
   *
   * It also does not touch terminal dispatch, and the reason is worth
   * recording because it looked like the same defect and is not. An
   * unclamped terminal hold sets d = H* - h_fwd, and with no bus observed
   * behind, `computePassengerCost` substitutes h_bwd = H*; the bracket
   * `d + h_fwd - h_bwd` is then EXACTLY zero, because under that substitution
   * the hold merely swaps the two gaps rather than evening them. Measured:
   * 47-49% of terminal candidates score exactly 0.0 and 97% score >= 0, on all
   * three corridors and under both occupancy phases, with and without this
   * flag. A positive multiplier leaves zero at zero. That is the
   * neutral-backward assumption at the origin, not the horizon, and it is the
   * cheapest remaining item on this objective.
   *
   * So: turn this on together with a calibrated lambda, re-run all three
   * corridors both phases across seeds, and only then revisit
   * COST_OPTIMAL_SELECTION_ENABLED and SELF_HARM_CHECK_ENABLED - which wait
   * on "the objective's predicted benefit matches a measured one", a
   * condition this flag advances and does not complete.
   */
  MULTI_STOP_WAIT_TERM_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Whether the mid-route laws may act on a pair the ordinary action bar
   * declines, when this corridor's own FORECAST says that pair is
   * deteriorating toward the bar.
   *
   * OFF, and off is a true no-op: with this false
   * `mpc/actionThreshold.ts#isPairActionable` is `isWorthActingOn` and the
   * forecast field is not read at all (`test/forecastActionGate.test.ts` pins
   * that equality over the whole ratio range).
   *
   * ─── THE GAP IT CLOSES ────────────────────────────────────────────────
   *
   * `headway/riskForecast.ts` has projected every pair's forward headway
   * since the predictive detection tier shipped, and until now DETECTION was
   * its only consumer: `HeadwayStateRow` carried no forecast field, so no
   * control law could read one. The system could predict a corridor coming
   * apart and had no way to act on the prediction.
   *
   * ─── WHY A GATE AND NOT A LOOSER BAR ──────────────────────────────────
   *
   * Acting earlier INDISCRIMINATELY is already measured and it costs:
   * loosening the mid-route bar from 50% to 75% of H* moved excess wait 51%
   * -> 56% and spent total passenger time 3.3% -> 1.9%. A bar cannot tell a
   * pair heading for a bunch from a pair that is merely a little early and
   * would have re-spaced on its own, so it buys both and charges the second
   * group's holds to everyone aboard. `MID_ROUTE_ACTION_RATIO = 1.2` already
   * took the half of that trade that did not spend the guardrail (12
   * out-of-sample paired seeds), so there is no more timing to be had by
   * moving a bar. A forecast can tell the two groups apart, which is the only
   * mechanism in this codebase that could buy more timing without the cost.
   *
   * ─── WHY IT IS OFF: IT WORKS, AND IT SPENDS THE GUARDRAIL ─────────────
   *
   * Measured against the CURRENT 0.6 bar - the comparison that matters, since
   * comparing against the old 0.5 would credit the gate with a win already
   * shipped. 19 scenarios x 250 vehicles/phase at 12 PAIRED base seeds per
   * corridor, both rows on the identical corridor and the identical bar, 95%
   * bootstrap intervals over the seed-level differences. Full tables,
   * headline-scoped re-runs and reproduction in
   * `docs/FORECAST_ACTION_GATE.md`.
   *
   *   corridor    excess wait (headline)         total passenger time (GUARD)
   *   urban       +0.23pp [-0.24, +0.73]  6/12   -0.24pp [-0.27, -0.20]  12/12
   *   suburban    +2.12pp [+1.53, +2.72] 12/12   -0.37pp [-0.41, -0.34]  12/12
   *   intercity   +2.64pp [+2.19, +3.06] 12/12   -0.16pp [-0.18, -0.14]  12/12
   *
   * The mechanism is reachable and it is not cosmetic: it buys 4-22% more
   * holds, and on suburban and inter-city those are real spacing gains with
   * every seed agreeing. But total passenger time worsens on EVERY corridor
   * with 12/12 agreement, and the guardrail is a constraint here rather than
   * a term in a ratio - a proposal that worsens it is not an improvement, so
   * the headline gains do not qualify. The cost is not an artefact of the
   * saturated scenario either; it survives re-running over each corridor's
   * own `headlineScope`.
   *
   * On URBAN - the corridor where holding demonstrably works - it buys
   * nothing at all: the headline effect spans zero with seeds splitting 6/12,
   * while still paying the guardrail.
   *
   * ─── THE SECOND FINDING, WHICH MATTERS AS MUCH AS THE FIRST ───────────
   *
   * A forecast helps LEAST where control works best and MOST where the
   * corridor is most disturbed - the OPPOSITE of the prior model, which said a
   * forecast is worth least on a `too_disturbed` corridor because corrections
   * there wash out. Measured (band from `lib/controllability.ts`):
   *
   *   corridor    sigma_leg/H*  band            gate buys
   *   urban       0.096         controllable    +0.23pp, spans zero
   *   suburban    0.100         controllable    +2.12pp
   *   intercity   0.187         too_disturbed   +2.64pp
   *
   * Do NOT read that as "dispersion drives it". Urban and suburban are 0.004
   * apart and both controllable, and the gate buys nothing on one and
   * +2.12pp on the other. What orders all three is the headroom left in the
   * baseline excess-wait gain (50.97% / 38.30% / 17.95%). Both are three-point
   * patterns and this trial cannot separate them; what it establishes is the
   * negative, and that negative should be the starting point for anyone
   * choosing where to try a forecast-driven mechanism next.
   *
   * ─── WHAT WOULD CHANGE THE ANSWER ─────────────────────────────────────
   *
   * A LOWER action bar (the gate's reachable population is the band between
   * the bar and what the forecast can see), or a forecaster that speaks more
   * often (it declines on r-squared, sample count and window today, and
   * passes no dwell model).
   *
   * There is also an OPEN QUESTION, recorded here and not answered: whether
   * total passenger time should ever be traded against excess wait at some
   * rate rather than held as a constraint. On inter-city this gate's trade is
   * +2.64pp for -0.16pp, about 16:1, against the 3.6:1 of the 50%->75% bar
   * loosening that was rejected. That is a service-policy decision for the
   * captain, of the same kind as whether alighting-only may be offered at
   * all - not a simulation result, and nothing here argues for it. The number
   * is on record only so it is available if the question is ever put.
   */
  FORECAST_ACTION_GATE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Whether terminal dispatch prices an unobserved bus behind against the
   * LEADER'S DEPARTURE rather than against the standing vehicle's own
   * position.
   *
   * OFF by default, and off is byte-identical: with this false
   * `mpc/terminalDispatch.ts` asks for the `'vehicle'` anchor,
   * `computePassengerCost` substitutes `h_bwd = H*` exactly as it always has,
   * and no other law asks for the other anchor at all.
   *
   * ─── THE DEFECT ──────────────────────────────────────────────────────
   *
   * An unclamped terminal hold is `d = H* - h_fwd`, and with nothing observed
   * behind - the ordinary case at an origin - the neutral substitution is
   * `h_bwd = H*`. The objective's bracket is then
   *
   *   d + h_fwd - h_bwd  =  (H* - h_fwd) + h_fwd - H*  =  0,  EXACTLY.
   *
   * Under that substitution the hold does not even the two gaps, it SWAPS
   * them - `(h_fwd, H*)` becomes `(H*, h_fwd)`, whose second moment is
   * identical - so it is priced at precisely zero. MEASURED: 47-49% of all
   * terminal candidates score exactly 0.0 and ~97% score `>= 0`, on all three
   * corridors, under both occupancy phases, with and without
   * MULTI_STOP_WAIT_TERM_ENABLED (a positive multiplier leaves zero at zero).
   * `>= 0` is true of zero, so every guard keyed on that comparison declines
   * them - and terminal dispatch is the one lever in this system with no cost
   * to anybody aboard, because the bus has not started its trip and nobody is
   * on it. docs/MULTI_STOP_WAIT_TERM.md section 5; full evidence for this
   * flag, including what it is measured NOT to fix, in
   * docs/ORIGIN_BACKWARD_NEUTRAL.md.
   *
   * ─── WHAT IT CHANGES ─────────────────────────────────────────────────
   *
   * The neutral value, and nothing else. At an origin `h_fwd` is elapsed time
   * since the leader pulled out - a fixed observed instant - and the bus
   * behind has not departed, so the neutral claim is that the departures
   * either side of this one fall on target: `h_bwd = 2 x H* - h_fwd`. The
   * gaps then go `(h_fwd, 2H* - h_fwd) -> (H*, H*)` at the on-target hold,
   * evened rather than swapped, and the wait term becomes
   * `-w_h x lambda x d^2` - a benefit, quadratic in the hold. DERIVED from
   * the target the law already regulates, with no fitted constant anywhere in
   * it; `mpc/actionThreshold.ts`'s docblock records why this codebase
   * declines those. Full derivation in `mpc/objective.ts`'s header.
   *
   * ─── WHAT IT DOES NOT CHANGE ─────────────────────────────────────────
   *
   * Not a single decision, on its own. `objectiveCost` gates nothing on the
   * deployed defaults: terminal dispatch generates its candidate on `rawHold`
   * and has absolute priority in `selectActions`, so with
   * SELF_HARM_CHECK_ENABLED and COST_OPTIMAL_SELECTION_ENABLED both off this
   * flag moves the PRICE and no coverage, hold length, guardrail or headline
   * figure. What it fixes is the price those two knobs would read - which is
   * why it is a precondition for them and not a controller change.
   *
   * It is also measured NOT to be sufficient, and that is the useful half of
   * the result. Occupancy-blind a terminal hold is priced as a benefit only
   * when `lambda x N x d > 1`; under the 1/H* proxy at N = 1 that needs a hold
   * longer than H*, and a terminal hold is bounded by `H* - h_fwd`. So the
   * share of terminal candidates priced `>= 0` goes 100.0% -> 100.0% with this
   * flag alone, 68.6% / 94.7% / 97.1% with MULTI_STOP_WAIT_TERM_ENABLED as
   * well, and 12.3% / 29.3% / 67.0% with a fitted lambda on top. The zero, the
   * horizon and lambda are three factors on one term. Flip them together.
   */
  ORIGIN_BACKWARD_NEUTRAL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Whether the decision cycle PERSISTS pace guidance alongside the holds it
   * already writes to `recommendations`.
   *
   * OFF, and off is a true no-op: with this false the decision cycle writes
   * exactly the rows it wrote before, on exactly the same conditions, and
   * `pace_advisories` stays `[]` on every one of them.
   *
   * ─── WHAT THIS DOES AND DOES NOT TURN ON ─────────────────────────────
   *
   * It does NOT turn pace guidance on. `mpc/paceGuidance.ts` runs on every
   * solve regardless, and the control room has been rendering its output
   * under "Alternatives that cost no delay" since it shipped - a dispatcher
   * asking about one corridor already gets this advice today, flag or no
   * flag. Turning this off does not take that away, and turning it on does
   * not change a single control law.
   *
   * What it turns on is the AUTOMATIC half. The gap is the same one
   * `decisionCycle.ts` was built to close for holds: the advice existed only
   * for the corridor a human happened to be looking at. Pace guidance is
   * still on the wrong side of that gap, and worse than holds are - because
   * the cycle returns early whenever no hold was selected, which is exactly
   * the case where easing a bus off is the ONLY thing worth saying. A bus
   * running early and closing on its leader is often correctly refused a
   * hold (it would breach the lateness bound) and is precisely the bus that
   * should ease off.
   *
   * ─── WHY IT IS OFF DESPITE COSTING NOTHING ───────────────────────────
   *
   * It was off because the rows had no reader at all: `recommendations` was
   * written by this cycle and read by exactly two things, the cycle's own
   * dedupe fingerprint (src/db/recommendations.ts#findLatestRecommendation)
   * and a retention guard (src/scheduler/retention.ts). No route served the
   * table and no console fetched it.
   *
   * That is no longer true - `RECOMMENDATION_FEED_ENABLED` below mounts
   * `GET /v1/recommendations`, which the web app's standing-proposal panel
   * reads - but this stays off, because the reader is off too and because
   * these two are separate decisions. This one governs how much the cycle
   * WRITES; that one governs whether anything reads it. Turning this on
   * while the feed is off still writes rows nobody sees.
   *
   * The feed does surface `paceAdvisories` when both are on. Nothing here
   * issues a command in any combination: every row is `status = 'proposed'`.
   */
  PACE_GUIDANCE_ON_DECISION_CYCLE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // ── Decision cycle (src/scheduler/decisionCycle.ts) ───────────────────
  //
  // Asks the controller what to do, on a timer, instead of only when a
  // dispatcher opens the console. Writes `recommendations` rows with status
  // 'proposed'; it never issues a command.
  //
  // 90 s rather than the headway sweep's 60 s: a decision is only as fresh
  // as the headway state it reads, so solving faster than that state is
  // recomputed spends database connections re-deriving the same answer.
  // Slightly out of phase with it on purpose, so the two sweeps do not
  // contend for the pool on the same tick.
  DECISION_CYCLE_INTERVAL_MS: z.coerce.number().int().positive().default(90_000),
  DECISION_CYCLE_BATCH_SIZE: z.coerce.number().int().positive().default(60),
  // Lower than HEADWAY_COMPUTE_CONCURRENCY: each solve issues its own
  // queries (active commands, schedule curves, open incidents, the insert)
  // against a pool that maxes out at 10, and /v1 request traffic has to keep
  // getting through while this runs.
  DECISION_CYCLE_CONCURRENCY: z.coerce.number().int().positive().default(3),
  // How long standing advice may go un-repeated before an unchanged
  // recommendation is written again. Keeps a long-running situation leaving
  // a periodic trace that the controller is still watching it, without
  // writing a near-identical row every cycle - see
  // src/db/recommendations.ts#isMateriallyNewRecommendation.
  DECISION_CYCLE_REPEAT_AFTER_SECONDS: z.coerce.number().int().positive().default(900),
  // Opt-out, like the KPI snapshot and retention sweeps: set to 'false' to
  // return to the previous behaviour where a recommendation exists only for
  // the corridor a dispatcher is looking at.
  DECISION_CYCLE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Whether the decision cycle skips corridors outside `CONTROLLABLE_BAND`
   * instead of spending its batch on them.
   *
   * OFF, and off is a TRUE no-op: with this unset the cycle does not merely
   * behave the same, it never issues the band query at all
   * (`test/decisionCycleEligibilityGate.test.ts` pins that).
   *
   * ─── WHY THE GATE IS WORTH HAVING ───────────────────────────────────────
   *
   * The same laws measure +2.9% total passenger time on the urban corridor,
   * +0.5% on suburban and zero on inter-city, and what separates them is
   * `lib/controllability.ts`'s sigma_leg / H*. This network's median planned
   * headway is 1,800 s. A corridor under control costs dispatcher attention,
   * driver instructions and control-room load whether the holds help or not,
   * so running outside the band is operational effort spent for nothing - and
   * `DECISION_CYCLE_BATCH_SIZE` is 60 against an eligible set larger than
   * that, so those slots are taken from corridors that could have benefited.
   * `pnpm sim:eligibility` reports exactly which corridors this would exclude.
   *
   * ─── WHY IT IS NOT ON ───────────────────────────────────────────────────
   *
   * The band is a ratio of sigma_leg, and sigma_leg is
   * `meanLeg / cruiseSpeed x travelTimeVariation`. Nothing on this network has
   * recorded a stop visit yet, so both of those come from the two settings
   * below rather than from a fit, and a corridor's band is currently a
   * property of two assumed numbers. Turning this on would silence the
   * controller on real corridors on the strength of an assumption. Fill
   * `stop_visits`, confirm `sim:eligibility` reports `measured` provenance,
   * and re-read the report before flipping it.
   */
  DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Whether `GET /v1/recommendations` is mounted - the read that gives the
   * decision cycle's stored proposals a consumer at last.
   *
   * OFF, and off is a TRUE no-op: `createApp()` does not mount the router,
   * so the path 404s exactly as it did before this existed, no query is ever
   * issued, and no other handler's behaviour changes by a byte.
   * `test/recommendationFeedRoute.test.ts` pins that.
   *
   * ─── WHAT IT IS FOR ─────────────────────────────────────────────────────
   *
   * `scheduler/decisionCycle.ts` has solved every eligible corridor on a 90 s
   * timer and written a `recommendations` row the whole time, and until this
   * endpoint the only thing that ever read one back was the next cycle's own
   * duplicate check (`db/recommendations.ts#findLatestRecommendation`). No
   * route served the table and no console fetched it, so everything a
   * dispatcher saw came from the SYNCHRONOUS solve taken when they opened a
   * corridor themselves - which is the very thing the cycle exists to stop
   * being the only path. The automatic controller's output was written and
   * discarded.
   *
   * ─── WHY IT IS NOT ON BY DEFAULT ────────────────────────────────────────
   *
   * Not because the read is risky - it writes nothing, runs no control law,
   * and its response shape deliberately cannot carry an approvable candidate
   * (see `db/recommendations.ts#StandingRecommendation`). Because the two
   * halves deploy separately: the web app has its own switch of the same name
   * and there is no ordering of two independent deploys in which one is not
   * briefly ahead of the other. Off on both is the state where neither half
   * can be surprised by the other, and turning the pair on is then a
   * deliberate act rather than a deploy-order accident.
   *
   * Nothing here issues a command, on or off. Every row it serves is
   * `status = 'proposed'` and reaches a bus only through a dispatcher
   * approval and POST /v1/commands.
   */
  RECOMMENDATION_FEED_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * How many corridors' standing proposals one page of the feed asks for.
   *
   * A ceiling for the same reason `/v1/alerts` has one: this read spans the
   * network rather than a corridor an operator has already narrowed to, so
   * "however many there are" is not a safe answer to serialise into a
   * browser. `DECISION_CYCLE_BATCH_SIZE` is 60, so one sweep cannot produce
   * more standing rows than that; 200 leaves room for the batch size to grow
   * without the cap becoming the thing that truncates the list.
   */
  RECOMMENDATION_FEED_MAX_LIMIT: z.coerce.number().int().positive().default(200),
  /**
   * The running-time assumptions the band is decided on when a corridor has no
   * fitted link travel times - which today is every corridor.
   *
   * Defaults are `rehearsal/run.ts#DEFAULT_MODELLED_INPUTS`, so the gate and
   * the report place a corridor in the same band the simulator would. They are
   * settings rather than constants precisely because they are assumptions: the
   * verdict is sensitive to them, and an operator must be able to see how
   * sensitive before trusting it (`sim:eligibility --travel-time-variation`).
   */
  ELIGIBILITY_CRUISE_SPEED_KMPH: z.coerce.number().positive().max(120).default(35),
  ELIGIBILITY_TRAVEL_TIME_VARIATION: z.coerce.number().min(0).max(1).default(0.12),

  /**
   * An open incident is only reported while at least one of its two member
   * vehicles has reported a position within this window.
   *
   * WHY AN OPEN INCIDENT CAN OUTLIVE ITS OWN EVIDENCE. An incident is closed
   * in exactly one place - `rule.recovered` in src/headway/service.ts - and
   * reaching it requires the pair to be RECOMPUTED, which in turn requires
   * the route-direction to still have two vehicles fresher than
   * HEADWAY_VEHICLE_FRESHNESS_SECONDS (listRouteDirectionsWithLiveHeadwayPairs).
   * When those buses stop reporting - a depot going offline, or this service
   * being stopped overnight - the pair is never revisited, recovery is never
   * evaluated, and the row stays `open` forever. Left unbounded on the read
   * side that is not a slow leak but an unbounded one: a single week-long gap
   * left 30,619 undead incidents that the control room drew as bunching
   * between buses hundreds of kilometres apart, on week-old positions.
   *
   * Bounding on `started_at` instead would be wrong in the opposite
   * direction - it would hide a genuine incident precisely because it has
   * lasted a long time, which is when it matters most. Liveness is a property
   * of the evidence, not of the incident's age, so it is measured on the
   * member vehicles' last fix.
   *
   * Deliberately more generous than HEADWAY_VEHICLE_FRESHNESS_SECONDS: that
   * one gates a computation that reruns every sweep and can afford to be
   * tight, whereas this one makes an incident appear and disappear in an
   * operator's face, and must not flicker for a bus that merely missed a poll.
   */
  INCIDENT_VEHICLE_FRESHNESS_SECONDS: z.coerce.number().int().positive().default(900),

  /**
   * How long a pair may go without a fresh headway sample before the sweep
   * closes its open incident.
   *
   * WHY AN INCIDENT NEEDS AN EXPIRY AT ALL. Detection is a standing sweep over
   * every corridor, but an incident is an INTERVAL, and until this existed it
   * had only one way to end: `rule.recovered` in src/headway/service.ts, which
   * requires that exact leader/follower pair to be recomputed. A pair stops
   * being a pair for entirely ordinary reasons - a third bus moves between
   * them, the follower finishes its trip, the corridor drops below two fresh
   * vehicles - and from that moment the recovery rule is never evaluated
   * again. Measured on the pilot database: 9,692 open incidents, of which 172
   * (1.8%) had been evaluated in the last five minutes. The other 96% were
   * undead, and the control room drew every one of them as a bunching link
   * between buses a median of 59 km apart.
   *
   * Closing on this bound does NOT stop either bus being watched. Both stay
   * under the same sweep, `findOpenIncidentForPair` only ever matches
   * non-closed rows, and a pair that closes up again opens a new incident on
   * the next cycle - which is the honest record: two intervals, not one that
   * never ended.
   *
   * Comfortably longer than one compute cycle x required_samples so a corridor
   * that merely missed its turn in the round-robin is never closed out from
   * under an operator who is still looking at it.
   */
  INCIDENT_PAIR_SAMPLE_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(1_800),
  /** How often the staleness sweep runs. Cheap: one indexed anti-join, bounded by INCIDENT_STALENESS_SWEEP_BATCH. */
  INCIDENT_STALENESS_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  /**
   * At most this many incidents closed per sweep tick. A first run against a
   * database that has been accumulating undead rows for days has thousands of
   * candidates; draining them over several ticks keeps one tick from holding
   * the pool while ingestion is trying to use it.
   */
  INCIDENT_STALENESS_SWEEP_BATCH: z.coerce.number().int().positive().default(500),

  // ── Retention ────────────────────────────────────────────────────────────
  //
  // Nothing in this service used to delete anything, so every table grew for
  // as long as the process ran: ~270k headway_states rows a day (~120 MB),
  // forever, to serve a bunching rule that reads the last THREE rows per pair
  // and a live API that looks back 900 seconds. Retention is what makes "this
  // system runs on live data" a standing property instead of a manual purge.
  //
  // THE SNAPSHOT IS WHAT MAKES PRUNING SAFE, AND THE ORDER MATTERS. A past
  // day's KPIs live in daily_kpi_snapshots (see src/pilot/dailyKpi.ts), which
  // is computed FROM the raw rows. Delete the raw before the snapshot exists
  // and that day's numbers are gone permanently - there is nothing left to
  // recompute from. So retention never deletes a day's headway_states until
  // that day's snapshot has been written; see src/scheduler/retention.ts.
  RETENTION_ENABLED: booleanFromEnv.default(true),
  RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  /** headway_states older than this are pruned - once their day is snapshotted. */
  HEADWAY_STATE_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
  /** A vehicle dark this long stops being a dot on the map. Bounded anyway: vehicle_states is keyed on vehicle_id. */
  VEHICLE_STATE_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
  /** Incidents are kept longer than raw samples - they are the product history, and are thousands of rows, not millions. */
  INCIDENT_RETENTION_DAYS: z.coerce.number().int().positive().default(3),
  /**
   * How often each day's KPI snapshot is refreshed. Must be comfortably more
   * frequent than HEADWAY_STATE_RETENTION_HOURS or the sweep would be racing
   * the pruner for the same day's rows - the `exists` guard in retention.ts
   * makes losing that race harmless rather than lossy, but a job that is
   * routinely too late would simply stop anything from ever being pruned.
   */
  DAILY_KPI_SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().default(900_000),

  /**
   * When true, /readyz reports 503 until the network geometry is actually
   * seeded (at least one active route_direction with a route_shape).
   * Without a shape every fix short-circuits to `off_route`, so the
   * instance is structurally incapable of a correct answer even though
   * every query "succeeds". Defaults on everywhere except tests, whose
   * createApp() suites run without a database.
   */
  REQUIRE_SEEDED_NETWORK: booleanFromEnv.optional(),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  // Render-provided build-time var; falls back for local dev.
  RENDER_GIT_COMMIT: z.string().optional(),
});

// REQUIRE_SEEDED_NETWORK's default depends on another field (NODE_ENV),
// which a per-field `.default()` cannot express - resolve it here so the
// exported Env type still carries a plain `boolean`.
const envSchema = baseEnvSchema.transform((env) => ({
  ...env,
  REQUIRE_SEEDED_NETWORK: env.REQUIRE_SEEDED_NETWORK ?? env.NODE_ENV !== 'test',
}));

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clear the cached env so a test can reload with different values. */
export function _resetEnvCacheForTests(): void {
  cached = undefined;
}
