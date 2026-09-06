# The fleet trial

A thousand simulated buses on a 400 km corridor with ten holding points, run
twice — once through the deployed control laws, once with nobody intervening —
across nineteen ways a corridor comes apart, in two phases that differ in exactly
one input.

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

The trial measures every second off the simulated day rather than estimating it,
and counts each one exactly once:

- **waiting** — kerb time before the bus arrives, plus (for somebody who walks on
  while it is standing there) the time from walking on until it leaves. Boarding
  is oldest-first, so a bus that takes the fraction `f` of a window `W` takes
  people whose mean wait is `W(1 − f/2)`, not `W/2`.
- **dwell** — the ordinary door cycle, at the load aboard when the doors opened
- **hold** — the same population through a hold. Zero on the uncontrolled arm by
  construction, which is why it is reported separately: it is the price of control.
- **riding** — between stops, at the load the bus pulled away with

Their sum is the same quantity `mpc/objective.ts` claims to minimise
(`netPassengerSeconds`), computed from the outcome instead of predicted from one
decision — so a gap between them is a statement about the objective. The first
run of this trial cut excess wait 46% and made total passenger time 12% **worse**.

### The metric used to be waiting plus the hold, and that was the wrong half

For most of this trial's life "total passenger time" meant waiting time plus the
seconds a hold added, and nothing else. Riding and dwelling were outside it
entirely — so a controller that made every bus slower between stops would have
scored unchanged, and the only in-vehicle term in the metric was the one control
makes worse.

Both of the excluded terms move with the controller, and they move in its favour.
Passenger-weighted dwell is worst in a bunch, where one full bus does a long door
cycle beside one nearly empty bus doing a short one, and it falls when spacing
evens out. **Measured, urban, six seeds: holding cost 211–215 h while dwell gave
back 90–100 h.**

The percentage was wrong for the same reason. Its denominator was the
uncontrolled arm's total, which — that arm having no holds — was waiting time
alone. **A saving worth 3% of what passengers actually spend was reported as 12%,
and the same four- to sevenfold inflation applied to every negative result too.**
Every figure in this document from before that fix is on the old basis; the table
below is not.

## Where it stands, with error bars

Six seeds, 250 buses per phase, the original ten scenarios, `pnpm sim:fleet --corridor X
--vehicles 250 --seed S`. Net is total passenger time saved as a share of what
passengers actually spend — waiting plus every second aboard.

| corridor / phase | net passenger time | excess wait | seeds positive |
|---|---|---|---|
| urban, occupancy blind | **+2.9% ± 0.3** | +46% | 6/6 |
| urban, occupancy aware | **+2.2% ± 0.7** | +43% | 6/6 |
| suburban, occupancy blind | **+0.5% ± 0.3** | +39% | 6/6 |
| suburban, occupancy aware | +0.3% ± 0.3 | +36% | 4/6 |
| inter-city, occupancy blind | +0.1% ± 0.5 | +19% | 3/6 |
| inter-city, occupancy aware | −0.2% ± 0.4 | +15% | 2/6 |

Read the ± before the mean. **Urban is a win on every seed and the number is
resolved** — six seeds spanning +2.5% to +3.3%. Suburban blind is a much smaller
win on every seed. **Inter-city is not "probably nothing", it is nothing**, to
within ±0.5.

Those bars are this tight only because every draw takes its own keyed stream. The
same table before that read ±1.5 to ±2.0, urban was "+3.0% ± 2.0", suburban was
"+1.3%", and inter-city could not be told apart from a half-percent effect. A
single `sim:fleet` run is one draw and still needs this table beside it.

Where the time goes, urban, occupancy blind, per seed on average:

| | |
|---|---|
| waiting removed | +610 h |
| dwell given back | +100 h |
| riding | −33 h |
| holding | −215 h |
| **net** | **+462 h** |

The hold bill is not the whole in-vehicle story and never was: dwell gives back
about half of it. On inter-city the same table reads +67 h of dwell against
−689 h of holding, which is why that corridor cannot make the trade pay.

## Two things the per-scenario numbers say that the corridor totals hide

**`slow_bus` is the worst scenario on all three corridors, and it is the one the
theory says a hold is unambiguously right for.** Net passenger time: urban −0.2%
(5 of 12 phase-seeds positive), suburban −0.2% (6/12), inter-city −1.8% (4/12) —
against excess-wait improvements of 16–32%. The controller is not doing the wrong
thing: measured over three seeds, holds on the slow bus itself land almost
entirely at the TERMINAL, before it becomes slow, and **0 of 32 urban holds and 1
of 22 inter-city ones fall inside its slow zone**. It holds the followers, which
is right, and the trade still does not pay.

The mechanism is that holding cannot fix a leader. The slow bus stays slow, keeps
collecting a growing queue, and fills up; its followers are held, so they are late
too, and the pair arrives together anyway with more people aboard. Urban is the
scenario's one positive: **per passenger it reads +1.0% even where the absolute
total reads −0.2%**, because control carries more people. A corridor with a
persistently slow vehicle needs something holding cannot supply — an overtake, a
short-turn, or a replacement.

**Inter-city runs close to its seats on half its scenarios — and that is NOT why
it measures zero.** Uncontrolled denial share, as a headcount of people refused:
`peak_load` 17.5%, `station_surge` 16.8%, `cascade` 15.9%, `traffic_shock` 14.3%,
with individual seeds at 26.2%, 21.6% and 21.1% — over the 20% saturation bar.
That looks like the textbook explanation, because waiting time bounded by seats
rather than by spacing is the one regime where a working controller correctly
reports "no effect".

**It was tested and it is not the answer.** Re-running the whole trial with the
corridor's boarding rate scaled down — the only field overridden, four seeds at
120 buses per phase each:

| boarding rate | denial share | net passenger time | per passenger | excess wait |
|---|---|---|---|---|
| ×1.00 | 11.1% | +0.5% (2/4 seeds) | +1.7% | +22.9% |
| ×0.80 | 5.2% | −0.4% (2/4) | +0.7% | +20.4% |
| ×0.65 | 2.4% | −0.7% (1/4) | +0.2% | +19.4% |
| ×0.50 | 1.6% | −0.9% (1/4) | +0.9% | +21.7% |

Taking the corridor out of saturation makes the controller marginally WORSE, not
better, and the excess-wait gain does not move at all. That is the expected
result once stated properly: steady-state occupancy is `rate × H*/60 ÷
alightingFraction` and the people waiting at a stop per headway are `rate ×
H*/60`, so **both sides of the trade scale with the demand and the ratio that
decides it is invariant.** Demand is not the lever on this corridor.

What is left is the corridor's own shape: σ_leg/H\* = 0.19 puts inter-city above
the controllable band, where more deviation accumulates between two stops than a
hold at either can remove. Read `controllability` before crediting or blaming the
laws — it was right, and the saturation reading was a plausible second
explanation that does not survive being run.

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
Over 20,423 urban holds, term by term — which is the only way to see what is
actually wrong:

| urban | actual | objective, proxy `lambda = 1/H*` | objective, true `lambda` |
|---|---|---|---|
| waiting | **−10,799 h** | −147 h | −1,081 h |
| onboard, from the hold | +6,775 h | +7,914 h | +7,914 h |
| dwell | −2,362 h | *not modelled* | *not modelled* |
| riding | −81 h | *not modelled* | *not modelled* |
| **net** | **−6,466 h — a SAVING** | **+7,768 h — a COST** | **+6,833 h — a COST** |

Three things follow, and they are not what an earlier version of this section
said:

1. **The cost side is nearly right.** The objective says a hold costs the people
   aboard 7,914 h where the truth is 6,775 h — 17% over. That half of the
   arithmetic works.
2. **The benefit side is wrong by a factor of ten to seventy**, and it is
   therefore the SIGN that fails. On the corridor where the controller actually
   works, the objective says control costs passengers time while it saves them
   6,466 h. Inter-city keeps its sign only because the cost is genuinely larger
   there, and still overstates 4.8× / 3.6×.
3. **Calibrating lambda is not the fix.** It moves the wait term from 1.4% of
   the truth to 10% — a real sevenfold improvement, and nowhere near enough. The
   remaining tenfold is the HORIZON: `lambda x d x (d + h_fwd − h_bwd)` is a
   *one-stop marginal* estimate of a benefit that accrues over the whole
   downstream route and to every following bus, and this corridor has
   twenty-five stops. It also models dwell and riding not at all, and those are
   another 2,443 h of benefit it cannot see.

This is why `cost_optimal_hold` must not be let loose on the strength of a
calibration alone, and the argument is much stronger than it used to be: it is
the argmin of a function that can see about a tenth of the benefit, so it will
always choose a hold near zero.

### And the error has a shape, which is the fix stated as a measurement

The wait term's shortfall, all three corridors, against a correctly fitted
lambda:

| corridor | stations | actual | objective | ratio | mean stops downstream of a hold | ratio ÷ that | sigma_leg/H\* |
|---|---|---|---|---|---|---|---|
| urban | 25 | −10,799 h | −1,081 h | **10.0×** | ~12.5 | 0.80 | 0.10 |
| suburban | 15 | −6,405 h | −1,196 h | **5.4×** | ~7.5 | 0.72 | 0.10 |
| inter-city | 10 | −15,333 h | −6,083 h | **2.5×** | ~5 | 0.50 | 0.19 |

The ratio tracks how many stops are left downstream of the hold, discounted by
how well a correction survives between them — and that discount falls exactly
where `controllability` says corrections wash out. That is the multi-stop wait
term stated as a measurement rather than as a hypothesis: the benefit of evening
a gap accrues at every stop the correction survives to, and it survives fewer of
them on a corridor where more deviation accumulates between two stations than a
hold at either can remove.

Three points, one seed-set each, so it is a shape and not a formula. But a
multi-stop term of that form is the thing to build, and these are the numbers to
check it against.

The cost side, by contrast, is consistently good: 7,914 h predicted against
6,775 h actual on urban, 7,571 against 6,763 on suburban, 21,727 against 19,180
on inter-city — 12–17% over, every time.

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

Headline, three seeds each at 250 buses per phase, occupancy-blind phase:

| | 400 km inter-city | 60 km suburban | 24 km urban |
|---|---|---|---|
| headway | 30 min | 12 min | 6 min |
| stops | 10, 44 km apart | 15, 4.3 km apart | 25, 1 km apart |
| σ_leg / H\* (see below) | 0.19 — **too disturbed** | 0.10 — controllable | 0.10 — controllable |
| **excess wait** | 317 → 263 s | 105 → 71 s | 110 → **55 s** |
| **total passenger time** | −1.4% | +1.6% | **+11.1%** |
| arriving on time | 16% → **26%** | 52% → **63%** | 63% → **81%** |
| refused a seat | −25% | −29% | −21% |
| hold per bus | 7.5 min | 3.2 min | 3.4 min |

Two things worth reading twice. **On-time performance improves on every corridor**
— the controller adds hold time and still leaves more buses inside a five-minute
window, because it removes far more spread than it adds delay. And **weighing
occupancy turns the inter-city corridor from net-negative to net-positive**
(−1.4% → +3.2%): the taper matters most exactly where holding is most expensive.

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

### 15. Measuring mid-route headway at the release instant — tried, rejected

`ControllerContext.readyToDepartSeconds` exists because terminal dispatch
regulating on `now` compounded: each hold paid for a gap its own dwell was
already going to close. The mid-route laws were never given the same treatment,
and the argument for doing so looks strong — while a bus dwells its leader pulls
away, so the forward gap is already closing without it, and the bus behind closes
up, so the backward gap it is being held to protect is already shrinking. Both
errors push the same way.

Implemented (estimating both gaps from the neighbours' current pace over the
dwell, as production could) and measured across six paired seeds:

| | excess wait | total passenger time | hold/bus | seeds it won |
|---|---|---|---|---|
| urban, at arrival | 52.4% | +10.1% | 184 s | — |
| urban, at release | **43.6%** | +9.3% | 162 s | 1 of 6 on wait |
| inter-city, at arrival | 13.2% | −0.2% | 365 s | — |
| inter-city, at release | 14.8% | −0.4% | 312 s | 3 of 6 |

It holds less and loses more spacing than it saves. **Reverted.** The analogy to
Algorithm A does not carry: that was a *category error* — `h_fwd` is a closing
time and a bus standing at the origin is not closing on anything — whereas a
mid-route bus's arrival-instant headway is a valid measurement, and adjusting it
for the dwell simply under-holds.

### 16. Knobs that were already right

Not every sweep finds something. Recorded because a knob nobody has checked is
indistinguishable from one that has been:

- **`warning_threshold_ratio` (0.50)** — which sets how deviant a pair must be
  before a mid-route law will act. Swept over 0.30–1.00: 0.50 is the best value
  on the urban corridor on total passenger time (every alternative worse, 0.30
  losing on 0 of 6 seeds), and on the inter-city corridor every value is inside
  the noise. Left alone.
- **`Kb` (0.2)** — see "one seed is not a measurement".
- **`ks` (null)** — see above.
- **`max_lateness_seconds`** — the sweep now *does* find something, but only
  after the timetable was fixed; a tight bound is right on both corridors.

### 17. Alighting-only: the right idea, retracted twice, and now measured to help

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

Fixed, the law fires — and this section's verdict has moved twice since, on
three progressively larger measurements. **Each is reported below with its own
seed count, because that count is exactly what changed between them.**

**First measurement (eight seeds, urban, old headline): it loses.** Total
passenger time came out worse on seven of eight seeds; in `slow_bus` it cost 9%
of all passenger time on every seed. This is also the measurement behind the
mechanism below: 415 passengers passed cost **103 extra hours of waiting — about
15 minutes each** — against the ~90 seconds the law reports as
`leftBehindWaitSeconds`. The follower arrives carrying its own load, cannot fit
a double queue, 150 more people are denied a seat outright, and the overflow
rolls forward. On a corridor with no overtaking the follower is also stuck
behind whatever delayed the leader in the first place. So
`leftBehindWaitSeconds` is a **lower bound and a loose one** — it must never be
shown as the cost of the action, and this mechanism is real regardless of which
way the seed-count verdicts below land.

**This first "it loses" verdict survived only because an earlier trial bug was
caught first.** Before it, the trial had reported alighting-only winning on 7 of
8 seeds — because the engine swept a stop's waiting queue at *departure*
regardless, so the passengers left behind vanished and the action measured as
free. Fixing that queue bug is what turned the 7/8 win into the 7/8 loss above;
both halves of the action's trade had been invisible until then.

**Second measurement (six seeds, 250 buses/phase, urban, occupancy-blind, on
the metric now used throughout this document): no measured effect.** The first
loss was itself taken on the *old headline* — waiting plus the hold, over a
waiting-only denominator, with passengers still boarding at the terminus — and
does not survive that being fixed. Re-measured on the corrected metric, acting
on it was better on only 3 of 6 seeds by total passenger time (mean +0.25
points) and 5 of 6 per passenger carried (mean +0.29); in `slow_bus`
specifically, better on 4 of 6, mean +1.49. By this trial's own rule — a mean
whose seeds disagree is not a small effect — that was **no measured effect**,
not a win. "It loses" stopped being something anyone could say, but nor yet
could "it wins".

**Third measurement (sixteen paired phase-seeds, same corridor and phase, on
the same corrected metric): it helps.** Acting on it is better on **14 of 16
seeds by total passenger time** and **16 of 16 by excess wait**. Both clear the
trial's own seed-agreement bar (`seedsAgreeingWithSign > seedCount / 2`), so
unlike the six-seed measurement this one IS a measured effect, and it is
positive.

**None of this changes the deployed decision, but it changes the reason for
it.** The law is proposed and never auto-selected, and that stays correct: it
needs a fitted dwell model to know its benefit and an occupancy feed on the
follower to know its cost (`mpc/boardingLimit.ts` says so itself), and the
mechanism above is a real, unpriced cost this trial's positive mean does not
retire. What changes is that the reason is no longer "it loses" — by the most
recent and largest measurement, it does not. See `HANDOFF.md` §6 for the same
history in the dead-ends table and `fleetTrial/run.ts`'s
`FleetTrialSpec.alightingOnlySelectable` doc comment for the switch itself.

## What happens to the incidents

Detected by the deployed rules — both tiers, replayed at the live 60-second sweep
cadence — over a full 1,000-bus trial:

| | inter-city | urban |
|---|---|---|
| incidents left alone | 2,485 | 4,726 |
| …of which resolved | 51% | **8%** |
| incidents under control | 2,666 | **2,726** |
| …of which resolved | **68%** | **40%** |
| had a hold served while open | 703 | 1,099 |
| opened as a forecast and became real | 466 | 197 |

Urban is the clearest case: control stops **2,000 incidents opening at all** and
raises the resolution rate five-fold. Inter-city detects slightly *more* under
control — holding changes the gaps the forecaster is watching, so it opens more
`predicted` incidents — while resolving 68% against 51% and cutting the number
that merely ended because a bus left the route.

A higher detected count is therefore not a failure, and the console says so
where it shows the number.

## Is the engine itself right?

Every comparison in this document is between two simulated arms, which cannot
catch an error both arms share. So there is also a **known-answer test**: strip
out both sources of randomness — link travel time and how many people are
waiting — and the corridor is deterministic, its steady state writable in
advance.

- With demand and travel variance both zero, headways are **exactly** the target
  on both corridors: CV 0.000000, EWT 0.0000 s, largest deviation 0.0000 s.
- Switch demand back on and the steady-state load matches
  `rate × H* / 60 ÷ alightingFraction` within 15% at the last stop before the
  terminus, the rest being geometric convergence from an empty bus.
- Travel time still fixed, headway CV rises 0 → 0.07 → 0.37 as demand goes
  0 → 0.3 → 1.2 per minute. That is the dwell feedback and nothing else: a late
  bus finds more passengers, takes longer to load them, and falls further behind.
  It is the instability the whole system exists to fix, and a test asserts it
  grows with demand — if it ever stops, the engine has lost the mechanism.

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
- **Corridor dispersion.** `travelTimeVariation` is invented like every other
  running-time input, and it is the one the headline is most sensitive to.
  Holding demand fixed and sweeping it alone (urban preset): excess-wait
  improvement measures **60.7%** at the shipped value (0.18), **43.7%** at
  roughly double it, and **14.1%** at roughly 3.3x it. Across the same 3.3x
  swing applied to the invented boarding rate instead, the headline stays
  within **60.7–64.5%** — roughly an order of magnitude less sensitive. **The
  bunching result IS robust to demand** — that swing barely moves it, and it is
  a genuinely reassuring finding — **it is not robust to dispersion.** The real
  network's measured median headway CV is **1.78** (an upper bound, contaminated
  by parked buses that map-match onto a route), while this trial reaches only
  **0.87** at its noisiest tested setting — the direction that costs the
  headline. This sensitivity is re-runnable, not just stated: see the
  `travel_time_variation` row in `policyStudies`, printed by `sim:fleet`
  alongside every other policy sweep.

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

## The scenarios

Ten of them describe ways a CORRIDOR comes apart. Nine more, added afterwards,
describe ways the CONTROLLER comes apart — each attacks a named assumption in
the control laws rather than adding another kind of bad day. They exist because
the first ten were being passed: measured, the laws improved net passenger time
on 9 of 10 urban scenarios, 8 of 10 suburban and 7 of 10 inter-city, and a
library a controller mostly passes is not measuring its limits.

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

And the adversarial set:

| id | what it attacks |
|---|---|
| `phantom_position` | the feed is fresh, consistent and WRONG, drifting a headway's distance per trip |
| `frozen_feed` | a modem republishing its last fix with a current timestamp — old data that nothing can tell is old |
| `blind_slowdown` | a congestion window AND a map-match error on the buses inside it |
| `hotspot_demand` | five stops carry the route, against an objective whose arrival rate is uniform by construction |
| `partial_compliance` | four tiers of driver, some of whom take an instruction and serve a quarter of it |
| `oversaturated` | the far side of the denied-boarding line, where a working controller must report no effect |
| `oscillating_shock` | a stretch alternating slow and fast once a headway, against proportional laws with a transport lag |
| `building_peak` | a corridor with no steady state, so no booked timetable fits any bus |
| `shock_and_recovery` | one severe shock, then a long clean stretch: does the corridor come back, and does holding delay that |

`traffic_shock` and `cascade` are the ones a holding controller handles worst
among the original ten, and they are in the library for that reason: every bus
inside the window is delayed and none outside it is, so there is no single
culprit to hold behind and the honest answer may be that holding helps little.

### What the adversarial set found

Six seeds at 2,000 buses per phase, occupancy-blind. Read the excess-wait
column against `steady_variability`'s own gain on the same corridor (urban 53%,
suburban 43%, inter-city 22%) — that is the controller working normally.

| scenario | corridor | uncontrolled EWT | net passenger time | excess wait |
|---|---|---|---|---|
| `oversaturated` | all three | 41–236 s | **−2.7% / −0.9% / −0.6%, 0/6 seeds positive** | 49–54% |
| `oscillating_shock` | inter-city | 489 s, 27.6% bunched | +1.1% | **6.4%** on 502 s/bus of holding |
| `partial_compliance` | inter-city | 247 s | +0.3% | **12.4%** on 180 s/bus |
| `building_peak` | inter-city | **781 s** | +1.3% | **12.7%** |
| `blind_slowdown` | inter-city | 371 s | +0.2%, 3/6 | **13.2%** |

`oversaturated` is the only scenario the controller loses outright, and it is
supposed to: it is the harness's own saturation reporting under test, and the
flag fires on 6/6 seeds on every preset. The other four are the finding — the
controller stays positive but its gain collapses by two to three times while it
issues as many hold seconds as ever, which is a controller working hard and
buying little rather than one that has stopped.

### The headline may not average a scenario built to lose

`oversaturated` exists to prove the harness reports NO effect past the
denied-boarding line. Pooled into the single top-line "net passenger time"
figure with the eighteen readable scenarios it does not report an effect — it
dilutes one, with a measurement that was never able to carry a signal.

Measured, same code, same run, urban at the default 500 buses/phase:

| scenario set | net passenger time | first-time denied share |
|---|---|---|
| all 19 | **+0.95%** | 12.2% |
| the 18 that are not saturated | **+2.46%** | 3.9% |

Anyone comparing +0.95% with a figure from before `oversaturated` was added
would read a controller that had got three times worse overnight, when what had
changed was the test set. So every phase now carries two pools:

* `PhaseReport.controlled` / `.uncontrolled` / `.contrast` — **the headline**,
  pooled over `FleetTrialReport.headlineScope.includedScenarioIds`;
* `PhaseReport.allScenarios` — the same three over every scenario the phase ran,
  published beside the headline and never in place of it. It reproduces the
  previous figure exactly.

Three properties of the rule are the point of it, and undoing any of them
re-opens the defect:

1. **The exclusion is MEASURED, never an id list.** A scenario is out when
   either arm is past `SATURATION_DENIED_SHARE`. A list would go stale the first
   time a scenario was renamed, and would silently keep including the next one
   that crossed the line — on inter-city at 500 that is `station_surge` (21%)
   and `building_peak` (25%) as well as `oversaturated` (57%), and none of the
   three is named anywhere in the code.
2. **Either arm, not both.** The contrast is a difference of quantities
   saturation bounds, so one saturated side is enough to make it unreadable.
3. **Decided once for the trial, across every phase.** Saturation is measured
   per arm, so two phases could exclude different scenarios — and a comparison
   between two figures averaged over two different scenario sets is not a
   comparison.

`scenarioAgreement` deliberately still counts EVERY scenario, excluded ones
included: it is the surface on which a scenario designed to lose should be
visible, and it is where `oversaturated` shows up as the worst row.

When every scenario saturates there is nothing readable to pool, so the headline
falls back to the full set and `headlineScope.fellBackToAllScenarios` says so.
Reporting the empty pool instead would render as an em dash, which reads as "the
trial found nothing" rather than "every scenario was past the line".

### The saturation flag and the denied share are one expression

`SpacingKpis` published `deniedBoardings` (refusal EVENTS — a passenger three
full buses turn away is three of these) and `totalBoardings` (a HEADCOUNT, each
person once) and a `saturated` flag, and said nothing about which arithmetic the
flag was drawn on. A reader building a share from the two numbers in front of
them got `deniedBoardings / totalBoardings`, which divides a rate by a headcount:
measured on urban at 500 it read **52%** beside a flag reading **false**. Both
numbers were honest and they were about different things.

`SpacingKpis.deniedShare` now carries
`firstTimeDeniedBoardings / (firstTimeDeniedBoardings + totalBoardings)`, and
`saturated` is `deniedShare > SATURATION_DENIED_SHARE` and nothing else. They
cannot disagree, because they are the same expression. Null — not zero — when
nobody was offered a seat at all.

### The console says whose report it is showing

`GET /v1/fleet-trial/latest` serves the last report the control-service PROCESS
produced, from one module-level variable, to every caller. A trial anyone runs
through the API becomes what the next person opening the console sees, and a
restart loses it entirely. The page rendered that on load with no statement of
when it ran, on what corridor, or at what fleet size — which is how a 60-bus
diagnostic run reporting −7.9% was read off a page whose own controls said
1,000 buses.

The fix is provenance, not per-user state in the control service. Deliberately:
the trial is a pure computation over a spec that travels inside its own result,
it writes nothing and reads no database, and the report is not private data —
there is no user at that layer to attach it to. Sessions there would add state
to a deliberately stateless endpoint and still leave the defect, because a stale
report of your own misleads exactly as much as a fresh one of somebody else's.

So the console states what the report IS: when it ran, on which corridor, at
what fleet size, whether it is the reader's own run or whatever ran last, and
whether it is old enough that the deployed laws it measured may have moved. The
page's own controls are seeded from the report rather than from a fixed default,
and offer the size it actually ran even when that is not one of the presets —
a control reading 1,000 above a 60-bus report is the mismatch itself.

Two cautions a reader needs before acting on any per-scenario row.

**The default trial has no statistical power per scenario.** `vehiclesPerPhase`
is split ACROSS scenarios, so a nineteen-scenario trial at the default 500 gives
each scenario 26 buses per arm. Measured, the per-scenario sign flips freely at
that budget: at 500 buses `phantom_position` read −0.5% on suburban over 6 seeds
and at 2,000 buses it read +0.7%, and the same reversal happened to `slow_bus`,
`frozen_feed` and `blind_slowdown`. The phase-level `scenarioAgreement` count is
a screening number; run `--vehicles 2000` before calling any single scenario a
failure. Runtime is unaffected by scenario count (the buses are shared out, not
added), so this costs vehicles rather than scenarios.

**An estimator attack cannot raise the uncontrolled arm's bunching**, because
the uncontrolled arm does not read the estimator. `phantom_position`,
`frozen_feed` and the GPS half of `blind_slowdown` are the exceptions to the
rule that a hard scenario must be a hard corridor: their hardness shows up as
the controlled arm's gain collapsing, never as a worse baseline.
