# The fleet trial

A thousand simulated buses on a 400 km corridor with ten holding points, run
twice — once through the deployed control laws, once with nobody intervening —
across ten ways a corridor comes apart, in two phases that differ in exactly one
input.

    pnpm --dir control-service sim:fleet
    pnpm --dir control-service sim:fleet --vehicles 250 --out experiments/runs/fleet

The console lives at **`/ops/control-room/simulator`** (control-room role). The
control service exposes `POST /v1/fleet-trial` and `GET /v1/fleet-trial/latest`;
the last report is held in memory, so a page refresh shows the same numbers
rather than silently re-running the experiment.

## What is tested and what is only the rig

**Tested** — all of it imported from the module the live decision cycle imports
it from, never reimplemented: the four control laws and their gains, the hard
safety filter, the selection rule, the occupancy switch, and both tiers of the
bunching detector (replayed at the deployed 60-second sweep cadence).

**The rig** — invented here, and labelled `modelled` in every report: the
corridor's geometry, the running times, the passenger demand, the seat count,
the disturbances and the fleet size. No seeded route-direction has this shape and
none has ever recorded a passenger.

That line is the product. A planner reading a result needs to know the CONTROL is
the deployed one and the TRAFFIC is a guess, not the other way round.

## Why total passenger time is the headline, not excess wait

Excess wait time counts only the people standing at stops. Holding a bus to fix
their spacing is paid for by everyone already aboard, and on this corridor a bus
carries about forty-five people while eleven wait at the next station — so the
bill is four times the saving.

The trial measures both halves off the simulated day rather than estimating them:

- **waiting** — `boardings × leaderHeadway / 2` over every stop visit
- **onboard delay** — `applied hold × passengers aboard` over every visit

Their sum is the same quantity `mpc/objective.ts` claims to minimise
(`netPassengerSeconds`), computed from the outcome instead of predicted from one
decision — so a gap between them is a statement about the objective. The first
run of this trial cut excess wait 46% and made total passenger time 12% **worse**.

## What the trial found, and what was changed

Each of these was a real defect in deployed code, found by the trial and fixed
with a test pinning it.

### 1. The headway estimator was blind at exactly the moment it mattered

`h_fwd` was `gap ÷ instantaneous speed`, floored at `MIN_SPEED_KMPH = 1`. A bus
standing at a stop therefore reported a headway of hours — and standing at a stop
is the **only** state a hold can be executed from (`mpc/eligibility.ts`). The
system asked "how bunched is this pair?" at precisely the moment its own
estimator could not answer.

One pair 4 km apart on a corridor whose nominal gap is 30 km, same instant, three
reported speeds:

| follower speed | h_fwd | ratio | detector | two-way |
|---|---|---|---|---|
| 60 km/h | 240 s | 0.13 | **bunched** | hold 600 s |
| 12 km/h | 1,200 s | 0.67 | fine | hold 252 s |
| 0 km/h (dwelling) | 14,400 s | 8.00 | fine | **no candidate** |

Across the trial this silenced 95% of two-way holding (2,373 generated candidates
down to 122) and cut the excess-wait improvement from 44% to 10%. It is the same
arithmetic that made Algorithm A incapable of ever firing — see
`test/terminalDispatch.test.ts`. That law was given a measured departure headway;
the mid-route laws and the detector were left on the broken divisor.

**Fix** (`headway/metrics.ts`): a stationary vehicle is measured against
`corridorPaceKmph`, the median speed of the vehicles on the corridor that *are*
moving. A moving vehicle is unaffected. When nothing on the corridor is moving
there is no pace to borrow and the headway is `null` — no opinion — rather than a
fabricated large number.

### 2. The laws acted on pairs their own detector would not report

They are proportional controllers, so `Kf × (H* − h_fwd)` is non-zero for any
shortfall. **83%** of proposed holds went to pairs above the corridor's
`warning_threshold_ratio` — pairs no operator would ever have been shown. The
median pair being held sat at 0.70 of target headway.

**Fix** (`mpc/actionThreshold.ts`): a mid-route law declines below the corridor's
own warning threshold. Terminal dispatch is deliberately **not** gated — it holds
a bus nobody is on yet, so it does not incur the cost this bar exists to bound.

The multiplier on that ratio is `1.0` and not a fitted number. A sweep scored
marginally better at `0.8` (net passenger time +0.2% against −3.1%) and `0.8` was
rejected anyway: the difference was inside one trial's seed noise, and it is a
number with a good score and no argument behind it.

### 3. The occupancy switch could not do the job it exists for

`control_settings.weigh_occupancy` feeds the load into `objectiveCost`, which is
a **ranking** input — and the mid-route laws are mutually exclusive by
construction, so there is never a second selectable candidate for a ranking to
reorder. Measured across 4,960 matched decisions, switching it on changed the
price of every hold and **not one of the decisions**.

**Fix** (`mpc/actionThreshold.ts#occupancyAdjustedMaxHoldSeconds`): the load binds
on the **action**. A near-empty bus may be held to the policy's full cap; a full
one may barely be held at all, with a floor so a crush-loaded corridor is not
silenced entirely. Paired, this cuts onboard delay 39% and the switch now changes
about a third of the instructions.

It is a linear taper rather than `objective.ts#optimalHoldSeconds`, which is the
exact argmin and the right answer the day lambda is calibrated. It cannot be used
today: `arrivalRatePaxPerSecond` returns `1/H*` — one passenger per headway, where
this corridor sees eleven — so the load penalty overwhelms the wait term and a
single passenger would zero every hold. A taper is cruder and bounded: it can
shorten a hold, never invert one.

### Three ways the harness had been flattering production

Fixed alongside, because a trial that is kinder than reality cannot find defects:

- `minimum_action_seconds` was hardcoded to `0`, silently disabling a guardrail
  production enforces.
- Only the *deciding* bus got a `VehicleStateRow`, so `boardingLimit.ts` could
  never pass its leader check and reported 0% coverage for a reason belonging to
  the harness.
- The laws were fed the engine's link-average pace where production reads
  `vehicle_states.speed_kmph`. Both ends are now selectable
  (`followerSpeedSource`); the trial defaults to the pessimistic one, which is
  the row the deployed solver actually reads.

### 4. Holding everywhere is the most expensive way to run the corridor

The corridor's ten stations are all *eligible* to hold a bus. Which of them are
*designated* turns out to be the largest single lever in the trial. Averaged
over five seeds, occupancy-blind, 250 buses per phase:

| stations holding | excess wait | total passenger time | hold per bus |
|---|---|---|---|
| 3 of 10 | −3.8% | −0.61% | 2.9 min |
| 5 of 10 | **−13.2%** | **−0.45%** | 5.7 min |
| 10 of 10 | −20.8% | **−4.95%** | 11.7 min |

Ten holding points buys the largest wait improvement and is net-negative on
*every* seed (−4.1% to −7.0%). Five gets two-thirds of the benefit at half the
punctuality cost and is roughly break-even. This is the CTA finding
`mpc/eligibility.ts` already cites, reproduced on this corridor: placement
matters more than count, and holding everywhere spends driver goodwill where it
achieves nothing.

Every report now carries this comparison (`holdingPointStudy`), and the console
shows it.

Every row is averaged over three seeds and reports how many of them agreed with
the sign of the mean. That is not decoration — see "one seed is not a
measurement" below.

**A measurement bug found while doing this**, worth recording because it would
have produced a confident and completely wrong answer: excess wait was being
sampled at *control points only*. Changing the placement therefore changed the
measurement population, and baseline EWT read 61 s with two holding points and
323 s with ten — on the identical uncontrolled corridor. The trial now samples
every station, which is also the more honest definition: passengers wait at all
of them.

### 5. Nothing stopped the controller compounding its own damage

Single buses were accumulating over an hour of hold across a trip, because no
part of the system asked how late a bus already was before holding it again.

The deployed system has the guardrail — `mpc/objective.ts` charges for the
lateness a hold *adds*, and `mpc/safety.ts` refuses one that would push a bus
past `route_policies.max_lateness_seconds`. Both are inert on the live network
for the same reason: `trips` and `trip_stop_times` are empty, so every schedule
deviation is null, the term contributes nothing and the bound rejects nothing.
The trial had faithfully reproduced that, which meant it was measuring a
controller with its punctuality guardrail switched off.

**Fix**: the trial now books its own timetable — free-flow running plus a
nominal dwell at every stop, so the schedule is achievable rather than
aspirational — and `simulation/` carries it through
(`ScenarioConfig.scheduledArrivalSeconds`). A scenario that supplies none still
gets exactly today's behaviour: null deviation, no lateness cost, no bound.
"On time" and "no schedule exists" are opposite statements and a zero would have
told the objective every bus was perfectly punctual.

With the bound set to 300 s, paired across eight seeds:

| | unbounded | 300 s bound | seeds favouring the bound |
|---|---|---|---|
| hold per bus | 353 s | **228 s** | **8 of 8** |
| worst single bus | 2,050 s | 1,665 s | — |
| instructions issued | 270 | 217 | — |
| excess wait gain | 7.4% | **10.2%** | 5 of 8 |
| total passenger time | −2.14% | **−0.99%** | 6 of 8 |

Less holding on *every* seed, and the wait benefit went up rather than down.
Refusing to hold an already-late bus removes the controller's least valuable
interventions, so nothing is given up by declining them. `max_lateness_seconds`
is a `route_policies` column — this is a configuration change, not a code one.

### Two things the trial checked and did not change

**The occupancy taper is not a flat cap in disguise.** The obvious objection to
finding 3 is that loads sit around 80% of capacity most of the time, so
`max(0.25, 1 − load)` is pinned at its floor and the taper is really just
"hold for a quarter as long". Measured against flat caps at the same corridor:

| | excess wait gain | total passenger time | hold per bus |
|---|---|---|---|
| no cap change (600 s) | 29.8% | −3.89% | 723 s |
| flat cap 300 s | 19.2% | −2.73% | 448 s |
| flat cap 200 s | 17.6% | −1.08% | 304 s |
| **taper (cap 600 s)** | **21.4%** | **−1.28%** | 511 s |

The taper beats the flat 300 s cap on *both* axes and beats the 200 s cap on
wait gain at comparable net. A flat cap shortens every hold equally; the taper
spends the budget on the buses where a hold is cheap and withholds it where it
is expensive, and that is worth about two points of wait gain.

**Letting the closed-form optimum compete changes almost nothing — and going
silent is exactly what it does with occupancy on.** `cost_optimal_hold` is
generated and scored on every solve but is not selectable
(`COST_OPTIMAL_SELECTION_ENABLED`). Flipping it:

| | excess wait gain | total passenger time | which laws issued holds |
|---|---|---|---|
| tuned laws only | 29.8% | −3.89% | two-way 1062, terminal 616 |
| cost-optimal selectable | 30.0% | −4.18% | terminal 621, **cost-optimal 523**, two-way 510 |
| cost-optimal + occupancy on | 21.4% | −1.28% | two-way 1069, terminal 622, **cost-optimal 0** |

With occupancy off it takes over half the mid-route holds and lands in the same
place — with no load to weigh, `optimalHoldSeconds` reduces to the even-headway
split, which is near what the tuned gains already produce. With occupancy on it
issues **nothing at all**: the proxy `lambda = 1/H*` makes the load penalty
`H*/2` seconds per onboard passenger, so a single passenger zeroes every hold.
That is the tripwire `mpc/objective.ts` and `CLAUDE.md` describe, observed for
the first time rather than reasoned about. The flag stays off, and the argument
for calibrating lambda before touching it is now a measurement.

### How good is the objective's own arithmetic?

`mpc/objective.ts` predicts a passenger cost for every hold it scores. The trial
can check that prediction against what the simulated day actually did — the same
quantity, once estimated from one decision and once measured from the outcome.
Over 2,099 issued holds:

| | change in total passenger time |
|---|---|
| **actually measured** | +1,172 h (3.8% worse) |
| objective predicted, proxy `lambda = 1/H*` | +3,945 h (**3.4× overstated**) |
| objective predicted, true `lambda` | +2,159 h (**1.8× overstated**) |

Three things follow, and they are not the same thing:

1. **The sign is trustworthy.** The objective said holding was net-harmful on
   this corridor and it was. That is the part a guardrail needs.
2. **The magnitude is not.** Even with a correctly calibrated arrival rate it
   overstates the harm by nearly a factor of two, because the wait term
   `lambda x d x (d + h_fwd − h_bwd)` is a *one-step marginal* estimate of a
   *multi-stop* effect: it counts the passengers at the next stop and cannot see
   that even spacing keeps `sum(h²)` down for the rest of the route.
3. **Calibrating lambda halves the error** (3.4× → 1.8×). That is a real
   argument for wiring the fitted value in, and a real limit on what doing so
   would buy.

This is why `cost_optimal_hold` must not be let loose on the strength of a
calibration alone. It is the argmin of a function that is directionally right
and quantitatively pessimistic, so it would hold less than it should — and with
the proxy in place, not at all.

No code was changed for this finding. It is a measurement about deployed
arithmetic, recorded so the next person to reach for
`COST_OPTIMAL_SELECTION_ENABLED` has a number instead of an argument.

### One seed is not a measurement (and a result that did not survive)

Net passenger time on this corridor has a seed-to-seed spread of about ten
percentage points — single runs of the identical configuration returned −6.0%
and +3.9%. That is wider than most differences the trial is trying to detect.

A gain-tuning result went the whole way through that trap. Over three seeds,
raising `Kb` from 0.2 to 0.4 appeared to improve **both** metrics at once (net
−3.57% → −2.25%, excess wait +10.9% → +14.2%) — an unusually clean result, and
a plausible mechanism: `Kb` is the backward gain, so raising it means more
restraint when a bus is close behind, which should damp the holding cascade.

Paired across ten seeds it is a coin flip:

| | Kb = 0.2 | Kb = 0.4 | seeds favouring Kb = 0.4 |
|---|---|---|---|
| net passenger time | −1.54% | −1.36% | 4 of 10 |
| excess wait gain | 12.2% | 12.6% | 5 of 10 |

**No change was made.** This is the rule `control-service/src/evaluation/` already
states — a difference whose interval spans zero is no effect however large its
mean — and it is the reason the holding-point study reports seed agreement
alongside every row rather than a bare average.

### 6. The corridor decides the answer, so there are now two of them

Almost every conclusion above is a property of the corridor as much as of the
controller. Running one shape reports the corridor's arithmetic as if it were
the algorithm's — so `fleetTrial/presets.ts` carries two, and the console lets
you pick.

| | 400 km inter-city | 24 km urban |
|---|---|---|
| headway | 30 min | 6 min |
| stops | 10, 44 km apart | 25, 1 km apart |
| dwell | 120 s | 20 s |
| aboard when held | ~44 of 55 | ~29 of 60 |
| **excess wait** | **−25.3%** | **−51.5%** |
| **total passenger time** | **−1.0%** | **+17.2% saved** |
| punctuality cost | 6.8 min/bus | 2.6 min/bus |

The controller is *strongly* net-positive on the urban corridor and roughly
break-even on the inter-city one — and a third shape, a 60 km suburban radial at
a twelve-minute headway, sits cleanly between them (38.0% excess wait, +2.3% net).
It is a **gradient, not a threshold**.

**What predicts it is not what I first assumed.** An earlier version of this
document said the difference was the arithmetic of a corridor carrying
forty-four people while eleven wait. That is wrong: the aboard-to-waiting ratio
is ~4× on *all three* shapes. Varying headway, stop count and route length
independently from the urban corridor collapses onto one quantity — the standard
deviation of **one leg's running time as a fraction of the target headway**:

| σ_leg / H\* | 0.02 | 0.03 | 0.05 | 0.10 | 0.16 | 0.24 | 0.30 | 0.48 |
|---|---|---|---|---|---|---|---|---|
| excess-wait gain | 14% | 41% | 59% | 59% | 40% | 22% | 13% | 7% |

An inverted U peaking around 0.05–0.10. Below the band the corridor barely comes
apart and there is little to recover; above it, more deviation accumulates
between two stops than a hold at either can remove, and both arms come apart
together. The inter-city corridor sits at **0.19** — above the band, which is
why holding buys it least — and that is the same effect that made it unusable
at a 900 s headway (see "The corridor, and why it is shaped this way").

Every report now carries this figure and says which side of the band the
corridor is on, because it is the first thing that should be read before
blaming or crediting the control laws.

**A bug found while building this**, and it is the reason the urban numbers
appeared for a while to say the opposite: the trial's default `inputs` were
spread *after* the preset's, so asking for the urban corridor got urban
*geometry* with inter-city *traffic* — 0.38 boardings/min against 1.2, a 120 s
dwell against 20 s. The corridor came out four times too lightly loaded, barely
bunched, and the controller looked useless on it. A shape and its traffic cannot
be mixed.

### 7. Passengers a full bus turned away were vanishing

The engine swept a stop's waiting queue to the arrival instant every time a bus
called, regardless of how many people it could actually take. So everyone a full
bus refused was counted once in `deniedBoardings` and then **ceased to exist** —
they waited for nothing, boarded nothing, and appeared in no passenger-time
figure at all.

That is not a rounding error on a corridor where the whole point of control is
to stop buses arriving to double queues. A configuration that stranded three
times as many people scored the *same* on total passenger time as one that did
not, and the trial had no way to see the difference.

**Fix**: passengers arrive uniformly across the window and board oldest-first, so
a bus that takes `served` of `offered` now clears exactly the oldest
`served/offered` of the window and leaves the rest standing — for the next bus,
and the one after that if it is full too. Alighting-only is the same rule with
`served = 0`, so the two cases stopped needing separate handling.

**It reversed a conclusion.** Before the fix, relaxing `max_lateness_seconds` on
the urban corridor looked like a 16-point gain in total passenger time. With
stranded passengers actually counted it is a 4-point **loss** (13.7% → 9.9%),
because holding harder strands more people and their waiting time now shows up.
The shipped setting was right; the metric that said otherwise was blind.

**A second bug surfaced underneath it.** Once the queue persisted, the WARM-UP
bus could no longer do its job — it exists to absorb the fictional queue standing
at a stop since simulated second zero, and it cannot absorb a crowd it has no
room for. Denied boardings rose fifteenfold. The real fix was to stop inventing
the crowd: a stop's queue now starts when its **first bus arrives**, not at
second zero. `test/rehearsal/run.test.ts` asserts that directly instead of
bounding the artefact's size, because the artefact can no longer happen.

### 8. A held bus was absorbing passengers for free

The engine drew boardings **once**, at the arrival instant, and then swept the
queue to the **departure** instant. Everyone who turned up while the bus was
standing at the stop was therefore deleted without ever boarding.

For an ordinary dwell that is a small leak. For a hold it is not, and it leaked
in the direction that flatters holding: a bus held ten minutes absorbed ten
minutes of arrivals for nothing, so its onboard load — and with it the
onboard-delay cost of holding, and the occupancy taper that prices that cost —
were all understated.

They now board, capacity permitting, and anyone who still cannot fit stays for
the next bus. They cost no extra dwell: during a hold the bus is standing
anyway, and during the dwell their boarding time is already counted — a second
dwell term would charge twice for the same door cycle.

The waiting figure moved into the engine as part of this
(`StopVisitRecord.boardingWaitPassengerSeconds`), because only the engine can
tell the two populations apart. It used to be reconstructed as
`boardings × leaderHeadway / 2`, which charges someone who walked onto a *held*
bus the same wait as someone who had been standing there since the last one left.

**Effect on the headline**: with waiting and stranding both counted properly,
*both* corridors are net-positive — inter-city +0.9% and urban +12.4% of total
passenger time, at 18.8% and 49.4% excess-wait improvement respectively.

**It broke a regression test, correctly.** `test/simulation/controllers.test.ts`
asserts a self-equalizing controller lowers headway CV across 60 paired seeds,
and it started failing. Investigated rather than adjusted: on that fixture — four
buses, six stops, mild link variance — the controller applies about **sixty
seconds of hold across an entire run** and wins on 50% of seeds. It was a coin
flip, and the model change moved which side it landed on. Doubling the link
standard deviation and running ten buses gives the law something to correct:
hold rises to ~370 s per run and the controlled arm wins on 62% of seeds with a
clearly lower mean. Same law, same gain — the difference is a corridor where
control is the thing being measured.

### 9. Scenarios were describing the opposite of what they claim

A scenario's demand and variability overrides were **absolute numbers**, tuned
for the inter-city corridor. On the urban corridor they inverted:

- `peak_load` set 0.48 boardings/min against an urban default of **1.2**, so the
  scenario whose entire purpose is to load the corridor up became the *lightest*
  one it runs.
- `steady_variability` set 0.16 against a default of **0.18**, quietly making the
  corridor *calmer* than an ordinary day.

Both were still reported under their own names. A scenario is a perturbation,
and a perturbation only means anything relative to what it perturbs, so
`BunchingScenario.inputScale` is now multiplicative — `peak_load` is ×1.3
boardings, `cascade` is ×1.6 variability — and means the same thing on any
shape.

### 10. A bus nobody can see was still being used as a leader

The deciding vehicle's staleness was modelled; its **neighbours'** was not.
Production's state estimator drops a low-confidence vehicle from the chain
*before* any headway is computed, so the buses either side of it are linked to
each other. The engine was handing a bus whose feed had gone dark straight to
the control laws as a leader — with an exact position and a fresh timestamp,
which is precisely the thing production guarantees cannot happen. `neighbours()`
now skips it, and a test asserts no decision ever names a dark bus as its leader.

### 11. The timetable was absorbing the disturbance it was meant to measure

Each bus's timetable was booked from **its own actual departure**. In
`terminal_jitter` — the scenario whose entire subject is buses leaving off their
slots by up to a third of a headway — that made the schedule self-fulfilling:
every bus left exactly "on time", no lateness was ever recorded, and both
deployed punctuality guards (the objective's lateness term and the max-lateness
bound) had nothing to act on in the one scenario built to exercise them.

A timetable is what was *promised*; the scenario is what happened. It is now
booked from the planned departures.

**And it surfaced a result worth having.** With real lateness measured, the
controller *improves* schedule adherence rather than only costing it — buses
arriving within five minutes of their booked time rise from 60% to 77% on the
urban corridor and 17% to 24% on the inter-city one. Mean lateness does go up
(the holds are real), but the **spread** falls by more, and punctuality is a
question about the spread.

### 12. An unachievable timetable silently switches the controller off

`mpc/safety.ts` refuses a hold that would push a bus past
`max_lateness_seconds`. If the published schedule is tighter than the corridor
can run, **every** bus is already late and therefore **every** hold is a breach —
with no rejection an operator would think to look at, because "the bus is late"
does not read as a reason the controller has stopped working.

Measured by tightening the booked running time 15% on the urban corridor: the
excess-wait improvement fell from 52.9% to **19.4%** and holding from 183 s per
bus to **31 s**. The control laws were unchanged; the timetable had turned them
off.

**The trial had been doing this to itself.** Its timetable was free-flow running
plus a nominal dwell, and the new check caught it immediately: buses ran 130 s
late against it on the urban corridor and **896 s** late on the inter-city one,
with no control at all. Real running time exceeds free-flow for reasons the
arithmetic cannot see — the no-overtake clamp, dwells that scale with a queue
rather than an average, a Gaussian draw floored at zero.

The timetable is now booked from the **uncontrolled arm's own mean arrival at
each stop**, which is how a scheduler builds one from observed running times.
The uncontrolled arm is then on time by construction — exactly the baseline
wanted, because every second of lateness on the controlled arm is a second the
*controller* added rather than one the schedule invented. Every report carries
the check, and the console warns when a corridor's schedule does not fit.

With that corrected, the lateness bound is monotonic and a **tight** bound is
right on both corridors — the opposite of what it measured while the schedule
was wrong.

### 13. `ks`, the schedule-correction gain, measured for the first time — and it does nothing

`route_policies.ks` is the dial between regulating headway and pursuing the
timetable (Xuan, Argote & Daganzo 2011). It is null on every corridor, and until
this trial booked a timetable it could not have been anything else: the term
needs a schedule deviation and every one of those was null.

Measured across eight paired seeds on the urban corridor at `ks = 0.35`: better
on total passenger time on **4 of 8** seeds and on excess wait on **5 of 8**,
with means identical to three significant figures. No effect.

Testing *why* is more useful than the null result. `ks` only has something to
correct when the schedule is systematically wrong, and then it makes things
worse in both directions:

| schedule | `ks` off | `ks` = 0.35 | seeds `ks` won |
|---|---|---|---|
| tight (buses late) | +5.5% net | +2.5% net | 1 of 5 |
| matched | +10.4% | +11.3% | 3 of 5 |
| slack (buses early) | +6.1% | +1.0% | 0 of 5 |

Against a slack schedule it adds holds to buses that are already early and the
onboard cost swamps the gain; against a tight one it subtracts from every hold
and joins the lateness bound in switching the controller off. It stays null.

### 14. Policy knobs are per-corridor, and fitting one on one shape is a bug

`max_lateness_seconds` at 300 s improved the inter-city corridor. The same
guardrail at 120 s on the urban corridor was, at one point in this work, going to
be relaxed on the strength of a measurement that turned out to be the queue bug
above. Holding points run the other way round entirely: fewer is better
inter-city, more is better urban.

So the trial no longer bakes in a winner. It sweeps each knob **on the corridor
being run**, three seeds per row, and reports whether the seeds agreed — and the
console shows the sweep. The recommendation sorts on **total passenger time**
first and excess wait only as a tie-break, because ranking on wait alone had
already handed a recommendation to a setting with a worse net effect when two
rows tied.

### 15. Alighting-only: the right idea, and it loses anyway

"Let a bus at a stop drop passengers but pick nobody up when the follower is
close behind" is `mpc/boardingLimit.ts` — the only lever here that improves
spacing by *removing* delay rather than adding it. The trial reported it at
**0 of 4,960 decisions** for months. That turned out to be two harness bugs, not
a property of the law:

1. The adapter built only the headway row where the deciding bus is the
   **follower**, so the law — which acts on the **leader** — was always asked
   about a bus mid-link, and failed its "is the leader at a stop?" check every
   time. The row it needed was being computed and discarded.
2. Every candidate that survived was then rejected `stale_state`, because the
   safety filter ages every vehicle a candidate *involves* and the **trailer**
   had no observation timestamp.

Fixed, the law fires — and measured, it **loses**. Across eight seeds on the
urban corridor it made total passenger time worse on seven; in `slow_bus` it
cost 9% of all passenger time on **every** seed.

The mechanism, measured directly: 415 passengers passed cost **103 extra hours
of waiting — about 15 minutes each**, against the ~90 seconds the law reports as
`leftBehindWaitSeconds`. The follower arrives carrying its own load, cannot fit a
double queue, 150 more people are denied a seat outright, and the overflow rolls
forward. On a corridor with no overtaking the follower is also stuck behind
whatever delayed the leader in the first place.

So `leftBehindWaitSeconds` is a **lower bound and a loose one** — it must never
be shown as the cost of the action. And the deployed decision to propose this
and never auto-select it is correct: the law needs a fitted dwell model to know
its benefit and an occupancy feed on the follower to know its cost, and
`mpc/boardingLimit.ts` says so itself. The trial now puts numbers on both.

**This finding survived only because a bug in the trial was caught.** The first
measurement said alighting-only improved things on 7 of 8 seeds — because the
engine swept the stop's waiting queue at *departure* regardless, so the
passengers left behind vanished and the action measured as free. Both halves of
its trade had disappeared.

## What the trial still does not test

- **The command lifecycle.** Cooldown, minimum action interval, maximum
  concurrent actions, acknowledgement and expiry all live in the command path.
  A result here is the control law's **intent**, not the rate at which
  instructions would reach a driver.
- **The state estimator.** Production map-matches and filters a GPS fix and
  excludes low-confidence vehicles before any headway is computed. The simulator
  knows its own world exactly.
- **Real demand.** Every passenger was invented.
- **A real timetable.** The trial books its own (see finding 5), so lateness is
  measured — but against an invented schedule, not a published one.

## The corridor, and why it is shaped this way

400 km, ten stations 44 km apart, every station a holding point including the
origin. `H* = 1800 s` — the seeded network's own median target headway, and the
only defensible choice here: measured at 900 s, per-leg noise reached half a
headway, buses were effectively randomly placed after three legs and **both** arms
came apart. A corridor no controller can regulate reports "barely any effect"
about a working controller, for a reason belonging to the fixture.

Dwell is 120 s, an inter-city station stop rather than an urban one. It matters
more than it looks: dwell is the feedback path that turns a late bus into a
bunched pair, and an urban dwell here would leave almost nothing but travel-time
noise to measure.

Demand is kept below saturation on purpose. Past the point where a fifth of
offered passengers are refused a seat, waiting time is bounded by how many seats
exist rather than by how they are spaced — `SpacingKpis.saturated` flags any arm
that crossed it anyway.

## The ten scenarios

| id | what goes wrong |
|---|---|
| `steady_variability` | nothing; running times simply vary |
| `terminal_jitter` | departures leave the origin unevenly |
| `station_surge` | a crowd builds at one mid-route station |
| `slow_bus` | one vehicle runs below fleet pace |
| `traffic_shock` | a stretch of route runs slow for a window, for everyone |
| `missed_trip` | scheduled departures do not run |
| `cascade` | a slow bus into a crowded station on an unreliable day |
| `peak_load` | demand near seat capacity |
| `gps_dropout` | buses stop reporting position |
| `driver_non_compliance` | fleet-wide 45% compliance |

`traffic_shock` and `cascade` are the ones a holding controller handles worst, and
they are in the library for that reason: every bus inside the window is delayed
and none outside it is, so there is no single culprit to hold behind and the
honest answer may be that holding helps little.
