# Fleet-trial simulator — handover

You have never seen this repo. This file is everything you need to keep working on
the bus-bunching control simulator without re-deriving it.

Read `docs/FLEET_TRIAL.md` next — it is the long-form record of every finding.
This file is the operational one: commands, numbers, bugs, and what not to retry.

---

## 1. What it is and how to run it

Two independent pnpm packages. `pnpm install` in **both** before anything works.

- `control-service/` — Express + Postgres. The control laws, the detector, the
  simulator, the trial. Its test suite mocks the DB; **no Postgres needed**.
- repo root (`src/`) — the Next.js ops console. The trial's UI lives here.

### The trial

`control-service/src/fleetTrial/` runs the **deployed** control laws (imported
from `src/mpc/*` and `src/headway/*`, never reimplemented) against a simulated
fleet, twice: once controlled, once with nobody intervening, on the same seeded
day. Then it replays the **deployed** bunching detector over both arms.

```bash
cd control-service

pnpm sim:fleet                                    # default: inter-city, 500 buses/phase
pnpm sim:fleet --corridor urban                   # intercity | suburban | urban
pnpm sim:fleet --corridor urban --vehicles 250    # buses PER PHASE (two phases, so 2x this)
pnpm sim:fleet --seed 20260822 --quiet
pnpm sim:fleet --alighting                        # act on alighting-only proposals (default OFF)
pnpm sim:fleet --speed link_average               # link_average | vehicle_state (default)
pnpm sim:fleet --scenarios slow_bus,traffic_shock # subset of the 10
pnpm sim:fleet --out experiments/runs/x           # writes report.json
pnpm sim:fleet --help
```

Default seed is `20260822`. Runtime: ~5 s urban, ~16 s inter-city at 500/phase.

**Ad-hoc scripts need env vars.** `src/config/env.ts` validates at import, so any
`npx tsx` script against this package needs:

```bash
CONTROL_SERVICE_DATABASE_URL="postgres://x:x@localhost:5432/x" \
SERVICE_TOKEN_SECRET="0123456789abcdef0123456789abcdef" \
WEBHOOK_HMAC_SECRET="0123456789abcdef0123456789abcdef" \
npx tsx /tmp/yourscript.ts
```

(`pnpm sim:fleet` reads `.env.local` if present, so it usually does not need them.)

### Checks

```bash
cd control-service && pnpm test && pnpm lint && npx tsc --noEmit -p tsconfig.json
cd .. && pnpm test && npx tsc --noEmit && pnpm build && npx next lint --dir src
```

Green as of handover: **1,073** control-service tests, **1,741** web tests, build clean.

### The console

`/ops/control-room/simulator` (control_room role). Server page reads the last
report; the client can run a new one.

- page: `src/app/(ops)/ops/control-room/simulator/page.tsx`
- console: `src/components/ops/control-room/simulator/SimulatorConsole.tsx`
- charts: `src/components/ops/control-room/simulator/TrialCharts.tsx`
- wire schema: `src/models/fleetTrial.ts`
- reader: `src/lib/controlService/fleetTrial.ts`
- API: `src/app/api/ops/control-room/fleet-trial/route.ts`
- service routes: `control-service/src/routes/fleetTrial.ts`
  (`POST /v1/fleet-trial`, `GET /v1/fleet-trial/latest`; last report cached in
  memory so a page refresh cannot silently re-run the experiment)

---

## 2. Accuracy baseline

### Metrics, and which one is the headline

1. **Total passenger time** (`PassengerOutcome.totalPassengerSeconds`) — waiting
   at stops **plus** delay to people already aboard. **This is the headline.**
2. **Excess wait time (EWT)** — seconds per waiting passenger. Secondary. It
   counts only people at stops, so it and (1) routinely move in *opposite*
   directions. Optimising EWT alone is how the controller measured net-negative.
3. **On-time rate** — share arriving within ±300 s of the booked time.
4. **Denied boardings** — refused because the bus was full.
5. **Headway CV** — diagnostic only (scale-free; lengthening every headway
   uniformly "improves" it).

### Current values

250 buses/phase, 3 seeds, occupancy-blind phase unless noted:

| | inter-city | suburban | urban |
|---|---|---|---|
| σ_leg / H\* | **0.19 (too_disturbed)** | 0.10 | 0.10 |
| EWT | 317 → 263 s | 105 → 71 s | 110 → 55 s |
| total passenger time | −1.4% (blind) / **+3.2%** (aware) | +1.6% / +2.1% | **+11.1%** / +9.1% |
| on-time | 16 → 26% | 52 → 63% | 63 → 81% |
| denied | −25% | −29% | −21% |
| hold/bus | 449 s | 194 s | 201 s |

Incidents, full 1,000-bus trial (500/phase):

| | inter-city | urban |
|---|---|---|
| left alone | 2,485 detected, 51% resolved | 4,726 detected, **8%** resolved |
| controlled | 2,666 detected, **68%** resolved | 2,726 detected, **40%** resolved |

### Targets

- Total passenger time **> 0 on every corridor**. Inter-city occupancy-blind is
  the only failing case (−1.4%).
- Objective prediction error **< 1.5×** (currently 1.8× with a correct λ, 3.4×
  with the shipped proxy). See §7.
- No regression in on-time rate on any corridor.

---

## 3. Bugs found — symptom → root cause → status

All **FIXED** unless marked otherwise. Every one has a test.

**1. Controller ~dead in production.** Symptom: two-way holding generated 2,373
candidates with the simulator's speed signal, **122** with production's; EWT gain
44% → 10%. Root cause: `h_fwd = gap ÷ instantaneous speed`, floored at
`MIN_SPEED_KMPH = 1`, so a bus **at a stop** reported hours — and a stop is the
only state `mpc/eligibility.ts` permits a hold from. Fix: borrow the corridor's
median moving pace for a stationary vehicle; return `null` (no opinion) when
nothing is moving. `control-service/src/headway/metrics.ts:111,126,155`.
Tests: `control-service/tests/headway/metrics.test.ts`.

**2. Acting on pairs the detector wouldn't report.** 83% of holds went to pairs
above `warning_threshold_ratio`. The mid-route laws are proportional controllers,
so any shortfall generated a hold. Fix: `isWorthActingOn` gates at the corridor's
own warning ratio. `control-service/src/mpc/actionThreshold.ts:60,69`.

**3. Occupancy switch inert.** Across 4,960 matched decisions it changed the price
of every hold and **zero** decisions — it feeds `objectiveCost`, a *ranking*
input, and the mid-route laws are mutually exclusive so there is never a second
selectable candidate. Fix: load binds on the **action** via a tapered hold cap.
`control-service/src/mpc/actionThreshold.ts:127,129`.

**4. Stranded passengers vanished.** A passenger a full bus refused was counted
once in `deniedBoardings` and then never waited for anything. Root cause: the
queue was swept to the arrival instant regardless of how many boarded. Fix:
sweep only the served fraction. `control-service/src/simulation/engine.ts:535,~745`.
**This reversed a conclusion I was about to ship** (see §6).

**5. Held buses absorbed passengers for free.** Boardings were drawn once at
arrival, then the queue swept to *departure* — so everyone arriving while the bus
stood there was deleted. A 10-minute hold collected 10 minutes of arrivals at no
cost, understating onboard load and the cost of holding. Fix: they board
(capacity permitting) and cost no extra dwell.
`control-service/src/simulation/engine.ts:714,729`. Also moved the wait
calculation into the engine (`StopVisitRecord.boardingWaitPassengerSeconds`) —
the trial was charging someone who walked onto a held bus the same wait as
someone who had queued since the last bus.

**6. Warm-up bus could not do its job.** After (4), denials rose 15×. Root cause:
the engine started every stop's queue at simulated second 0, so the first bus to
reach a distant stop swept a crowd that had "waited since midnight"; the warm-up
bus existed to absorb it and cannot absorb what it has no room for. Fix: a stop's
queue starts when its **first bus arrives**.
`control-service/src/simulation/engine.ts:535`.

**7. Unachievable timetable silently disables the controller.** `mpc/safety.ts`
refuses a hold that would breach `max_lateness_seconds`; if the schedule is
tighter than the corridor can run, *every* bus is late so *every* hold breaches.
Tightening the booked time 15% cut EWT gain 52.9% → 19.4%. **The trial was doing
this to itself** — buses ran 896 s late against its own inter-city schedule. Fix:
book the timetable from the **uncontrolled arm's own mean arrivals**
(`timetableFromRun`, `control-service/src/fleetTrial/run.ts:315`), and report a
`scheduleFit` warning (`:1494`).

**8. Alighting-only structurally unreachable.** Reported 0 of 4,960 decisions.
*Two* causes: the adapter built only the headway row where the deciding bus is
the **follower** (so the law, which acts on the **leader**, was always asked about
a bus mid-link), and the **trailer** had no observation timestamp so every
surviving candidate was rejected `stale_state`. Fixes:
`control-service/src/rehearsal/deployedControlLaws.ts:742` (trailing row),
`:583` (trailer observedAt).

**9. Scenarios inverted on the urban corridor.** `peak_load` set 0.48
boardings/min against an urban default of 1.2 — the *lightest* scenario there.
Root cause: absolute overrides tuned for inter-city. Fix: multiplicative
`inputScale`. `control-service/src/fleetTrial/scenarios.ts`, applied at
`control-service/src/fleetTrial/run.ts:205`.

**10. A dark bus was still used as a leader.** The deciding vehicle's staleness
was modelled; its neighbours' was not. Production's state estimator drops a
low-confidence vehicle from the chain *before* any headway is computed. Fix:
`neighbours()` skips it. `control-service/src/simulation/engine.ts:301,306`.

**11. EWT sampled at control points only.** Changing the holding-point placement
changed the *measurement population* — baseline EWT read 61 s with two holding
points and 323 s with ten on the **identical uncontrolled corridor**. Fix: sample
every station (`allStopIds` in `control-service/src/fleetTrial/run.ts`).

**12. Guardrails invisible.** `max_lateness_breach` refuses ~3/4 as many holds as
are issued — it is part of the control loop, not a backstop — and nothing
reported it. Fix: `safetyRejections` per phase
(`control-service/src/fleetTrial/run.ts:1032`), shown in CLI and console.

**13. Trial preset inputs overrode the corridor preset.** Asking for `urban` got
urban *geometry* with inter-city *traffic* (0.38 boardings/min vs 1.2, 120 s dwell
vs 20 s). Root cause: `DEFAULT_FLEET_TRIAL_SPEC.inputs` was spread **after**
`preset.inputs`. Fix: spec `inputs` defaults to `{}`; the preset owns its demand.

---

## 4. Suspected but NOT confirmed

- **The objective's residual 1.8× error is structural.** Hypothesis: the wait term
  `λ·d·(d + h_fwd − h_bwd)` is a one-step marginal estimate of a multi-stop
  effect, so it cannot see that even spacing keeps `Σh²` down for the rest of the
  route. Evidence: it overstates measured harm 1.8× even with a correct λ, and the
  gap does not close as λ improves. **Not proven** — could also be the
  neutral-`h_bwd` assumption or the clamp. Would need a multi-stop objective to
  test.
- **Inter-city may be improvable by acting on forecast `h_fwd`.** It sits above
  the controllable band (σ_leg/H\* = 0.19) because deviation accumulates between
  stops faster than a hold removes it. Acting earlier *might* help. Completely
  untested. Note the related idea (measuring at the release instant) **failed** —
  see §6.
- **Denied boardings occasionally rise under control.** Seen at +241 on one urban
  run at 200 buses/phase while the 3-seed mean showed −21%. Not characterised;
  may be seed noise or a real over-holding-fills-buses mechanism.
- **Neighbour confidence is cruder than production's.** The adapter marks
  leader/trailer as fully confident and freshly observed unless a `gps_dropout`
  disturbance covers them. Production has a continuous confidence model and a
  low-confidence exclusion path. Fidelity gap, unquantified.
- **`minSeparationSeconds` is hardcoded to 30** in
  `control-service/src/rehearsal/run.ts` (`buildRouteDirection`). Never swept.
  `route_links.no_overtake` is empty in the DB so there is no measured value.

---

## 5. Task list (verbatim, priority order)

> 1. **Calibrate λ.** `evaluation/calibrate.ts` already fits it from `stop_visits`.
>    It halves the objective's error (3.4× → 1.8×). This is the highest-value
>    remaining change and it's the precondition for everything below it.
> 2. **Then replace the occupancy taper with the closed form.** My taper is a
>    deliberately crude, bounded heuristic — it can shorten a hold, never invert
>    one, precisely because λ is wrong. With λ calibrated, `optimalHoldSeconds` is
>    the principled version.
> 3. **A multi-stop objective.** The 1.8× residual won't close without one. This is
>    research-scale, not a patch — I'd name it as the ceiling on current accuracy
>    rather than promise it.
> 4. **Per-corridor enablement.** Derive σ_leg/H\* from observed running times and
>    don't run mid-route holding on corridors above the band. Inter-city at 0.19
>    spends driver goodwill for ~nothing.

On the "should we split the algorithm into inter-city / urban / suburban" question:
**no — do not fork it.** The laws behaved identically on all three shapes; only
*configuration* differed, and those are already per-route-direction
`route_policies` columns. σ_leg/H\* is a continuum (0.19 / 0.10 / 0.10), so
bucketing it mis-classifies exactly the corridors near the boundary. Keep the
three shapes as **configuration templates** (`presets.ts`) plus **one computed
gate** (task 4). Even the one place a fork looked justified — high-frequency
turn-up vs low-frequency timetabled service — did not survive testing: `ks`
measured as no effect and a tight lateness bound was right on *both* shapes.

---

## 6. Dead ends — do NOT retry these

Each was implemented, measured paired-by-seed, and rejected.

| Idea | Result | Verdict |
|---|---|---|
| `Kb` 0.2 → 0.4 | Looked great over 3 seeds (net −3.57→−2.25%, EWT +10.9→+14.2%). Over **10** seeds: better on **4/10** net, **5/10** EWT, means identical | Coin flip. Not shipped |
| `ks` = 0.35 (schedule-correction gain) | 4/8 seeds net, 5/8 EWT, means identical. And *harmful* when the schedule is biased: tight → 1/5 seeds, slack → **0/5** | Stays `null` |
| Measure mid-route headway at the **release** instant | Urban EWT 52.4% → **43.6%**, won 1/6 seeds. Holds less, loses more than it saves | Reverted; code carries no switch |
| `MID_ROUTE_ACTION_RATIO` = 0.8 | Scored marginally better on one trial (+0.2% vs −3.1%) but inside seed noise and has **no principle** behind it | Kept at 1.0 = the corridor's own warning ratio |
| `warning_threshold_ratio` ≠ 0.50 | Swept 0.30–1.00. 0.50 best on urban (0.30 lost on **0/6** seeds); all values inside noise on inter-city | Left alone |
| `COST_OPTIMAL_SELECTION_ENABLED` | Occupancy off: 29.8% → 30.0% EWT, no real change. Occupancy **on**: issues **nothing at all** (λ proxy makes the load penalty H\*/2 per passenger) | Stays off |
| Auto-selecting alighting-only | Worse on **7/8** seeds; −9% of all passenger time in `slow_bus` on **every** seed. 415 passengers passed cost **103 extra hours** (~15 min each) vs the ~90 s the law reports | Stays proposal-only |

**Two traps that produced false positives — check for these before believing a win:**

1. A queue bug was deleting the passengers an action stranded, so the action
   measured as **free**. Alighting-only looked like a 7/8-seed win until it was
   fixed, then reversed to a 7/8-seed loss.
2. Relaxing `max_lateness_seconds` on urban looked like a **+16-point** gain until
   stranded passengers were counted; it is a 4-point **loss**.

---

## 7. Repro for the highest-priority open issue (task 1: calibrate λ)

**Claim:** `mpc/objective.ts#arrivalRatePaxPerSecond` returns `1/H*` — one
passenger per headway, where the trial's own corridors see 11–13. The objective
therefore overstates the harm of a hold by **3.4×**; with a correct λ it still
overstates by **1.8×**.

Save as `/tmp/objaudit.ts` and run with the env vars from §1:

```ts
import { simulate, noControlController } from './control-service/src/simulation/index.js';
import { createDeployedControlLawsController } from './control-service/src/rehearsal/deployedControlLaws.js';
import { buildRehearsalScenario, DEFAULT_MODELLED_INPUTS, REHEARSAL_EPOCH_MS, isReported } from './control-service/src/rehearsal/run.js';
import { buildFleetCorridor } from './control-service/src/fleetTrial/corridor.js';
import { CORRIDOR_PRESETS } from './control-service/src/fleetTrial/presets.js';
import { BUNCHING_SCENARIOS, scenarioRng } from './control-service/src/fleetTrial/scenarios.js';
import { computePassengerCost } from './control-service/src/mpc/objective.js';
// (use absolute paths; tsx will not resolve these relative from /tmp)

const preset = CORRIDOR_PRESETS.intercity;
const corridor = buildFleetCorridor(preset.corridor);
const H = corridor.policy.targetHeadwaySeconds;
const proxy = 1 / H;
let baseT = 0, ctlT = 0, predProxy = 0, predTrue = 0, holds = 0;

const pax = (v: any[]) => v.filter(x => isReported(x.vehicleId))
  .reduce((a, x) => a + x.boardingWaitPassengerSeconds + x.appliedHoldSeconds * x.onboardAfter, 0);

for (const sc of BUNCHING_SCENARIOS) for (const seed of [501, 502, 503]) {
  const inputs = { ...DEFAULT_MODELLED_INPUTS, ...preset.inputs, vehicleCount: 30, seed, disturbance: 'none' as const };
  const trueLambda = inputs.boardingRatePerMinute / 60;
  const built = buildRehearsalScenario(corridor, inputs);
  const plan = sc.build({ corridor, inputs, dispatches: built.scenario.dispatches, targetHeadwaySeconds: H,
    freeFlowSecondsTo: i => (corridor.stops[i]?.cumulativeDistanceMeters ?? 0) / (inputs.cruiseSpeedKmph / 3.6),
    rng: scenarioRng(seed, sc.id) });
  const scen = { ...built.scenario, dispatches: plan.dispatches, disturbances: plan.disturbances };
  baseT += pax(simulate(scen, noControlController).visits);
  const c = createDeployedControlLawsController({ policy: corridor.policy, epochMs: REHEARSAL_EPOCH_MS,
    modelledCapacity: inputs.vehicleCapacity, weighOccupancy: false,
    followerSpeedSource: 'vehicle_state', corridorStops: corridor.stops });
  ctlT += pax(simulate(scen, c).visits);
  for (const d of c.decisions) {
    if (d.holdSeconds <= 0) continue;
    holds++;
    const inp = { hFwdSeconds: d.hFwdSeconds ?? H, hBwdSeconds: d.hBwdSeconds,
      targetHeadwaySeconds: H, holdSeconds: d.holdSeconds, loadPassengers: d.onboardCount ?? 0 };
    const p = computePassengerCost(inp);
    predProxy += p.netPassengerSeconds;
    predTrue += p.waitPassengerSeconds * (trueLambda / proxy) + p.onboardPassengerSeconds;
  }
}
const actual = ctlT - baseT;
const h = (x: number) => `${(x / 3600).toFixed(0)}h`;
console.log(`holds=${holds}`);
console.log(`ACTUAL   ${h(actual)}`);
console.log(`proxy λ  ${h(predProxy)}  = ${(predProxy / actual).toFixed(1)}x overstated`);
console.log(`true λ   ${h(predTrue)}  = ${(predTrue / actual).toFixed(1)}x overstated`);
```

**Expected (the defect):** `proxy λ ≈ 3.4x`, `true λ ≈ 1.8x`.
**Wanted after the fix:** proxy row gone (λ read from the fitted model);
`true λ` row unchanged at ~1.8× — that residual is task 3, not task 1.

Fit the real λ with `pnpm sim:run --calibrate` (`control-service/src/evaluation/calibrate.ts`):
it fits `dwell = β₀ + β_h·h_preceding` from `stop_visits` and derives
`λ = β_h / β_b`. Wiring that into `arrivalRatePaxPerSecond` is the change.
It is a **live control-law change** — `cost_optimal_hold` is the argmin of the
quantity it feeds, so re-run the full trial on all three corridors before and
after, and check `COST_OPTIMAL_SELECTION_ENABLED` is still off.
