# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Layout

Two independent pnpm packages, each with its own `node_modules`/lockfile/test suite/db: the Next.js app at the repo root (`src/`), and `control-service/` (Express + Postgres/PostGIS, deployed separately). Run `pnpm install` in both before `pnpm typecheck`/`pnpm lint`/`pnpm test` work in either — root only covers the web app; `control-service/`'s suite mocks the DB per-test, no Postgres needed to run it.

`pnpm test:coverage` (`vitest run --coverage`, `@vitest/coverage-v8`) is wired in both packages and both suites are fully green under it.

The web app's suite is the opposite: `src/tests/unit/*Db.test.ts` prove the guarantees that live in SQL rather than TypeScript (keyset pagination not losing safety records, `ON CONFLICT` dedupe) and need a real `OPS_DATABASE_URL`. They skip when it is unset locally and hard-FAIL when `CI=true` - `.github/workflows/ci-web.yml` gives its lint/typecheck/test job an `ops-db` service and runs `pnpm migrate:ops` against it, so nothing in `pnpm test` skips in CI. That guard exists because those files skipped on every CI run this repo had ever done, which made a green suite say nothing about the SQL it was supposed to be protecting; never "fix" a skip by relaxing it.

The web app's own datastore (`db/migrations/`, applied via `OPS_DATABASE_URL=... pnpm migrate:ops`) is separate from `control-service/db/` by design — see `docs/CONTROL_SERVICE_INTEGRATION.md` section 3 for why, `db/README.md` for the migration runner's guarantees (one transaction per file, checksum drift detection, idempotent `IF NOT EXISTS` SQL), and `control-service/src/config/env.ts` / `.env.example` for connection vars. Both Postgres instances in local dev are shared Docker containers another process may depend on — never assume you own them; prove a new migration idempotent against a scratch container, not the shared one.

## Local dev: run both halves, and boot them in order

The web app alone is not a working stack. Every ops dashboard reads control-service, and a missing one does not fail loudly — the consoles render "The control service did not answer, so this list is unknown - not empty", which reads like a data problem rather than a process nobody started. The root `dev` script (`scripts/dev.sh`) starts both halves, waits for both databases first, and tears the pair down together; `dev:web` / `dev:control` run one alone.

Waiting for the databases is the point of it. control-service rehydrates its in-memory state exactly once at boot and never retries (`control-service/src/index.ts`), so an instance started before its Postgres is reachable — or before `control-service/db/migrations/` is applied (`pnpm --dir control-service migrate` — its own runner, `control-service/src/db/migrate.ts`, with the same per-file-transaction and checksum-drift guarantees the web app's has) — parks at `/readyz` -> `rehydrationStatus: "failed"` permanently: ingestion fails closed, so it takes in nothing, while every read endpoint still answers 200 off the tables. It looks alive while the GPS pipeline is dead. So when a surface looks empty rather than wrong, read `/readyz` before suspecting the data — `/healthz` is liveness only and stays green throughout — and fix it by restarting the process, never by waiting for it to recover.

## Ops RBAC: middleware is a ceiling, route guards are the decision

`src/middleware.ts` and every `/api/ops/*` route handler both check roles, independently — middleware's check (via `rolesForOpsApiPath` / `OPS_API_ROLE_OVERRIDES` in `src/lib/auth/rbac/roles.ts`) is a coarse, edge-safe approximation; `requireOpsRole(...)` inside the route handler (`src/lib/auth/rbac/guard.ts`) is the real, narrow, authoritative allowlist. When a route's `requireOpsRole` allowlist is wider than (or undeterminable from) its URL segment alone, add an entry to `OPS_API_ROLE_OVERRIDES` rather than loosening the segment-derived default — it is matched on exact pathname (never a prefix) and must only ever widen a segment's role, never re-home an endpoint to an unrelated one (enforced by a guard test in `src/tests/unit/rbac.test.ts`). Pages (`/ops/<segment>/*`) stay on strict segment equality; only `/api/ops/*` uses the override map.

Every route-level test mocks `@/lib/auth/rbac/guard` itself (proves the route calls `requireOpsRole` with the right allowlist, not that the function does the right thing with it). `src/tests/unit/opsRoleGuard.test.ts` is the one file that imports the real `guard.ts`, mocking only its two dependencies (`./server`, `@/lib/auth/publicPreview`) — it is where the 403-on-wrong-role decision itself is pinned.

## Detection has two tiers, and they share one incident row

`headway/bunching.ts` holds both. The REACTIVE rule (`evaluateBunchingRule`) is an observation — k consecutive samples with `h_fwd/H*` under a threshold. The PREDICTIVE rule (`evaluatePredictiveRule`, fed by `headway/riskForecast.ts`) is an extrapolation — a least-squares fit of `h_fwd` against time, projected to a horizon derived from the corridor's own headway (`forecastHorizonSeconds`, ~1×H* bounded to 300–2700s; a fixed horizon makes the tier structurally silent on this network's 1800s median). Both write ONE `bunching_incidents` row per pair on one ladder (`types.ts#SEVERITY_RANK`: predicted < warning < bunched < severe), so a prediction that comes true escalates in place.

Three rules that are easy to get wrong and are each pinned by a test in `test/predictedIncidentLifecycle.test.ts`:
- A `predicted` incident must NEVER close on `rule.recovered`. Its gap never collapsed, so `recovered` is true from the moment it opens — wiring it that way shuts every prediction on the sweep that created it, and the failure is invisible (rows get written, logged, and vanish).
- A null risk is "the forecaster declined to speak", not "no risk". It must neither open nor close anything: a corridor whose GPS went quiet has not been observed to improve.
- Severity only moves UP. A calmer forecast must not de-escalate a measured `warning` back to `predicted`.

`headway_states.forecast_h_fwd_seconds` existed from the core data model and was NULL on every row ever written, because `insertHeadwaySample` never named it. It is now written from the risk fit.

## The alert inbox: absence of evidence is not an all-clear

`GET /v1/alerts` (network-wide, ranked worst-and-soonest-first in SQL — the ordering IS the triage) backs `/ops/control-room/alerts`. Before it, an incident reached a human only if somebody had already opened the console on that exact corridor, out of ~1,020.

The inbox distinguishes three states that a naive implementation collapses into one: nothing wrong / nothing read yet / feed unreadable. `src/lib/controlService/alerts.ts` serves the last good feed flagged `stale` rather than an empty list on an outage, because an empty alert list reads as an all-clear. `src/tests/unit/alertInbox.test.tsx` is where that rule is enforced — do not "simplify" those branches into one empty state. The stale-fallback path only actually triggers once the fresh TTL cache entry has expired while `lastGood` is still populated; `_resetAlertCacheForTests()` wipes both, so a test using it to "force expiry" is exercising a normal cache hit, not the fallback — `src/tests/unit/controlRoomAlerts.test.ts`'s `vi.useFakeTimers()` test is the one that genuinely reaches it.

Solving is deliberately NOT done on the list. A solve carries a 90s freshness verdict from the safety filter, so solving every corridor per render produces a page of silently-lapsed proposals. The operator asks per alert (`AlertSolutionPanel`), and issuing still goes through the console's approval path — never duplicated.

## Alighting-only: the one lever that fixes bunching by REMOVING delay

`mpc/boardingLimit.ts` proposes "let people off, take nobody on" on the LEADER of a bunched pair — note the inversion, every other law acts on the follower. In a bunch the leader absorbs all the demand, and its own long dwells are what drag it late and let the follower close; cutting its boarding dwell lets it recover while the follower collects who was left. It reuses the existing `boarding_limit` command type, so no new command vocabulary was needed — but that moved it out of the "instructions nothing generates" set, which the depot console and control-room console both derive by subtracting `ENGINE_ACTION_TYPES`. Both updated with no edit; that derivation is why.

Four guards, each of which a live solve proved necessary: at least as bunched as the corridor's own `bunchedThresholdRatio` (never a constant — a hardcoded 0.35 was *looser* than the 0.25 default, firing on pairs the corridor did not call bunched); an ABSOLUTE 240s cap on how long anyone waits (a ratio would permit 450s on a 1800s corridor); a 30s floor (a live solve produced a 0.675s "gap" — one position reported twice); and one proposal per vehicle (a live solve named the same bus three times, because `db/rehydrate.ts` keeps the latest sample per (leader, follower) across *all* history, so stale pairings survive until the first sweep).

It is proposed, never auto-selected, and its `objectiveCost` is 0 — unpriced, not free. Neither side of its trade can be priced: the cost needs lambda, the benefit needs a fitted dwell model. Zero is only safe because `solver.ts` excludes it from `safeMidRoute`; ranked, zero would sort FIRST.

**It is also switched OFF on every corridor, and turning one on is a row not a deploy.** `route_policies.alighting_only_enabled` (default false) gates whether a corridor may be OFFERED these proposals, with `alighting_only_max_refusals` / `alighting_only_refusal_window_seconds` as a non-nullable refusal tripwire beside it — there is no configuration that enables the law with no bound on it. Measured on urban over 16 paired phase-seeds it is worse on every axis (excess wait +3.6 pts 16/16 seeds, total passenger time +0.24 pts 14/16, +1,295 refused boardings 16/16), matching Delgado, Munoz & Giesen (2012); on suburban and inter-city it costs passenger time outright. But the reason it ships off is not the measurement — the cost of this action falls VISIBLY on a person at a kerb, so whether the trade is acceptable is a service-policy decision, not a simulation result.

Three things about that gate a future session will otherwise get wrong. It is applied in `solver.ts` BEFORE `candidateActions`, not further down: `safeCandidates` is not an audit list, the control-room console renders everything in it as an approvable alternative (`EngineRecommendationPanel`), so gating any later leaves the corridor withheld from one surface and issuable from another. `computeBoardingLimitCandidates` itself is deliberately UNCHANGED, so the fleet trial — which reaches the law through `rehearsal/deployedControlLaws.ts` and has its own `alightingOnlySelectable` switch, not a `route_policies` row — is byte-identical with the gate in place, and coverage still reports what the lever WOULD do on a corridor nobody has switched on. And the tripwire counts ISSUED INSTRUCTIONS from `commands`, not people: nothing here counts the people a bus refuses (`headway/deniedBoarding.ts` answers "cannot say" on every visit today), so it bounds the action count and CANNOT bound the harm — one instruction at a busy interchange can cost more than six at a quiet kerb.

## Never render a proxy-derived passenger count

`arrivalRatePaxPerSecond` returns `1/H*`, so any passenger figure derived from it lands between 0 and 1 whatever the corridor or hour — a live solve produced `0.0007`. That is an artefact, not an imprecise estimate. `BoardingLimitEstimate.leftBehindPassengers` is therefore `null` while `lambdaIsProxy`, so a surface *cannot* render "about 1 passenger" at a stop where forty people are waiting. Show `leftBehindWaitSeconds` instead — it is measured. Same rule applies to anything else derived from lambda.

## The occupancy switch, and why OFF is not the timid choice

`control_settings.weigh_occupancy` (network-wide singleton, `db/settings.ts`, `PUT /v1/settings`, toggled at `/ops/control-room/alerts`) gates the objective's in-vehicle term. It is enforced at `objective.ts#liveOnboardCount` — the one place that already answers "is there a load worth weighing?", so one check covers all four laws and none of them learns about the switch.

OFF the objective is exactly the operator's two stated priorities: even spacing, and the timetable delay bunching causes. ON is the dangerous direction, not the kind one — see the loaded-gun note below. The read is cached 10s, never caches a failure, and falls back to OFF: it sits on the solver's hot path, which had no database read before it, and a settings hiccup must not silence the controller network-wide.

The `predictiveAdvisory` deliberately ignores the switch — it decides nothing and exists to show what an occupancy-weighted ranking *would* say, which is the question the switch poses.

## Evaluating the controller: one clock, and coverage next to the KPIs

`control-service/src/evaluation/` (`pnpm --dir control-service sim:run`, docs at `docs/CONTROLLER_EVALUATION.md`) runs the DEPLOYED laws in the mesoscopic simulator across corridors x scenarios x seeds and reports two halves. Both halves exist because of the same incident.

`simulation/engine.ts` advances every vehicle on ONE clock. It used to run one vehicle's complete trip at a time, which meant the bus behind had not been simulated when the bus in front decided, so `ControllerKinematics.trailer` was always null, `h_bwd` was always null, and `mpc/twoWayHold.ts` declined every pair it was ever offered. Every simulated run measured the self-equalizing fallback alone and nothing said so — a sweep over `kf`/`kb` returned a flat surface whose obvious reading ("this parameter does nothing") was exactly wrong. So: never reintroduce a vehicle-major loop, and read the **algorithm-coverage** half of any report before believing its KPI half. `test/evaluation/harness.test.ts` fails if two-way coverage returns to zero.

Four rules the harness enforces and a reader should not undo: EWT is the headline and headway CV is a **diagnostic** (CV is scale-free, so lengthening every headway uniformly "improves" it) - but **total passenger time is a GUARDRAIL**, because a sweep optimising EWT alone will recommend a setting that buys spacing with everybody's time, and measured, loosening the mid-route action bar from 50% to 75% of H* does exactly that (excess wait 50% -> 55% better, net passenger time +4.1% -> +2.1%); every difference is paired by seed and reported with a bootstrap interval, and one whose interval spans zero is no effect however large its mean; and a corridor where >20% of offered passengers are denied gets a **saturation warning**, because there waiting time is bounded by seats rather than spacing and a working controller reports "no effect".

One formula, one place: `lib/dispersion.ts` holds the second-moment EWT/CV arithmetic and `headway/metrics.ts`, `headway/stopHeadway.ts` and `simulation/kpi.ts` all call it — `simulation/**` may not import `../headway/*`, which is why it lives in `lib/`. Do not re-derive it locally; the simulator's old first-moment copy silently understated exactly the long gaps bunching produces. `lib/controllability.ts` is there for the same reason: sigma_leg/H\* is the first thing to read in any result and both harnesses need it, but neither may import the other. `evaluation/` computed it not at all, so a `sim:run` reader could not tell whether a bad number was about the laws or about a corridor outside the band — its own synthetic fixture sits at 0.17, `too_disturbed`.

**Excess wait is sampled at EVERY STATION in both harnesses.** `simulation/kpi.ts` samples at control points, which is right for a regression fixture and wrong for a passenger question — and it ties the metric to the action, so changing where holds may happen moves the measurement. `rehearsal/run.ts#reportedKpis` feeds the rehearsal AND all of `evaluation/`, and sampled at control points until measured: on the evaluation corridor that understated uncontrolled EWT by 1.4x and **reversed the verdict**, from "48% worse" to "no effect".

**Algorithm A regulates an ELAPSED departure headway, never `h_fwd`.** It used to read `h_fwd`, and could therefore never fire: `dwelling_at_stop` means speed < 2 km/h, `computePairHeadways` floors speed at `MIN_SPEED_KMPH = 1`, so a 7.7 km gap gave `h_fwd = 27,601s` against a 900s target and `rawHold` was always negative. `h_fwd` is a CLOSING time and a bus at the origin is not closing on anything; the quantity blueprint 8.2 regulates is how long since the previous bus pulled out, now read from `stop_visits.departed_at` via `headway/repository.ts#loadLastStopDeparture`. A null departure declines — never fall back to `h_fwd`. Note that terminal dispatch has absolute priority in `selectActions` and suppresses the mid-route laws for any bus at the terminal, so this CHANGED which buses get held rather than only adding holds.

**Demand can be fitted without ticketing data.** `pnpm sim:run --calibrate` (`evaluation/calibrate.ts`) fits `dwell = beta_0 + beta_h x h_preceding` from `stop_visits`, then derives `lambda = beta_h / beta_b` — because boardings ≈ lambda x h, the fitted slope IS the compound quantity. `beta_b` (seconds per boarding) is the one assumed number and every derived rate scales inversely with it; alighting fraction and capacity stay modelled. The same fit yields `1 + beta_h`, the headway amplification eigenvalue that says whether a corridor needs control at all. `mpc/objective.ts` still proxies lambda as `1/H*` — wiring the fitted value in is a live-control-law change and has not been made.

## Headway is measured against the corridor's pace, not a bus's own speed

`headway/metrics.ts` converts a gap in METRES into a gap in SECONDS, and the
divisor cannot be the vehicle's instantaneous speed. A bus standing at a stop
reports ~0, which the old `MIN_SPEED_KMPH = 1` floor turned into a headway of
hours - and standing at a stop is the ONLY state a hold can be executed from
(`mpc/eligibility.ts`), so the system asked "how bunched is this pair?" at
exactly the moment its own estimator could not answer. The same pair 4 km apart
read h_fwd 240 s while moving and 14,400 s while dwelling: bunched, then "fine".
Across a 1,000-bus trial this silenced 95% of two-way holding and cut the
excess-wait gain from 44% to 10%. It is the same arithmetic that made Algorithm A
unable to fire (`test/terminalDispatch.test.ts`); that law was given a measured
departure headway and the mid-route laws were left on the broken divisor.

A stationary vehicle is now measured against `corridorPaceKmph` - the median
speed of the vehicles that ARE moving. A moving one keeps its own speed. When
nothing on the corridor is moving the headway is null, "no opinion", never a
fabricated large number. Do not reintroduce a constant floor.

## A hold has to be worth its cost, and two guards say so

`mpc/actionThreshold.ts`. The mid-route laws are proportional controllers, so
they proposed for ANY shortfall: 83% of holds went to pairs above the corridor's
own `warning_threshold_ratio` - pairs its alert surface would never have raised.
`isWorthActingOn` declines below that bar. The bar is the corridor's own ratio
scaled by `MID_ROUTE_ACTION_RATIO`, which is **1.2** — so with the seeded
`warning_threshold_ratio` of 0.5 it sits at 0.6 of H*, just ABOVE the alert bar
rather than exactly on it. That multiplier is where a change to the action bar
belongs: `warning_threshold_ratio` also drives the detector, so moving the
corridor config to get the same effective bar would silently change what
operators are alerted about (measured: identical control results, different
alert surface). Read the constant's docblock before changing it — it carries the
12-seed out-of-sample evidence and the argument, and the weaker fitted 0.8 that
was rejected before it. Terminal dispatch is deliberately NOT gated: it holds a
bus nobody is aboard yet.

`occupancyAdjustedMaxHoldSeconds` makes the load bind on the ACTION. The occupancy
switch could not: it feeds `objectiveCost`, a RANKING input, and the mid-route
laws are mutually exclusive so there is never a second selectable candidate to
reorder - across 4,960 matched decisions it changed the price of every hold and
none of the decisions. Measured, holding removed 2,251 h of waiting and added
4,214 h of onboard delay: total passenger time 12% WORSE while excess wait
improved 46%. Read `docs/FLEET_TRIAL.md` before changing either guard.

## The fleet trial is where a control change gets its evidence

`control-service/src/fleetTrial/`. Console at `/ops/control-room/simulator`,
long-form findings in `docs/FLEET_TRIAL.md`, operational handover in `HANDOFF.md`.

    pnpm --dir control-service sim:fleet --corridor urban --vehicles 250
    pnpm --dir control-service test              # the whole suite, no Postgres needed
    npx vitest run test/fleetTrial/              # from control-service/

Layout: `corridor.ts` builds a synthetic corridor; `presets.ts` holds the three
shapes and the demand that belongs to each; `scenarios.ts` is nineteen ways a corridor
comes apart; `detection.ts` replays the DEPLOYED detector at the live 60 s sweep
cadence; `run.ts` orchestrates both arms, both phases and the policy sweeps;
`types.ts` is the wire contract (mirrored by Zod in `src/models/fleetTrial.ts`).

The control laws are IMPORTED from `src/mpc/*` and `src/headway/*` through
`rehearsal/deployedControlLaws.ts`, never reimplemented. That adapter is where
fidelity bugs live: it has repeatedly flattered production by giving the laws an
input production does not have. Check it first when a law's coverage looks wrong.

### Invariants the simulator must preserve

- **Total passenger time is the headline, not EWT, and it means the WHOLE
  journey.** Every second from arriving at a stop to alighting, counted once:
  kerb wait, dwell, hold, riding. It meant waiting + hold for most of this
  trial's life, which is the wrong half - holding is the only in-vehicle term
  control makes worse, and the two it left out (passenger-weighted dwell, which
  is worst in a bunch, and riding) move the other way and are comparable in size.
  The percentage was wrong with it: dividing by a denominator that was waiting
  time alone inflated every result, positive and negative, four- to sevenfold.
  Read `passengerSecondsPerBoardingSavedPercent` beside it - the arms do not
  serve identical crowds, because demand is drawn from the stop-clock each arm's
  buses actually sweep.
- **Every draw takes a stream of its own**, keyed by (seed, purpose, vehicle,
  stop) - `simulation/rng.ts#drawStream`. On one shared stream the two arms
  shared inputs only until the first hold, because a hold changes how many
  draws are taken and in what order; a single ONE-SECOND hold on one bus of 250
  moved whole-network passenger time by 2%, which was the size of the effects
  being measured. Never reintroduce a single stream, and never add a draw whose
  key can collide with another's.
- **Report the seed spread, never a single run.** The trial's own headline is one
  seed per scenario. Over six seeds at 250 buses/phase: urban +2.9% +/- 0.3
  (6/6 seeds positive, range 2.5-3.3), suburban blind +0.5% +/- 0.3 (6/6), and
  inter-city is zero to within +/- 0.5. A single `sim:fleet` number is one draw.
- **Nobody may vanish.** A passenger a full bus refuses stays in the queue; one
  who arrives while a bus stands at the stop boards it. Both used to be deleted
  and both deletions flattered holding - the first hid stranding, the second gave
  a held bus free load. Each reversed a conclusion when fixed. The queue is swept
  only as far as a bus actually served it (`engine.ts`), and a stop's queue
  starts when its FIRST BUS ARRIVES, never at second zero.
- **The timetable is booked from the uncontrolled arm's own arrivals**, not from
  free-flow arithmetic. A schedule the corridor cannot keep makes every bus late,
  so `max_lateness_seconds` refuses every hold and the guardrail switches the
  controller off silently. Measured: that cost 33 points of excess-wait gain.
  `scheduleFit` is the tripwire, and it is decided on the SHARE OF BUSES ALREADY
  PAST THE BOUND with no control - never on the mean deviation, which booking
  from the mean makes exactly zero and which therefore could not fire at all.
- **The chain handed to the control laws is ranked by POSITION and carries every
  live vehicle**, exactly as `state-estimation/ordering.ts` and
  `headway/service.ts` build it. Ranked by dispatch order it named a leader that
  was physically behind on up to 4.8% of decisions, and `computeGapMeters` folded
  each into a near-whole-corridor gap. Sliced to three vehicles, `corridorPaceKmph`
  had no moving vehicle to take a median over and 9% of pairs reported no forward
  headway at all. Never hand the laws a neighbourhood; hand them the corridor.
- **One second of stop-clock belongs to one bus.** Two buses stand at one stop
  routinely - the arrival clamp enforces separation, not a berth - and each was
  drawing its own passengers from the same seconds. Claim the standing window at
  ARRIVAL, from the queue front, never at departure.
- **Denied boardings are a HEADCOUNT** (`firstTimeDeniedBoardings`). One person
  turned away by three buses is three refusal EVENTS, and the two arms repeat at
  different rates, so an event count is not comparable across them.
- **Excess wait is sampled at EVERY station**, not the designated holding points.
  Tying it to them made baseline EWT read 61 s with two holding points and 323 s
  with ten on the identical uncontrolled corridor.
- **A scenario is a perturbation, so its inputs are MULTIPLIERS** (`inputScale`),
  never absolute values. Absolute overrides tuned for one corridor inverted on
  another - `peak_load` became the lightest scenario the urban corridor ran.
  The same rule reaches window PLACEMENT: place against
  `modelledArrivalSecondsTo`, which counts dwell, not `freeFlowSecondsTo`,
  which does not. On the urban preset the difference is ten minutes by
  mid-route - nearly two headways - so any window shorter than that placed on
  free flow is a window the target bus never enters.
- **`vehiclesPerPhase` is split ACROSS scenarios, so scenario count costs
  statistical power and not runtime.** Nineteen scenarios at the default 500
  give each 26 buses per arm, and the per-scenario sign flips freely there:
  four scenarios reversed between 500 and 2,000 buses over the same six seeds.
  Screen with the default; run `--vehicles 2000` before calling any single
  scenario a controller failure. Test fixtures must size themselves per
  scenario (`BUNCHING_SCENARIOS.length * 4`) or they silently thin out as the
  library grows.
- **What predicts the result is one number**: the standard deviation of a single
  leg's running time as a fraction of H*. Below ~0.03 nothing comes apart; above
  ~0.16 more deviation accumulates between two stops than a hold at either can
  remove. Inter-city sits at 0.19 and gains least, urban at 0.10 gains most.
  Report it (`controllability`) before crediting or blaming the laws.
- **Policy knobs are per-corridor.** `max_lateness_seconds` and holding-point
  count run OPPOSITE ways on urban and inter-city. The trial sweeps them per
  corridor rather than baking in a winner. Do not fork the algorithm by corridor
  type - the laws are identical on all three shapes and the predictor above is a
  continuum, not three buckets.

### Attacking the estimator, not only the corridor

`simulation/types.ts#Disturbance` carries `gps_bias` (a feed that is PRESENT and
WRONG - constant offset, growing drift, or `freeze`, which republishes the last
fix with a current timestamp) next to `gps_dropout` (a feed that is absent).
They are different failures and only one of them is handled: staleness is a
named rejection reason in `mpc/safety.ts`, and nothing anywhere refuses a fresh,
well-formed, self-consistent fix that is half a kilometre wrong.

`gps_bias` moves ONLY what the controller is told - the deciding vehicle's own
reported position and its whole reported chain, coherently, since a corridor
that held two positions for one bus is a thing no real feed can do. It never
moves the bus. `test/simulation/engine.test.ts` pins both halves; without the
first, every estimator scenario would be confounded with the ordinary "make a
bus late" disturbances the library already has.

An estimator attack therefore CANNOT raise the uncontrolled arm's bunching rate,
because that arm never reads the estimator. It is the one exception to "a
scenario the uncontrolled arm sails through is not hard", and its hardness shows
as the controlled arm's gain collapsing instead.

### Conventions learned the hard way

- **One seed is not a measurement.** Net passenger time has a ~10-point
  seed-to-seed spread. A `Kb` result that convinced over three seeds was a coin
  flip over ten; an alighting-only result reversed entirely once a queue bug was
  fixed. Compare PAIRED by seed, report how many seeds agreed with the sign, and
  treat a mean whose seeds disagree as no effect however large it is.
- **Prefer a config sweep to a code change.** Most levers here are
  `route_policies` columns. A value fitted on one corridor and shipped for all is
  the single commonest error in this area.
- **The headline is far more sensitive to corridor dispersion than to demand.**
  Holding demand fixed and sweeping `travelTimeVariation` alone moves the
  excess-wait improvement about an order of magnitude more than an equivalent
  swing in the invented boarding rate does - see the `travel_time_variation`
  row in `fleetTrial`'s `policyStudies` (re-runnable) and `docs/FLEET_TRIAL.md`
  ("What the trial still does not test") for the measured figures. The bunching
  result IS robust to demand; it is not robust to dispersion.
- **An ad-hoc `npx tsx` script against control-service needs env vars** -
  `src/config/env.ts` validates at import. Set `CONTROL_SERVICE_DATABASE_URL`,
  `SERVICE_TOKEN_SECRET` and `WEBHOOK_HMAC_SECRET` to any syntactically valid
  values; nothing connects.
- **A test that fails after a model change is evidence, not an obstacle.**
  `test/simulation/controllers.test.ts` broke on a queue fix; investigating showed
  its fixture gave the controller ~60 s of hold across an entire run and a 50%
  win rate. It was measuring noise. The fixture was made unstable enough to
  measure the law, not the assertion loosened.
- **Check the engine against arithmetic, not only against itself.** With both
  randomness sources off the corridor is deterministic and its steady state is
  writable in advance; `test/fleetTrial/` asserts headways come out EXACTLY on
  target. Two simulated arms cannot catch an error they share.

## WHERE the controller runs is a separate question from HOW it decides

`pnpm --dir control-service sim:eligibility` (`evaluation/eligibility*.ts`,
long form in `docs/CORRIDOR_ELIGIBILITY.md`) places every ACTIVE
route-direction against `lib/controllability.ts`'s band and returns one verdict
each: `eligible`, `out_of_band`, `uncalibrated`, `too_few_vehicles`. The band
is IMPORTED, never re-derived - a second copy of `CONTROLLABLE_BAND` is how it
drifts from the sweep it was fitted on, and a test pins that.

Measured on the seeded network, of the 78 corridors the decision cycle actually
reaches, **26 (33%) are outside the band** and account for 24% of the
recommendations written. Outside the band a hold costs full operational effort
- dispatcher attention, driver instructions, control-room load - and returns
nothing, and `DECISION_CYCLE_BATCH_SIZE` is 60, so those slots come out of the
corridors that could have benefited.

`DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED` acts on it and ships OFF, filtering
BEFORE the batch is cut (filtering after would still spend the slots) and
failing OPEN. **It is off because the band is currently an assumption, not
because the finding is weak.** sigma_leg is `meanLeg / cruiseSpeed x
travelTimeVariation`; `stop_visits` is empty network-wide, so both of those come
from `DEFAULT_MODELLED_INPUTS` and the report's own sensitivity table moves
`too_disturbed` from 0 to 112 corridors across a 5x span of the assumed
variation. Read `inputs_provenance` in the report before believing any verdict,
exactly as you read algorithm coverage before believing a KPI. Until it reads
`measured`, this is a rollout PRIORITY ORDER and not a licence to switch
corridors off.

## The objective's lambda is a proxy, and it is a loaded gun

`mpc/objective.ts#arrivalRatePaxPerSecond` returns `1/H*`. Under that proxy the closed-form optimum's load penalty is `H*/2 seconds PER ONBOARD PASSENGER` — 900s on a 1800s corridor — so a single passenger zeroed any hold. That gun went off: three fleet trials (urban/suburban/intercity) each reported `lawCoverage` of exactly **0** for `cost_optimal` in the occupancy-weighed phase against 310–578 in the blind phase of the same trial, and it failed silently exactly as predicted.

`mpc/costOptimalHold.ts` therefore passes `loadPassengers: null` to `optimalHoldSeconds` — the load binds on the ACTION via `actionThreshold.ts#occupancyAdjustedMaxHoldSeconds` (which can shorten a hold and can never invert one), never on the argmin. `optimalHoldSeconds` itself is unchanged and still charges the full penalty; it is a faithful argmin and is the right answer the day lambda is measured. Never feed it the live load again.

That fixed the argmin, NOT the silence. The SCORE still carries `w_v x L x d` in real passenger-seconds while the wait term it is netted against is scaled by the same understated lambda, so `cost_optimal` — alone among the five laws in checking its own objective — still declines above a handful of passengers. Measured on urban (`H*`=360): the law emits only up to **L=1** at a 540–720s spread and L=3 even at an absurd 1440s spread, against a ~29 steady-state load, so trial `lawCoverage` is still 0. Do NOT "finish the job" by dropping the load from the score too: every law prices through the same `computePassengerCost`, so that would hand this one a systematically lower cost than the candidates it is sorted against — the sort it must not win until lambda is measured. Two remedies were named here: calibrating lambda, or giving the other four laws the same self-check. **The second has been measured and it is the wrong reading of the evidence** - `SELF_HARM_CHECK_ENABLED` (default off, `mpc/selfHarmCheck.ts`, full table and reproduction in `docs/SELF_HARM_CHECK.md`).

**Read the +1,021 figure (urban; +1,874 suburban, +4,271 inter-city) as the OBJECTIVE being wrong, not the controller being harmful.** That is the single most important thing on this page about this number, because the opposite reading is the intuitive one and it is false. Those same holds are measured to SAVE passengers time: on urban they are worth +4.69% of total passenger time, the guardrail. The objective calls them harmful because its benefit term sees only **1.4%** of the waiting time a hold actually removes - `lambda x d x (d + h_fwd - h_bwd)` is a ONE-STOP marginal estimate of a benefit that accrues over twenty-five downstream stops and to every following bus - so on urban, the corridor where holding demonstrably works, **it reports the wrong sign**. A guard keyed to that number does not decline harmful holds; it declines holds whose benefit the objective cannot see.

Measured, that is exactly what happens. With the check on and occupancy weighting on, the controller stops holding: urban 2,086 holds -> 3 and total passenger time +4.69% -> +0.02%, suburban and inter-city issue ZERO holds on every seed. Occupancy-blind it halves the holds (urban 1,839 -> 868) and costs 2.5-4.3 points of excess-wait gain - the headline - while raising the guardrail by about a third of a point on urban and suburban. That last is a real effect and it is still the wrong trade: total passenger time is a CONSTRAINT that was already comfortably satisfied at +4.20%, so spending the headline to raise it further is optimising the tripwire instead of the target. And `terminal_dispatch` is silenced in **18 of 18** runs regardless of the occupancy switch, because the objective charges `w_c` for standing still at the origin against a wait term it cannot see; that is the one lever with no punctuality cost at all, which is the clearest sign the check is measuring the objective's error rather than the action's harm.

**`boarding_limit` structurally cannot take this check.** Its `objectiveCost` is a sentinel `0` meaning "neither side of this trade is priced", not "this breaks even" - and `>= 0` is true of zero, so wiring the predicate in would decline 100% of alighting-only proposals on every corridor forever, deleting a law on the strength of a placeholder. `test/selfHarmCheck.test.ts` pins that so nobody "finishes the job".

**The real fix is a MULTI-STOP WAIT TERM, and half of it now exists.** `MULTI_STOP_WAIT_TERM_ENABLED` (off, `mpc/objective.ts`, evidence in `docs/MULTI_STOP_WAIT_TERM.md`) sums the wait term over the stops a hold's correction is experienced at rather than the one it is issued from - N = stops the vehicle has left, no decay coefficient, because two honest measurements of the residual REVERSE its ordering across the three corridors and three points that swap rank cannot fit one. It takes the wait term from 1.3-3.0% of the truth to 14-16%, moves `cost_optimal` off zero under occupancy weighting (urban 1 -> 582 generated against 46,750 occupancy-blind), and takes the self-harm check from 246 holds to 3,309 on urban. It fixes NEITHER the sign NOR terminal dispatch, and both reasons are measured: a positive multiplier cannot flip a net sign (occupancy-blind, the share of candidates priced >= 0 is identical to the digit with and without it), and terminal dispatch's pathology is the neutral `h_bwd = H*` substitution making an unclamped origin hold score EXACTLY zero - 47-49% of terminal candidates do - which is a different defect and the cheapest one left. The remaining factor of 7-11 is lambda; with lambda fitted as well the wait term lands at 117-177% of measured truth. Flip this knob, `COST_OPTIMAL_SELECTION_ENABLED` and `SELF_HARM_CHECK_ENABLED` together WITH lambda, or none of them. `test/costOptimalOccupancy.test.ts` pins the mechanism; `test/multiStopWaitTerm.test.ts` pins the horizon and that off is byte-identical.

MEASURED against outcomes, term by term, over 20,423 urban holds (`HANDOFF.md` section 7). The objective's COST side is nearly right - it says a hold costs the people aboard 7,914 h where the truth is 6,775 h. Its BENEFIT side is wrong by a factor of ten to seventy: it says holding removes 147 h of waiting under the proxy, or 1,081 h with a correct lambda, where the truth is 10,799 h. It models dwell and riding not at all, and those are another 2,443 h of benefit. So on urban the objective says control COSTS 7,768 h where it actually SAVES 6,466 h - **the wrong sign, on the corridor where the controller works.** Inter-city keeps its sign only because the cost is genuinely larger there, and still overstates 4.8x / 3.6x.

Lambda alone is NOT the fix and that is now measured rather than assumed: calibrating it moves the wait term from 1.4% of the truth to 10%. The other tenfold is the horizon - the wait term `lambda*d*(d + h_fwd - h_bwd)` is a ONE-STOP marginal estimate of a benefit that accrues over the whole downstream route, and urban has twenty-five stops. Neither is the fix alone; they are independent multipliers on the same term and they multiply.

This is why `cost_optimal_hold` (`mpc/costOptimalHold.ts`) is generated, scored and shown on every solve but is NOT selectable unless `COST_OPTIMAL_SELECTION_ENABLED=true`. It is the argmin of the very quantity candidates are ranked by, so letting it compete would replace the tuned Kf/Kb controller network-wide rather than add to it. Calibrate lambda from real boardings before flipping that flag.

## Command lifecycle: control-service is the only thing that delivers a command

A command goes `authorized` (on create/supersede) -> `delivered` -> `acknowledged`/`executing`/... . `control-service/src/commands/deliverAndNotify.ts` performs the `authorized -> delivered` transition (`deliverCommand`, `control-service/src/db/commands.ts`) AND awaits its `command.delivered` webhook together — used by `POST /v1/commands/:id/deliver`, the inline attempt after `POST /v1/commands/:id/supersede` commit, and the `commandDeliverySweep` backstop job. `POST /v1/commands` (create) is the one exception: it calls `deliverCommand` directly (still awaited — the response's `command`/`delivered` fields must reflect the real outcome) but dispatches its webhooks via `notifyWithoutWaiting`, deliberately NOT awaited. Reason: `dispatchWebhook`'s own worst case (`MAX_ATTEMPTS` retries x its request timeout, plus backoff, ~15.75s) exceeded the web client's 8s timeout (`src/lib/controlService/client.ts`) even though the command had already committed and delivered — proven live to tell an operator "the approval was not consumed and can be re-issued" while the driver already had the instruction on screen. Every call site builds the `command.delivered` event via the shared `buildDeliveredWebhookEvent` helper (same file) so the idempotency key format (`${id}:delivered:v${version}`) never drifts between them, awaited or not. Never add another code path that flips a command to `delivered` directly, and never add a response path that awaits `dispatchWebhook` against a caller with a tight timeout.
`authorized` is the state a *failed* delivery rests in by design (not an error state) — see `control-service/src/db/commands.ts#createCommand`'s doc comment for why inserting directly as `delivered` was rejected.

## The state estimator's production repository is a DECORATOR, so test the decorator

`getStateEstimationService()` (`control-service/src/state-estimation/singleton.ts`) is the only construction path used by both HTTP ingestion and the GPS poller, and it wraps `PgStateEstimationRepository` in `CachedGeometryRepository`. A method the decorator forgets to forward simply does not exist in the running service. That is not hypothetical: `recordStopVisit` was missing from it, the interface member was `?`-optional so `implements StateEstimationRepository` still type-checked, and `stop_visits` stayed at 0 for the life of the service while every other writer on the same path worked - 77 minutes of healthy ingestion with 302 vehicles inside a geofence produced not one row, and `calibration/dwell.ts`, `calibration/linkTravelTime.ts`, `schedule/punctuality.ts` and the `ewt_at_stop_seconds`/`cv_at_stop`/`on_time_rate` KPI columns all silently had no input. Every member of `StateEstimationRepository` is now non-optional and `test/stopVisitWiring.test.ts` asserts the decorator implements every method the Pg repository does, so the next omission fails at compile time and in CI. **Never make a repository member optional to spare an implementer, and construct the decorator - not the raw repository - in any test that claims to prove ingestion behaviour.**

**One definition of "which stop is this vehicle at."** `stopStateClassifier.isAtStop` is it (30 m geofence, or within the 150 m approach window and still closing), and `current_stop_id`, `stop_state_entered_at` and the `held_by_controller` association all answer from it. When the estimator asked the geofence while the classifier also associated on the approach window, 43% of live stop associations (measured: 649 with a stop id, 368 with an entry time) carried a stop with no entry time, and `stopVisit.ts#detectCompletedStopVisit` needs both - so they could never close. `stop_state_entered_at` means "when this vehicle's association with `current_stop_id` began", not "when it became stationary"; `arrival-prediction/dwell.ts` charges elapsed dwell from it and inherits that. Measured by replaying one captured feed window through both candidate rules: associating on the approach window is strictly additive (it doubles recorded visits and loses none), but the visits it adds are passages rather than arrivals - 22% show the bus ever reporting <= 2 km/h, against 38% of geofence visits, median closest approach 76 m. Right for `computeStopHeadways`/`schedule/punctuality.ts`, which difference departures; wrong for `calibration/dwell.ts`, whose `dwellSeconds` is `departedAt - arrivedAt`. **Before `fitDwellModel` ever has its 12 samples per stop, split the two on `stop_visits.source` (`gps_approach` vs `gps_geofence`) and filter the dwell fit to geofence visits.**

## E2E testing convention: don't give a spec the REST client it's proving doesn't need to exist

`tests/e2e/control-room-command-delivery.spec.ts` asserts control-service's own state by reading `pg` directly via `E2E_CONTROL_SERVICE_DATABASE_URL`, and is structurally incapable of constructing a control-service REST client — see its file header for the incident this convention prevents (a sibling spec's REST-backed fixture helper stayed green while the real create -> deliver product path was silently broken end to end). `tests/e2e/pilot-driver-command.spec.ts` is that sibling and is NOT held to this convention: it does construct one (`controlServiceFetch`), because no REST endpoint anywhere in this repo creates a `dispatcher_actions` approval or a `vehicles` row for it to seed through instead — see that spec's own file header. When a spec exists specifically to prove a product code path works end-to-end (not just to seed fixtures) — that is `control-room-command-delivery.spec.ts`'s job, not the pilot-driver spec's — keep it structurally incapable of reaching the backend endpoint(s) that path is supposed to reach. Shared fixture helpers (route-direction/vehicle seeding, pilot-driver vehicle assignment) live in `tests/e2e/fixtures/`.
Both specs require a live control-service + web app + seeded ops accounts (dispatcher/control_room/pilot_driver) and skip locally when their `E2E_*` env vars are unset; `.github/workflows/ci-web.yml` provisions all of it (all three accounts, all `E2E_*` vars, both specs run by name in one job) and sets `CI=true`, which turns a missing var into a hard failure instead of a skip.

## THIS BRANCH SHIPS WITH AUTHENTICATION OFF

`simulator-preview` exists to be deployed to a domain and shown to people who
have no ops account, so `src/lib/auth/publicPreview.ts#isAuthDisabled()`
defaults to TRUE and five call sites ask it first: the edge gate
(`src/middleware.ts`), the session authority (`rbac/server.ts`), both role
guards (`rbac/pageGuard.ts`, `rbac/guard.ts`) and the two sign-in pages, which
forward into the console instead of rendering a form. MERGING THIS BRANCH INTO
`main` SHIPS AN APP WITH NO AUTHENTICATION - `DISABLE_AUTH=false` restores
every gate, and must be set at BUILD time as well as run time because
middleware resolves its `process.env` reads when `next build` runs.

Three things that look optional and are not. The switch defaults to auth ON
under vitest, because the ~30 auth test files all assert what a REFUSED
request does and would pass vacuously against a loginless build
(`src/tests/unit/publicPreview.test.ts` is the tripwire; CI's e2e job sets
`DISABLE_AUTH=false` explicitly, never via `CI`, which several platforms also
set while building). The preview branch of `resolveOpsSession` still calls
`cookies()` and throws the answer away - without it the ops dashboards become
statically prerenderable and `next build` renders `/ops/driver` against a
database that is not running. And each guard substitutes the role its own
screen or endpoint asked for, so one anonymous visitor opens all seven
consoles rather than `/ops/forbidden` on six of them.

## Node version: CI pins 20.x, and a plain `nvm use` may not give you it

Both `.github/workflows/*.yml` install Node via `actions/setup-node@v4` with
`node-version: "20"` — check those files directly if this ever needs
reconfirming, don't trust a memory of it. `.nvmrc` (repo root and
`control-service/`) and each `package.json`'s `engines.node` pin `20.x` to
match. Node 26 is not just untested here, it is known-broken: it installs its
own `globalThis.localStorage` accessor that vitest's jsdom `populateGlobal`
assigns through, so `localStorage.clear()` is `undefined` and every test that
touches it (`theme.test.tsx`, `opsFleetMapTheme.test.tsx`) fails — Node 24
does not have this problem, but only Node 20.x matches what CI actually runs.
On a machine with Homebrew's Node ahead of nvm's on `PATH` (`/opt/homebrew/bin`
before `~/.nvm/versions/node/*/bin`), running `nvm use` does not fix `node
--version` — Homebrew's copy still wins. Neither `.nvmrc` nor `engines` is
enforced (no `engine-strict` in `.npmrc`); pnpm only warns on a mismatch, npm
stays silent. Prepend the intended Node's bin dir to `PATH` explicitly if
`nvm use` doesn't visibly change `node --version`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
