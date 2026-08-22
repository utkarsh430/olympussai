# Bunching controller audit — Part A findings

Audit of the deployed Olympuss bunching controller against the 14 checks in
*Olympuss AI — Bus Bunching Control, Reference Architecture v1.0* (Part A,
section 1). Every row cites the file and line range that implements the check,
or records that nothing does.

Audited at commit `3eb9d96`, branch `integration/main`.

Verdicts: **PASS** · **PARTIAL** · **FAIL** · **NOT PRESENT**.

> **Status.** The findings below record the state at audit time. Defects 1
> and 2 have since been fixed — see *What was changed* at the end of this
> document. A1 and A3 now pass; A2 and A13 are materially improved. Nothing
> else in the table has moved.

---

## Findings table

| # | Check | Verdict | Where | Justification |
|---|---|---|---|---|
| **A1** | Objective function | **FAIL** | `control-service/src/mpc/twoWayHold.ts:37`, `selfEqualizing.ts:45`, `terminalDispatch.ts:51`, ranked at `solver.ts:135-137` | `objectiveCost` is `Math.abs(rawHold - holdSeconds)` — the residual left by clamping and rounding, not a passenger cost. Candidates sort ascending on it and index 0 is selected, so the ranking is *anti-correlated with need* (see Defect 2). The quadratic form exists only in `occupancyMpc.ts:88`, which is advisory and never selected. |
| **A2** | In-vehicle cost | **PARTIAL** | `control-service/src/mpc/occupancyMpc.ts:89` | `onboardCost = loadFraction × hold × W_ONBOARD` exists but only inside the `label: 'PREDICTIVE'` advisory, which `solver.ts:154` computes *after* selection and never feeds back into it. It also uses a load *fraction* against `route_policies.occupancy_capacity`, which is `NULL` on every seeded corridor, so it resolves to the fixed `ESTIMATED_LOAD_FRACTION = 0.5` (`occupancyMpc.ts:31`) on 100% of live traffic. No hold decision has ever been influenced by an onboard count. |
| **A3** | Directionality | **FAIL** | `control-service/src/headway/metrics.ts:98` consumed at `mpc/twoWayHold.ts:28` | The law reads two-way, the input is not. See Defect 1 — this is the headline finding. |
| **A4** | Slack assumption | **NOT PRESENT** | — | No running-time padding is modelled anywhere. `trips.scheduled_departure` (`db/migrations/20260805190000__core_data_model.sql:289`) is the only schedule column and there is no per-stop scheduled arrival, so schedule slack is neither assumed nor quantifiable from the current schema. |
| **A5** | Prediction source | **PARTIAL** | `control-service/src/arrival-prediction/` (`predict.ts`, `speed.ts`, `dwell.ts`) | An arrival-prediction service exists and is reasonably developed, but **no control law consumes it.** `computePairHeadways` extrapolates from the instantaneous GPS gap and current speed (`headway/metrics.ts:97-98`); the follower's arrival is never *predicted*. MAE is not reported at 5/10/15-minute horizons anywhere. Per Berrebi et al. (2018) this caps controller quality regardless of the law used. |
| **A6** | Dwell model | **PARTIAL** | `control-service/src/arrival-prediction/dwell.ts`; `simulation/types.ts:24-33` | A dwell model exists for prediction and a parameterised one for the simulator (`baseDwellSeconds`, `secondsPerBoarding`, `secondsPerAlighting`). Neither is fitted per route / time-of-day band from data, neither reports R², and neither carries a crowding penalty. The instability mechanism itself is therefore unmodelled in the controller's own dynamics. |
| **A7** | Capacity awareness | **PARTIAL** | `control-service/src/simulation/kpi.ts:74`; `types.ts` `StopVisitRecord.deniedBoardings` | Denied boardings are modelled and counted **in the simulator only**. The live controller has no denied-boarding detector and no capacity term. The "full bus skips its dwell and closes on the bus ahead" amplifier is invisible in production. |
| **A8** | Action bounds | **PARTIAL** | `control-service/src/mpc/safety.ts:112-114`; `db/migrations/20260819120000__raise_hold_cap.sql` | `max_hold_seconds` is a genuine hard bound, enforced in the safety filter *and* clamped in every law. **Max schedule lateness is not bounded at all** — the doc's Part J calls this non-negotiable, and the data to compute it (per-stop scheduled arrival) does not exist in the schema. |
| **A9** | Control point selection | **PARTIAL** | `route_direction_stops.is_control_point`, `db/migrations/20260805190000__core_data_model.sql:198` | Control points are config-not-code and per-stop overridable, which is the right shape. But there is no analysis anywhere that places them where headway variance is *generated*, and no per-stop eligibility flag for "do not hold here" (traffic-blocking stops, stops before signalised intersections — Part J). |
| **A10** | Terminal handling | **PASS** | `control-service/src/mpc/terminalDispatch.ts`; prioritised at `solver.ts:99-110,132-136` | Terminal dispatch regulation is a separate law, applies only to vehicles dwelling at the origin terminal, and *pre-empts* mid-route holding for those vehicles (`terminalVehicleIds`). A safe terminal candidate always wins selection. This matches the doc's "build first / highest return" lever. |
| **A11** | Compliance loop | **PARTIAL** | `control-service/src/commands/deliverAndNotify.ts`; `simulation/kpi.ts:82-86` | The command lifecycle records `authorized → delivered → acknowledged`, so the *instruction* and its confirmation are captured. The **executed** hold is never measured against the instructed one in production — `complianceRate` is computed only inside the simulator, from the simulator's own `compliant` flag. Real compliance is currently unmeasurable. |
| **A12** | Fallback path | **PARTIAL** | `control-service/src/mpc/selfEqualizing.ts:27`; `safety.ts`; `route_policies.fallback_mode` | Per-pair degradation is real and well-designed: two-way → self-equalizing when Kf/Kb or the backward sample is unavailable, and the safety filter fails closed on stale state. What is missing is a *layer-level* fallthrough: if `solve()` throws, nothing runs instead, and there is no logged fallthrough event distinguishing "no recommendation because nothing was wrong" from "no recommendation because the controller failed". |
| **A13** | Explainability | **PARTIAL** | `control-service/src/mpc/solver.ts:120-140`; `src/lib/ops/recommendationView.ts:191-196` | Rejections carry structured reasons and the console renders them well. But no recommendation carries a **one-sentence rationale**; the console's headline number is `objectiveCost`, rendered as *"Ns from the ideal hold"* — which, given A1, explains the controller's rounding error to the dispatcher rather than the passenger case for the hold. |
| **A14** | Evaluation | **PARTIAL** | `control-service/src/simulation/` (engine, kpi, replay, regressionRunner, referenceKpi); `rehearsal/` | A calibrated event-based simulator, seeded PRNG, replay mode, disturbances, denied boardings and stochastic compliance all exist — this is well ahead of the doc's Milestone 2 expectation, and `rehearsal/deployedControlLaws.ts` runs the *real* production laws inside it rather than a reimplementation. **RESOLVED.** Both gaps this row named are closed. The EWT proxy is replaced: `lib/dispersion.ts` now holds the second-moment formula and `simulation/kpi.ts`, `headway/metrics.ts` and `headway/stopHeadway.ts` all call it, so the simulator and the live path can no longer disagree on the headline KPI. `KpiSummary` gained `ewtSeconds` and `bunchingRate`; the old `excessWaitSeconds` is retained and marked deprecated so existing readers did not change meaning in the same commit. `src/evaluation/` adds the harness the row implied but did not have — paired seeds, bootstrap intervals, and an algorithm-coverage report. See `docs/CONTROLLER_EVALUATION.md`. |

---

## Tier classification (Section 4)

**The deployed controller is Tier 1 in structure and below Tier 0 in the information it actually uses.**

It has every part of a Tier 1 two-way-looking analytic controller: the closed-form law with tunable `Kf`/`Kb`, a self-equalizing fallback, terminal dispatch regulation, a hard safety filter and an occupancy-weighted advisory. The scaffolding is genuinely good and materially ahead of what the doc assumes it will find.

But the backward-headway input does not carry the backward headway (A3). With that substituted, the two-way law collapses algebraically to a forward-only proportional law — and not even Tier 0's even-headway rule, since it regulates toward the *timetable* target `H*` rather than toward the *actual* spacing of the neighbouring buses. Tier 0's guarantee ("empirically strong, deployed in Stockholm and Santiago") does not apply to it.

---

## Top three defects, ranked by expected impact on excess wait time

### Defect 1 — `h_bwd` is not the backward headway; the two-way law is forward-only

`headway/metrics.ts:97-98` computes both headways from **the same leader→follower gap**, differing only in whose speed divides it:

```ts
const hFwdSeconds = gapMeters / followerSpeedMps;   // correct: h_fwd(follower)
const hBwdSeconds = gapMeters / leaderSpeedMps;     // NOT h_bwd(follower)
```

The project's own blueprint defines it otherwise — *"Backward headway h_bwd(i) = predicted time for the follower to reach bus i's current route position"* (`docs/Olympuss_AI_UPSRTC_Bus_Bunching_Technical_Blueprint.md:412`). For the vehicle the hold is issued to (`twoWayHold.ts:31` uses `h.followerVehicleId`), the backward headway is the gap to the bus **behind it**, which lives in a different row of the same chain. The bus behind is never observed.

Substituting into the law at `twoWayHold.ts:28`, when leader and follower are travelling at similar speeds `h_fwd ≈ h_bwd` and:

```
hold = Kf(H* − h_fwd) − Kb(H* − h_bwd)  →  (Kf − Kb)(H* − h_fwd)
     = 0.2 × (H* − h_fwd)          at the seeded gains Kf=0.4, Kb=0.2
```

A forward-only law at a fifth of the intended gain. Worse, the residual backward term is now driven by the *speed differential between the same two buses* rather than by the following bus, so when the held bus is slower than its leader the "backward" term grows and **cancels the hold precisely when the pair is closing up**. This is the exact A3 failure signature the reference document names: *"Forward-only. Requires schedule slack to be stable; destroys commercial speed."* Section 2.4 calls it a design defect rather than a simplification, and the fix requires no new data — the correct value is already in the adjacent row of the leader/follower chain.

### Defect 2 — selection ranks by clamp residual, so the solver systematically prefers the least-bunched pair

Every law sets `objectiveCost = |rawHold − holdSeconds|` and sorts **ascending**; `solver.ts:136` selects index 0. Since `holdSeconds = round(clamp(rawHold, 0, maxHold))`:

- a pair needing a 30 s hold has `objectiveCost ≈ 0.3` (rounding only) and **wins**;
- a pair needing 900 s against a 600 s cap has `objectiveCost = 300` and **loses**.

The more severely bunched a pair is, the larger its raw hold, the harder the cap bites, and the lower it ranks. With one command issued per cycle, the controller reliably spends its single intervention on the pair that needed it least. The `objectiveCost` doc comment already claims to implement *"blueprint 9.1 step 6 optimize_passenger_and_operator_cost"*; it does not. Section 2.1's requirement — the cost term must be quadratic in headway, not an absolute deviation and not a threshold — is unimplemented on the selection path.

### Defect 3 — no in-vehicle cost and no lateness bound reach any decision

Combined A2 + A8. Nothing in the selection path knows how many people are on the bus it is about to hold, and nothing bounds the resulting schedule lateness. The advisory that *does* price occupancy is computed after the fact and discarded. Per Section 7 this is also the largest missed opportunity, not just a defect: live occupancy is the one input the published state of the art (including the CTA deployment, which estimated load from historical boarding rates) could not use.

---

## Scoping question (Part K) — needs an owner's decision

`db/migrations/20260819120000__raise_hold_cap.sql:16` records a measurement against the live control database: **the median active `target_headway_seconds` is 1800 (30 minutes)** across 1,442 policy rows.

Part K is explicit that headway-regularisation theory applies to high-frequency service — headways short enough that riders arrive without consulting a timetable, roughly under 10–12 minutes. At a 30-minute headway the `E[wait] = (H̄/2)(1 + CV²)` expression does not hold, riders consult a timetable, and en-route holding is difficult to defend to a passenger.

This does not invalidate the work: Layer 0 estimation, the simulator, terminal dispatch regulation and the whole command/approval path are reusable under either scope, and terminal dispatch is the highest-return lever under *both*. But the objective function differs, so **the median headway per route needs stating before the objective is tuned.** If both scopes are live, the doc's recommendation is two objective functions over one shared estimation and simulation stack.

---

## What this audit found that the reference document did not anticipate

Three checks came out materially stronger than the document's failure signatures assume:

- **A10 terminal handling** is a genuine PASS with correct pre-emption semantics — the doc's Milestone-3 lever is already built.
- **A14's simulator** exists, is deterministic under seed, models denied boardings and stochastic compliance, and — via `rehearsal/deployedControlLaws.ts` — runs the *actual production functions* rather than a reimplementation of them. That module's dependency direction was designed specifically to prevent the drift the doc's Section 8.4 step 1 warns about.
- **A12's per-pair degradation** and **A8's hold cap** are real, tested guardrails, and `safety.ts`'s two-sided staleness check (rejecting future-stamped readings, `FUTURE_STATE_TOLERANCE_SECONDS`) is a hardening the document does not ask for.

The controller's problem is not missing architecture. It is that two specific inputs to the existing architecture are wrong.


---

# What was changed

Both defects the audit could prove were fixed in the same pass, with tests
that fail against the previous behaviour. The rest of the table is unchanged
and is planned work, not done work.

## Defect 1 — `h_bwd` now measures the bus behind

`control-service/src/headway/metrics.ts` walks one link further down the
leader/follower chain that `state-estimation/ordering.ts` already builds, and
measures the follower's backward headway as the gap to *its* follower at
that vehicle's own pace. No new data source: the value was always present in
the adjacent row.

Consequences that fall out of the corrected definition, each of them the
system behaving as designed rather than a workaround:

- The back-most vehicle on a linear route-direction now reports a null
  `h_bwd`, so `twoWayHold.ts` declines it and `selfEqualizing.ts` takes it.
  That is the documented degradation path finally being reachable — before,
  `h_bwd` was almost never null and self-equalizing almost never ran in
  production.
- On a loop, the wrap link supplies a trailer for every vehicle, so two-way
  holding applies throughout.
- `simulation/engine.ts` **cannot** supply the vehicle behind: it simulates
  one complete trip at a time in dispatch order, so the trailing vehicle has
  not been simulated when the decision is made, and its trajectory depends on
  the hold under decision. A scenario run therefore exercises the
  self-equalizing fallback, and this is now stated plainly in
  `ControllerKinematics.trailer` and in `rehearsal/deployedControlLaws.ts`
  rather than being invisible. `ControllerKinematics.trailer` exists and is
  honoured by the rehearsal controller, so a hand-built context (as the tests
  use) does exercise Algorithm B against the real module — and the day the
  engine gains an interleaved event loop, the controller side already reads
  it. **This is the concrete blocker on validating the corrected two-way law
  in simulation, and it is the strongest argument for the reference
  document's Milestone 2 rebuild.**

## Defect 2 — selection ranks by passenger cost

New module `control-service/src/mpc/objective.ts` implements section 2.2's
objective, restricted to the control point a candidate acts at:

```
netPassengerSeconds = w_h·λ·d·(d + h_fwd − h_bwd)   waiting, 2nd moment
                    + w_v·L·d                       in-vehicle delay
                    + w_c·d                         operator cost
```

scored as the **change** versus doing nothing, so it is comparable across
pairs — ranking on the absolute level would have reproduced the original
defect, since an already-healthy pair has a low absolute cost. Negative means
the hold removes more cost than it adds. Every law now attaches this as
`objectiveCost`; the clamp residual survives as `clampResidualSeconds`, where
it is genuinely useful evidence and decides nothing.

Three properties worth noting:

- **The Tier 0 rule falls out of it.** Setting the derivative to zero gives
  `d* = (h_bwd − h_fwd)/2 − (w_v·L + w_c)/(2·w_h·λ)`. The first term is
  exactly the even-headway split deployed in Stockholm and Santiago; the
  second is the correction the published state of the art cannot make,
  because it needs a live onboard count rather than a historical average.
  Exported as `optimalHoldSeconds` — not yet a candidate source, but it is
  the reference value a Layer 2 solver would be clipped against.
- **Unknown occupancy costs nothing rather than a guessed mid-load.** The
  advisory tier substitutes a 0.5 load fraction; the selection path returns
  null and drops the in-vehicle term to zero. Ranking is comparative, and a
  constant invented identically for every candidate cannot break a tie — it
  can only shift the wait/onboard balance on a number nobody measured. With
  occupancy unpopulated fleet-wide, ranking is therefore pure second-moment
  wait cost today, and the in-vehicle term starts moving decisions only when
  someone deliberately turns occupancy on.
- **The mid-route pool is now sorted globally.** It used to be two
  independently-sorted lists concatenated, so every two-way candidate
  outranked every self-equalizing one whatever their costs. The two laws
  cover disjoint pairs and now score in one unit, so the comparison is
  meaningful.

`solve()` also takes a single clock reading per cycle, so every law, the
safety filter and the advisory are graded against the same instant — Part J's
deterministic-replay requirement.

## A13 — every candidate carries a reason

`explainHold` generates one deterministic sentence naming the observed
headways, the gap behind, the onboard count and the resulting trade, and the
console renders it verbatim. The console's headline number changed from
*"distance from the ideal hold"* — the controller's own rounding error — to
passenger-seconds saved, with an explicit note when no onboard count reached
the engine.

## λ is the calibration debt this creates

`arrivalRatePaxPerSecond` proxies λ as `1/H*`, the standing approximation
already used by `occupancyMpc.ts` and the EWT computation. λ sets the exchange
rate between waiting cost and in-vehicle cost, so under-estimating it makes
the onboard term dominate and produces a controller that always prefers the
emptier bus — as wrong as one that ignores load. The risk is inert while
occupancy is unpopulated, but **the demand model (Milestone 1) must land
before occupancy is enabled on any corridor**, not after.

---

# Recommended build order from here

Milestones 0 and 3 are effectively complete, and the simulator (Milestone 2)
is well advanced. The remaining order:

1. **Layer 0 estimation** — dwell fitted per route/time-of-day with a
   crowding term, link travel-time *distributions*, and above all the demand
   model λ, which is now load-bearing. Report arrival-prediction MAE at 5/10/15
   minutes; per Berrebi et al. (2018) prediction quality caps controller
   quality, and no control law currently consumes `arrival-prediction/` at all.
2. **Resolve the Part K scoping question** (median headway per route). It
   changes the objective function and should precede any tuning.
3. ~~**Interleaved simulator clock**~~ — **DONE.** `simulation/engine.ts` advances
   every vehicle on one clock, so `ControllerKinematics.trailer` is populated and
   the corrected two-way law generates candidates for the first time (measured:
   36.6% of decision points on a synthetic corridor, 0% before). The compliance
   sweep is wired into `evaluation/spec.ts#complianceSweep`.
4. ~~**Second-moment EWT in `simulation/kpi.ts`**~~ — **DONE.** Shared with the
   live path via `lib/dispersion.ts`.

   **New, and ahead of the rest of this list: terminal dispatch regulation
   cannot fire.** `mpc/terminalDispatch.ts` needs `dwelling_at_stop`, which
   means speed below 2 km/h, which `computePairHeadways` floors at
   `MIN_SPEED_KMPH = 1` before computing `h_fwd = gap / speed`. A 7.7 km gap
   becomes `h_fwd = 27,601s` against a 900s target, so `rawHold` is always
   negative and Algorithm A — the highest-return lever in §4.1 — generates
   nothing, in production as well as in simulation. Surfaced by the coverage
   report; see `docs/CONTROLLER_EVALUATION.md`.
5. **Max-lateness bound** (Part J, non-negotiable), which needs per-stop
   scheduled arrival in the schema first.
6. **Compliance instrumentation**: instructed hold versus observed departure,
   per driver and per deviation magnitude.
