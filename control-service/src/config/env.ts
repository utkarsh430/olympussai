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
   * Because the rows have no reader. `recommendations` is written by this
   * cycle and read by exactly two things: the cycle's own dedupe fingerprint
   * (src/db/recommendations.ts#findLatestRecommendation) and a retention
   * guard (src/scheduler/retention.ts). No route serves the table and no
   * console fetches it. Until something reads it, turning this on writes
   * rows nobody sees, at a cost in write volume and retention - so the
   * honest default is off, and the flag is here so the decision to start
   * writing them is a deliberate one rather than a side effect.
   *
   * Turn it on when a surface reads `recommendations`. Nothing here issues a
   * command, on or off: every row is `status = 'proposed'`.
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
