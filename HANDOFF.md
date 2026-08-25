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

**Put ad-hoc probes in `experiments/runs/`.** The source imports are relative, so
`tsx` cannot resolve them from `/tmp`; that directory is gitignored, and ESLint
skips it, so `pnpm lint` stays green while you investigate.

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

Green as of handover: **1,090** control-service tests, **1,741** web tests, build clean.

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

1. **Total passenger time** (`PassengerOutcome.totalPassengerSeconds`) — every
   second from arriving at a stop to alighting: **waiting + dwell + hold +
   riding**. **This is the headline.** It counted only waiting + hold until
   recently; see §3 bug 17 for why that was the wrong half and what it did to
   every number in this file's history.
2. **Excess wait time (EWT)** — seconds per waiting passenger. Secondary. It
   counts only people at stops, so it and (1) routinely move in *opposite*
   directions. Optimising EWT alone is how the controller measured net-negative.
3. **Total passenger time per boarding** (`passengerSecondsPerBoardingSavedPercent`)
   — the same trade, population-controlled. The arms do not serve identical
   crowds: demand is drawn from the stop-clock each arm's buses sweep, so the
   controlled arm carries 0.4–1.3% more people. Read it beside (1).
4. **On-time rate** — share arriving within ±300 s of the booked time.
5. **Denied boardings** — people refused because the bus was full. A HEADCOUNT
   (`firstTimeDeniedBoardings`); `deniedBoardings` counts refusal events, and one
   person turned away by three buses is three of those.
6. **Headway CV** — diagnostic only (scale-free; lengthening every headway
   uniformly "improves" it).

### Current values

250 buses/phase, **six seeds**, mean ± SD. `±` before the mean, always.

| | inter-city | suburban | urban |
|---|---|---|---|
| σ_leg / H\* | **0.19 (too_disturbed)** | 0.10 | 0.10 |
| net passenger time, blind | +0.1% ± 0.5 (3/6 seeds) | **+0.5% ± 0.3 (6/6)** | **+2.9% ± 0.3 (6/6)** |
| net passenger time, aware | −0.2% ± 0.4 (2/6) | +0.3% ± 0.3 (4/6) | **+2.2% ± 0.7 (6/6)** |
| excess wait, blind | +19% | +39% | +46% |
| hold/bus | 7.2 min | 3.2 min | 3.0 min |

**Urban is a win on every seed, and it is now a resolved number** — six seeds
spanning +2.5% to +3.3%. Suburban blind is a much smaller win on every seed.
**Inter-city is not "probably nothing", it is nothing** — ±0.5 around zero.

These bars are what they are because every draw takes its own keyed stream
(§3 bug 25). Before that the same table read ±1.5 to ±2.0 and inter-city could
not be told apart from a half-percent effect.

Where the time goes (urban, blind, per seed): waiting removed +611 h, dwell given
back +109 h, riding −58 h, holding −213 h, **net ≈ +449 h**. The hold bill is not
the whole in-vehicle story — dwell gives back about half of it, and riding costs
a little because a held bus carries more people for the ride. Inter-city reads
+42 h of dwell against −708 h of holding, which is why it cannot make the trade
pay.

Incidents, full 1,000-bus trial (500/phase):

| | inter-city | urban |
|---|---|---|
| left alone | 2,485 detected, 51% resolved | 4,726 detected, **8%** resolved |
| controlled | 2,666 detected, **68%** resolved | 2,726 detected, **40%** resolved |

### Targets

- Total passenger time **> 0 with seeds agreeing on every corridor**. Urban
  (+2.9% ± 0.3) and suburban-blind (+0.5% ± 0.3) clear it at 6/6. Inter-city does
  not: it is not negative, it is ZERO to within ±0.5, and the honest statement is
  "no measured effect".
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

**14. The chain handed to the laws was ranked by dispatch order, and sliced to
three.** Production ranks by POSITION (`state-estimation/ordering.ts`) and never
slices. Two consequences. A follower whose leader is standing through a hold
passes it — the arrival clamp enforces separation, not order — and the deciding
bus was then handed a "leader" physically BEHIND it on **1.5% of urban decisions
and 4.8% of inter-city ones**; the corridor being linear rather than a loop,
`computeGapMeters` read each as the wrap-around and invented a gap of 379 km on a
400 km route. And `corridorPaceKmph` — the divisor for a bus standing at a stop,
which the deciding bus always is — is the median speed of the MOVING vehicles in
the chain, so over three vehicles (one stationary by construction) it was null
whenever the other two were dwelling: **9.0% of pairs with a leader reported no
forward headway**, and Algorithm B declined 8.1% of all decisions
`h_fwd_unavailable`. Now 0.4% and 0.1%. Fix:
`control-service/src/simulation/engine.ts#neighbours` ranks by distance and hands
over every live vehicle; the adapter calls `computeLeaderFollowerOrder`.

**15. Two buses at one stop drew the same passengers.** The standing-window claim
happened at the DEPARTURE event, so a bus arriving in between read a queue front
that had not moved and was offered the same seconds again. **5.4% of the urban
stop-clock uncontrolled and 3.1% controlled**, so ~5% and ~3% of each arm's
boardings were invented — and the 2-point asymmetry went straight into the
contrast. Fix: the window is claimed at ARRIVAL, measured from the queue front.

**16. A hold was charged to people it did not delay.** Somebody who boards during
a hold was charged a wait term AND the full `appliedHoldSeconds × onboardAfter`.
Only the controlled arm has holds, so it inflated the price of control. Fix: the
engine computes `onboardDelayPassengerSeconds` over the pre-door population.

**17. Total passenger time was waiting plus the hold, which is the wrong half.**
Riding and dwelling were outside the metric entirely — a controller that made
every bus slower between stops would have scored unchanged. Both excluded terms
move with the controller and in its favour: passenger-weighted dwell is worst in
a bunch and falls when spacing evens out. **Urban, six seeds: holding cost 211–215
h while dwell gave back 90–100 h.** The percentage was wrong for the same reason —
its denominator was the uncontrolled arm's total, which without holds is waiting
alone, so **a saving worth 3% was reported as 12%**, and the same 4–7× inflation
applied to negative results too. Fix: `PassengerOutcome` counts every second
once, split four ways.

**18. Passengers boarded at the TERMINUS of a one-way corridor.** The last stop
kept the full boarding rate while emptying every bus, so people queued at the end
of the route, were charged waiting time, boarded a bus whose trip finished on the
spot, and were carried nowhere. **4.2% of urban boardings and 9.4% of the
measured wait saving, from one stop of twenty-five.** Fix:
`control-service/src/rehearsal/run.ts#isLastStop`.

**19. A truncated queue was charged half the window.** Boarding is oldest-first,
so a bus taking the fraction `f` takes people whose mean wait is `W(1 − f/2)`, not
`W/2`. A bus takes only part of a queue because it is FULL, which a bunched
service does more often — so the undercharge fell mostly on the uncontrolled arm.

**20. `assessScheduleFit` was a tautology.** The timetable is booked from the
uncontrolled arm's MEAN arrival, so that arm's MEAN deviation against it is
exactly zero (−1.05e-12 s on a real run, every corridor, every seed). The
tripwire CLAUDE.md names as the guard against this trial's largest silent failure
could not fire. Fix: the band is decided on the SHARE OF BUSES ALREADY PAST
`max_lateness_seconds` with no control — 38% urban, 41% inter-city, and it turns
at 75%.

**21. Denied boardings counted refusal EVENTS, not people.** A passenger refused
by three buses is three of them, while `boardings` counts a person once — so
`saturated` compared a rate with a headcount. And the arms repeat differently:
**23% of the uncontrolled arm's denials were repeats against 10% of the
controlled arm's**, so the event counts differed by 9 where the headcounts
differed by 223. Fix: a second watermark (offered vs carried) and
`firstTimeDeniedBoardings`.

**22. The detector swept the two arms over different windows.** Each arm stopped
at its own last departure, and holding makes buses finish later — ~0.5% more
sweeps for the controlled arm, and `incidentsAvoided` is a difference of the two
counts. Fix: one horizon for both.

**23. Adapter fidelity, three smaller ones.** The predictive advisory was fed
every safe candidate where `solver.ts` feeds it holds only. Alighting-only's
"leader must be at the head of the bunch" guard reads each leader's own gap out
of the list it is given, and over a two-row list that lookup misses — a missing
gap means "front-most bus on the corridor", so the guard passed on trust for half
its rows. Neighbour stop state was derived from a 5 km/h threshold with no
distance bound; production requires 2 km/h AND the geofence
(`state-estimation/stopStateClassifier.ts`, now called rather than restated).

**25. The two arms of a comparison were not running the same day.** Every draw
came off one stream in event order, so the NUMBER and ORDER of draws depended on
what the controller did - a held bus stands longer, so its late-boarder window is
non-empty where the other arm's was zero, and `nextNonNegativeCount` returns
early without consuming a draw when its mean is zero. One extra draw shifts every
subsequent one. **MEASURED: a SINGLE ONE-SECOND HOLD on ONE bus of 250 moved
whole-network total passenger time by +1.88% on one seed and −2.05% on another**,
with ~1% SD across eight target buses and a bimodal response (many probes exactly
0.000%, the rest jumping 1–2%) — a draw being added or reordered, not smooth
sensitivity. Against headline effects of +0.0% to +2.6%, the noise floor was the
size of the signal. Fix: every draw takes a stream keyed by `(seed, purpose,
vehicle, stop)` — `control-service/src/simulation/rng.ts#drawStream`. The same
probe now moves the network **0.003%**, and the six-seed spread falls 3–5×.

**24. The coverage table's largest population was misattributed.** The decline
ladder had no entry for `mpc/actionThreshold.ts#isWorthActingOn`, the gate all
three mid-route laws test BEFORE eligibility. **64.8% of urban decisions** were
reported as `no_hold_indicated` — "the law looked and decided against it" — when
the law returned before computing a hold at all. Fix: a `not_deviant_enough`
reason, and `two_way_covers_pair` moved after eligibility where
`selfEqualizing.ts` tests it.

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
  run at 200 buses/phase while the 3-seed mean showed −21%. Partly explained
  since: those figures were refusal EVENTS, and the two arms repeat their
  refusals at very different rates (§3 bug 21). Re-measure as a headcount before
  treating any of it as a mechanism.
- **Production's per-corridor action budget does not bind, and that is measured.**
  The adapter decides one vehicle at a time with an empty command ledger, so
  `max_concurrent_actions` (3 per corridor per 90 s cycle) and `cooldown_seconds`
  never apply. Over ten scenarios × three seeds the budget would have refused
  **3.6% of urban holds, 0% of inter-city ones**, and the cooldown 0% of both —
  real, small, and inside the seed noise. Not worth a command ledger; worth not
  claiming the per-vehicle projection is exact.
- **Holding points must be SPREAD along the route, not clustered at the origin
  — and the trial had it the wrong way round.** Its placement study designated
  the first n stations, on the CTA-pilot reasoning that an early correction has
  the rest of the route to propagate through. Measured at the same count, four
  seeds x ten scenarios:

  | | clustered at origin | spread along the route |
  |---|---|---|
  | urban, 6 of 25 | +1.14% | **+2.33%** |
  | suburban, 4 of 15 | +0.30% | **+0.65%** |
  | inter-city, 3 of 10 | +0.11% | +0.16% |

  Spreading is about **twice as good wherever holding points are scarce**, and
  the two converge once most stations are designated (19 of 25: +4.35% against
  +4.26%). Scarce is the regime that matters — `seed/harvest.ts` configures the
  real network at **one station in five** — so the study was recommending from
  a pattern the network does not use and that is half as effective at the
  density it runs at. Fixed in `fleetTrial/corridor.ts`. Physically it is the
  same story `controllability` tells: deviation accumulates between
  corrections, so corrections have to be distributed along the route it
  accumulates over.
- **Designating every station a holding point has not been optimal on any
  corridor tried.** A hold can only be executed where a bus is standing at a
  DESIGNATED stop (`mpc/eligibility.ts#holdExecutionStopId`), so the efficiency
  lever is `route_direction_stops.is_control_point` — not a new switch. Swept
  paired, four seeds x ten scenarios at 120 buses:

  | designated | urban | suburban | inter-city |
  |---|---|---|---|
  | ~a quarter | +0.53% @ 0.53 min/bus | +0.30% @ 0.79 | +0.12% @ 2.34 |
  | ~half | +3.27% @ 1.62 | +0.85% @ 1.73 | +0.39% @ 4.10 |
  | ~three quarters | +4.35% @ 2.37 | **+1.04% @ 2.43** | **+0.42% @ 5.74** |
  | every station | **+4.51% @ 2.92** | +0.96% @ 3.07 | +0.34% @ 6.56 |

  Suburban and inter-city both peak BELOW every station, taking 21% and 13%
  less driver holding with them; urban peaks at every station but 19 of 25
  returns 96% of the benefit for 81% of the holding. **On inter-city the whole
  column is inside the noise, and the driver cost varies eightfold across it —
  0.82 min/bus at two stations against 6.56 at ten.** That is the efficiency
  finding: on a corridor where holding does nothing, designate few stops rather
  than switching anything off.
- **`slow_bus` loses on every corridor, and it is not a bug.** Net −0.2% urban,
  −0.2% suburban, −1.8% inter-city, against 16–32% excess-wait gains. Checked:
  the controller holds the FOLLOWERS, not the culprit - 0 of 32 urban holds on
  the slow bus fall inside its slow zone, the rest are terminal-dispatch before
  it becomes slow. Holding cannot fix a leader. Urban still reads +1.0% PER
  PASSENGER there. If you want this scenario to win, the lever is an overtake or
  a short-turn, not a gain.
- **No gain setting rescues inter-city — tested.** Sweeping the forward gain
  paired across six seeds, holding HARDER is monotonically worse (`kf` 0.6 and
  0.8 lose on 5/6 seeds) and holding more gently does not help either (`kf` 0.2
  is still net-negative). Combined with the demand sweep below, that closes both
  obvious levers: inter-city's answer is the CORRIDOR (σ_leg/H\* = 0.19, above
  the controllable band), not the tuning. This is the evidence for task 4,
  per-corridor enablement.
- **Inter-city saturation is NOT why inter-city measures zero — tested, refuted.**
  It is near its seats on half its scenarios (denial share 14-18%, seeds to
  26.2% against a 20% bar), which is the textbook "controller cannot respond"
  regime. Scaling the boarding rate down x0.8 / x0.65 / x0.5 moves the denial
  share to 5.2% / 2.4% / 1.6% and moves net passenger time to -0.4% / -0.7% /
  -0.9% - marginally WORSE - while excess wait stays flat at ~20%. Both sides of
  the trade scale with demand (`occupancy = rate x H*/60 / alighting`, `waiting
  per headway = rate x H*/60`), so the ratio that decides it is invariant. Demand
  is not the lever here; sigma_leg/H* = 0.19 is. Do not re-fit the inter-city
  demand expecting a control result.
- **The laws act on a zero-lag headway; production's is up to a sweep old.**
  `headway/service.ts` writes `headway_states` every 60 s and the decision
  cycle solves against it up to 90 s later, so a deployed law reads a gap
  measured before the bus reached the stop. The adapter computes it at the
  decision instant. SIZED (sampling the corridor state 60 s apart, ten
  scenarios): h_fwd moves a mean of 34 s on urban (9.6% of H\*) and 24 s on
  inter-city (1.3%), and crosses `isWorthActingOn`'s bar on **5.0% of urban
  pairs and 0.6% of inter-city ones**. Real, and the same order as the action
  budget above. Not built, because modelling it properly retires
  `followerSpeedSource` - with a genuine sweep snapshot there is no
  speed-reporting range left to choose, you get what the sweep saw. Worth doing
  if urban's +3.0% ever has to survive a tighter argument than it does today.
- **The end-of-run residual queue is real and small — measured, don't redo it.**
  People still standing when the corridor empties never board, so
  `passengerOutcome` charges them nothing, and the arms do not empty together.
  `SimulationResult.stopQueues` exposes it. Priced against each STOP's own
  service window (the later of the two arms' last departure THERE) it changes
  the measured wait saving by **1.0% on urban, 0.3% on inter-city**. Not folded
  into the headline. **Measure it per stop or not at all**: against a single
  corridor-wide horizon the same residual reads 11% and 6.5%, and all of that
  excess is stops near the origin whose last bus passed hours before the last
  bus anywhere finished.
- **`evaluation/` sampled excess wait at CONTROL POINTS — fixed, and it
  reversed a verdict.** `rehearsal/run.ts#reportedKpis`, which the rehearsal and
  the whole evaluation harness share, sampled headway at holding points rather
  than at every station. That is `simulation/kpi.ts`'s regression-oriented
  default and the wrong population for a passenger question, and it ties the
  metric to the action — the fleet trial measured baseline EWT at 61 s with two
  holding points and 323 s with ten on the identical corridor and moved to every
  station (§3 bug 11); this never followed. On the harness's own synthetic
  corridor (12 stops, 3 control points) uncontrolled EWT read 149 s at control
  points against 205 s at every station. **The verdict changed with it**: the
  controller read "48% WORSE" on excess wait at control points and "no effect,
  slightly better" across every station.
- **`sim:run`'s synthetic corridor is `too_disturbed`, not too calm — and now
  says so.** σ_leg/H\* = 0.17, just above the 0.16 band, so both arms come apart
  together and a modest or negative result there is the corridor rather than the
  laws. `sim:run` computed nothing of the sort; `lib/controllability.ts` is now
  shared with the fleet trial and the report leads with the caveat.
- **`sim:run`'s synthetic corridor also saturates — measured, and left alone.** Its default demand (0.8/min) puts the steady-state load at 48 of
  52 seats, so across its own default scenario set 26.9% of offered passengers
  are denied and the report trips its own saturation warning; on the quiet
  `none` scenario alone it is 19%, a hair under, so any disturbance trips it.
  Lowering the rate to 0.5 removes the saturation (2.6% denied) but the corridor
  then barely comes apart — uncontrolled EWT 24 s against a 900 s headway, and
  the controller measures **98% worse** because holding a well-spaced corridor
  is harmful. At 0.8 the same quiet day reads 30 s and 48% worse. **Demand is
  not the lever**; σ_leg/H\* is, and `sim:run` does not compute it, so a reader
  cannot see which regime they are in. Two things worth doing: give `sim:run`
  the `controllability` diagnostic the fleet trial reports, and re-calibrate
  that corridor to come apart at a moderate load. Left at 0.8 rather than
  half-corrected — swapping one trap for the other changes every recorded number
  without making the harness able to answer.
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

**(The list below is the original one, kept verbatim. Item 1 has since been
measured and it is NOT the highest-value change — see §7. Calibrating λ moves
the objective's wait term from 1.4% of the truth to 10%; the remaining 10× is
the one-stop horizon, which is item 3. Item 4 now has its evidence: no gain
setting rescues inter-city, and neither does its demand.)**
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
| `Kb` 0.2 → 0.4 | Was "coin flip, 4/10 seeds". **RE-RUN paired on common random numbers: 0.4 is worse on 6/6 urban seeds by 0.36 points, 0.3 worse on 6/6, 0.1 worse on 5/6.** Not a coin flip — 0.2 is a resolved optimum | Confirmed |
| `ks` (schedule-correction gain) | Was "4/8 seeds, means identical". **RE-RUN: every value tested is worse than `null` — 0.15 on 6/6 urban seeds, 0.35 on 5/6, 0.6 on 5/6**, each by about 0.2 points | Stays `null`, now measured |
| **Joint `kf` × `kb` grid** (12 combinations, paired, timetable booked so the punctuality guardrail binds) | Urban spans **+4.26% to +4.63%** — 0.37 points across a 2× range of `kf` and a 3× range of `kb` — and the best combination beats the shipped one by **0.12 points**, inside the ±0.3 seed noise. Inter-city spans 0.12 points, headroom **0.03**. Decisively: **hold per bus is 2.7–3.0 min across the whole urban grid**, so the GUARDRAILS set how much holding happens, not the gains | Confirmed flat. Do not re-tune |
| `kf` ≠ 0.4 (never previously swept) | 0.2 worse on **6/6** urban seeds (−0.47 pts); 0.6 indistinguishable (3/6, −0.05); 0.8 worse on 4/6. On **inter-city, holding harder is monotonically worse** — 0.6 and 0.8 lose on 5/6 seeds and even 0.2 is still net-negative | 0.4 confirmed; a local optimum |
| Measure mid-route headway at the **release** instant | Urban EWT 52.4% → **43.6%**, won 1/6 seeds. Holds less, loses more than it saves | Reverted; code carries no switch |
| `MID_ROUTE_ACTION_RATIO` = 0.8 | Scored marginally better on one trial (+0.2% vs −3.1%) but inside seed noise and has **no principle** behind it | Kept at 1.0 = the corridor's own warning ratio |
| `warning_threshold_ratio` ≠ 0.50 | Swept 0.30–1.00 by hand on the old headline, then **re-swept in the trial itself** (`policyStudies`, 3 seeds, paired): 0.50 best on BOTH corridors, 3/3 seeds. 0.75 and 1.00 keep improving excess wait (to 54.6% urban, 27.3% inter-city) while total passenger time falls — the EWT/total divergence, visible in a table | Confirmed. Re-runnable now |
| `COST_OPTIMAL_SELECTION_ENABLED` | Occupancy off: 29.8% → 30.0% EWT, no real change. Occupancy **on**: issues **nothing at all** (λ proxy makes the load penalty H\*/2 per passenger) | Stays off |
| Auto-selecting alighting-only | **This entry no longer reproduces — see below.** Was: worse on 7/8 seeds; −9% of all passenger time in `slow_bus` on every seed | Stays proposal-only, for a different reason |

**The gain surface is flat because the guardrails clip it, and that is measured.**
`isWorthActingOn` gates 65% of decisions before a hold length is ever computed,
`max_lateness_seconds` refuses roughly three quarters as many holds as are
issued, and `maxHoldSeconds` caps what survives. A gain only sets the length of
the holds that get through all three. The proof is that **hold per bus barely
moves across the whole grid** (2.7–3.0 min on urban over a 2× `kf` range) while
the POLICY thresholds move the result an order of magnitude more: the mid-route
action bar swings net passenger time from **+0.6% to +4.1%** across its sweep,
against 0.37 points for every gain combination put together. **Tune thresholds
and enablement, not gains.**

**And beware sweeping gains without a timetable.** Run with
`scheduledArrivalSeconds` unset, `scheduleDeviationSeconds` is null everywhere,
`max_lateness_seconds` never binds, and the punctuality guardrail is simply off
— holding doubles to 6.2 min/bus and the apparent optimum moves to a completely
different corner of the grid (`kf` 0.3 / `kb` 0.3, "0.65 points of headroom").
That is a different controller, and its answer does not transfer.

**Why these now resolve when they did not before.** Both fixes matter. The
headline used to be waiting plus the hold over a waiting-only denominator (§3
bug 17), and the two arms used to draw different random numbers the moment
anything was held (§3 bug 25) — a noise floor of ±1 to ±2 points against
effects of a few tenths. Paired properly, differences of 0.2 points separate
cleanly on 6 seeds. **Anything in this table measured before those two fixes
should be re-run before it is quoted.**

**Alighting-only was re-measured after the metric fixes and the verdict changed.**
The old numbers were taken on the old headline — waiting plus the hold, over a
waiting-only denominator, with passengers still boarding at the terminus — and
none of them survives. Re-measured, six seeds, 250 buses/phase, urban,
occupancy-blind: acting on it is better on **3/6 seeds by total passenger time**
(mean +0.25 points) and **5/6 per passenger** (mean +0.29); in `slow_bus`
specifically, better on **4/6**, mean +1.49. By this file's own rule that is **no
measured effect**, not a win. It stays off — but because it is unpriced and
leaves real passengers standing with no measured benefit to justify it, NOT
because it loses. Nobody can say it loses any more.

**Every other row in the table above was also measured on the old headline.** Any
of them could move the same way. Before quoting one, re-run it.

**Two traps that produced false positives — check for these before believing a win:**

1. A queue bug was deleting the passengers an action stranded, so the action
   measured as **free**. Alighting-only looked like a 7/8-seed win until it was
   fixed, then reversed to a 7/8-seed loss.
2. Relaxing `max_lateness_seconds` on urban looked like a **+16-point** gain until
   stranded passengers were counted; it is a 4-point **loss**.

---

## 7. The objective, re-measured — and it is not a λ problem

**The old claim** was that `mpc/objective.ts#arrivalRatePaxPerSecond` returns
`1/H*` where the corridors see 11–13 passengers per headway, so the objective
"overstates the harm of a hold by 3.4×, and 1.8× with a correct λ". That was
measured against a headline counting waiting plus the hold over a waiting-only
denominator, on arms that diverged at the first hold.

**Re-measured on the corrected metric with the arms paired (10 scenarios × 3
seeds, 120 buses/phase), the diagnosis changes completely.** The objective's
COST side is nearly right. Its BENEFIT side is wrong by a factor of ten to
seventy, and on the corridor where the controller works it therefore has the
**wrong sign**:

| urban, 20,423 holds | actual | objective, 1/H\* proxy | objective, correct λ |
|---|---|---|---|
| waiting | **−10,799 h** | −147 h | −1,081 h |
| onboard, from the hold | +6,775 h | +7,914 h | +7,914 h |
| dwell | −2,362 h | *not modelled* | *not modelled* |
| riding | −81 h | *not modelled* | *not modelled* |
| **net** | **−6,466 h (a SAVING)** | **+7,768 h (a COST)** | **+6,833 h (a COST)** |

Inter-city has the same shape and keeps its sign only because the cost is
genuinely larger there: waiting −15,333 h actual against −519 h / −6,083 h
predicted, onboard +19,180 h against +21,727 h, net +4,395 h actual against
+21,208 h / +15,644 h predicted — still **4.8× / 3.6×**, worse than the 3.4× /
1.8× on record.

**The error has a shape, and it points at the fix.** Wait term, all three
corridors, actual against the objective with a correctly fitted λ:

| corridor | stations | actual waiting removed | objective says | ratio | mean stops downstream of a hold | ratio ÷ that | σ_leg/H\* |
|---|---|---|---|---|---|---|---|
| urban | 25 | −10,799 h | −1,081 h | **10.0×** | ~12.5 | 0.80 | 0.10 |
| suburban | 15 | −6,405 h | −1,196 h | **5.4×** | ~7.5 | 0.72 | 0.10 |
| inter-city | 10 | −15,333 h | −6,083 h | **2.5×** | ~5 | 0.50 | 0.19 |

The ratio tracks **how many stops are left downstream of the hold**, discounted
by how well a correction survives between them — and that discount falls exactly
where `controllability` says corrections wash out. Which is the multi-stop wait
term stated as a measurement: the benefit of evening a gap accrues at every stop
the correction survives to, and it survives fewer of them on a corridor where
more deviation accumulates between two stations than a hold at either can
remove. Three points, one seed-set each, so treat it as a shape rather than a
formula — but a multi-stop term of that form is the thing to build, and this is
the number to check it against.

The COST side is consistently good across all three: 7,914 h predicted against
6,775 h actual on urban, 7,571 against 6,763 on suburban, 21,727 against 19,180
on inter-city — 12–17% over, every time.

**A concrete form to try, and the numbers it would have to reproduce.** If the
benefit of evening a gap decays geometrically along the route — a correction
worth `b` at the next stop is worth `b·ρ` at the one after — then over `N`
remaining stops the objective's wait term should carry a factor of
`(1 − ρᴺ) / (1 − ρ)` rather than 1. Solving that against the three measured
ratios gives ρ ≈ **0.94** (urban, N≈12.5, ratio 10.0), **0.88** (suburban,
N≈7.5, 5.4) and **0.65** (inter-city, N≈5, 2.5).

Do not ship those numbers. Three points cannot fit a decay constant, and urban
and suburban share a σ_leg/H\* of 0.10 while wanting different ρ, so whatever
sets ρ is not controllability alone — `1 + β_h`, the headway amplification
eigenvalue `evaluation/calibrate.ts` already fits, is the obvious candidate and
is derivable rather than fitted. The value of the above is that it says what to
build and gives three numbers to check it against, which "the residual is
structural" did not.

**How much can this error actually do?** Not much, today, and that is measured
too. `objectiveCost` feeds three things: the ranking among mid-route candidates,
`cost_optimal_hold`'s length (not selectable), and the predictive advisory
(decides nothing). The ranked pool is two-way holding OR self-equalizing, and
those are disjoint by construction — **across 178,500 decisions on all three
corridors it held more than one candidate on ZERO of them**. So the objective's
sign error cannot mis-select an instruction today. What it does corrupt is a
number an operator and a future engineer both read, and it is the number that
decides whether the closed form ever gets switched on.

**What this means for the task list.** Calibrating λ takes the wait term from
1.4% of the truth to 10% on urban — a real sevenfold improvement, and nowhere
near enough. The error is the one §4 suspected and it is now measured: the wait
term `λ·d·(d + h_fwd − h_bwd)` is a ONE-STOP marginal estimate of a benefit that
accrues over the whole downstream route and to every following bus, and urban
has twenty-five stops. **λ is not the highest-value change; the horizon is.**
And it is the strongest argument yet for keeping `COST_OPTIMAL_SELECTION_ENABLED`
off: the argmin of a function that sees a tenth of the benefit will always
choose a hold near zero.

**Repro.** `experiments/runs/` is gitignored, so no probe survives a clone —
rebuild it from the sketch below, which is the same shape. The one change that
matters against the old version: compare the objective's two terms against the
measured wait and onboard changes SEPARATELY, not against the net. The net hides
that one half is right and the other is off by an order of magnitude, which is
the whole finding.

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
