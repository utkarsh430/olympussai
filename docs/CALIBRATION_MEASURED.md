# Calibrating the two invented inputs, against the first day of real stop visits

`CALIBRATION_CONTAMINATION_FILTER_ENABLED` (default **off**) ·
`control-service/src/calibration/{contamination,dispersion,flags}.ts` ·
`control-service/src/evaluation/calibrate.ts`

Every number this system reports rests on two inputs nobody measured: the
passenger arrival rate `lambda`, which `mpc/objective.ts` proxies as `1/H*`,
and corridor dispersion `travelTimeVariation`, which the presets state as
0.14–0.18. `stop_visits` began filling on 2026-09-06, so both became
measurable for the first time. This is what they measure.

Everything below is labelled **MEASURED** (read from the control database) or
**INFERRED** (a measurement plus an assumption, or an interpolation between
published measurements). Nothing here changes a control law, and the filter
that produces the clean figures ships off.

**The short version.** No corridor is calibrated, so lambda is not replaced.
Dispersion is measured at **0.21**, against a shipped 0.18 — optimistic, and
by a few points of headline rather than an order of magnitude. And the 1.78
headway CV is neither an artefact nor this quantity.

---

## 0. The data these numbers come from

**MEASURED**, in one repeatable-read snapshot of the control database taken at
2026-09-06 20:02 UTC. Every figure in this document comes from that snapshot
or from a pure function run over it.

| | |
|---|---|
| `stop_visits` | 14,048 rows · 1,318 stops · 4,595 vehicles · 573 route-directions |
| departure window | 2026-09-06 09:18:46Z → 20:02:00Z — **10.7 hours of one calendar day** |
| `headway_states` | 183,477 rows across 158 route-directions |
| corridors with visits **and** a measured target headway | **158** |
| `stop_visits.source` | `gps_geofence` on 100% of rows; zero `avl_stop_event` |

Two things to settle before any figure is read.

**One day is not a measurement, by this repo's own convention.** AGENTS.md
requires a seed spread rather than a single run for every simulated result;
the equivalent here is a day spread, and there is exactly one day, covering
14:48–01:32 IST. Nothing below separates "this network" from "this afternoon
and evening".

**The `gps_approach` split AGENTS.md asks for does not exist.** That note
directs a future session to split `stop_visits.source` on `gps_approach` vs
`gps_geofence` before `fitDwellModel` has its samples, and to fit dwell on the
geofence half. The column's check constraint admits only `gps_geofence` and
`avl_stop_event`, the string `gps_approach` appears nowhere in the repository,
and every recorded row is `gps_geofence`. There is nothing to split — the
estimator already writes only the half that note wanted kept. The
approach-window contamination it anticipated is absent; a different
contamination is present, and section 2 is about that one.

---

## 1. Running the calibration for real

`calibrateCorridor` fits `dwell = beta_0 + beta_h x h_preceding` per stop and
derives `lambda = beta_h / beta_b`. Run against all 158 corridors:

### MEASURED: no corridor is calibrated. Not one.

| | filter off (as shipped) | filter on |
|---|---|---|
| corridors reaching `isCalibrated` | **0 / 158** | **0 / 158** |
| highest stop share any corridor reached | **20%** (bar is 50%) | 20% |
| corridors with ≥ 1 fitted stop | 34 | 19 |
| stops fitted, network-wide | 57 | 22 |
| links fitted (`fitLinkTravelTimes`, min 8 traversals) | 3 | 3 |

**Why "285 stops already clear the bar" does not translate.**
`fitDwellModel` groups by **(route_direction_id, stop_id)**, not by stop. 285
is the count of stops with ≥ 13 visits pooled across every route-direction
that touches them; at the grouping the fitter actually uses there are **3,062**
(route-direction, stop) pairs, of which **185** reach 13 visits. And
`buildDwellObservations` drops the first visit at each group — it has no
predecessor to difference against — so 13 visits give 12 observations, which
is exactly `minSamples`, not comfortably past it. Those 185 then have to
survive two more filters: the stop must sit on a corridor with a measured
target headway, and `calibrateFromVisits` discards any stop whose fitted
`beta_h` is ≤ 0, because a negative slope would hand the simulator a negative
arrival rate. 57 survive.

`isCalibrated` needs half a corridor's stops. These corridors carry a median
of 21 stops, so half is 10 or 11 fitted stops on one route-direction. The best
any corridor achieves is **4**.

### MEASURED: the fits that do occur explain almost nothing

R² across the fitted stops:

| | n | p25 | median | max | R² < 0.1 |
|---|---|---|---|---|---|
| filter off | 57 | 0.012 | **0.049** | 0.786 | 37 (65%) |
| filter on | 22 | 0.012 | **0.057** | 0.569 | 12 (55%) |

The preceding headway explains about **5%** of the variance in dwell at the
median fitted stop. `beta_h` is not identified on this data; it is a slope
through a cloud.

### MEASURED: unfiltered, the fit returns corridors that cannot exist

`1 + beta_h` is the headway propagation eigenvalue. Above 1 a corridor
amplifies deviations; at 2.5 a corridor's headway multiplies by two and a half
at **every stop**, which no service that runs at all can do.

| | corridors | median `1 + beta_h` | max | above 1.5 |
|---|---|---|---|---|
| filter off | 34 | 1.067 | **2.503** | **3** |
| filter on | 19 | 1.004 | 1.020 | 0 |

### MEASURED: lambda against the `1/H*` proxy, per corridor

Ratio of each corridor's fitted median lambda to its proxy, over the corridors
where any stop fitted:

| | corridors | min | median | max |
|---|---|---|---|---|
| filter off | 34 | 1.3x | **39x** | 3,926x |
| filter on | 19 | 0.03x | **2.3x** | 47x |

The three worst unfiltered rows are the same three corridors whose
`1 + beta_h` exceeds 2.3.

### The reading

The proxy is certainly wrong — AGENTS.md measures it 7.2x–11.4x low against
the simulator's own demand, and nothing here contradicts that. **This data
does not replace it.** The unfiltered median of 39x rests on slopes that also
claim a corridor more than doubles its headway at every stop. The filtered
median of 2.3x rests on 19 corridors with one or two fitted stops each and a
median R² of 0.057. A thin fit reported as a fit is worse than no fit, and
both of these are thin fits.

**Per corridor the answer is the same on all 158: not yet.** What the run does
establish is that the pipeline works end to end on real data, and exactly what
it is short of — samples per (route-direction, stop), which accrue on their
own.

---

## 2. Measuring dispersion, and excluding the contamination

### What `travelTimeVariation` actually is

The coefficient of variation of **one leg's running time**. `rehearsal/run.ts`
uses it as `stddevSeconds = meanSeconds x travelTimeVariation`;
`evaluation/eligibility.ts#measuredAssumptionsFromFittedLinks` states the
estimator as the mean over fitted legs of `stddev/mean`.

It is **not** a headway CV. A headway CV is an outcome, with dispersion as one
of its causes alongside the timetable and the dispatch discipline. Section 3
measures the headway CV separately, and it answers a different question.

### The exclusion method

Three rules. Each is either a route fact or an arithmetic consequence of the
model being fitted. **None is a percentile of the data** — a cut placed at a
percentile removes a fixed share of whatever it is handed, and so can never
report that it found nothing.

| rule | what it is | why |
|---|---|---|
| **single leg** | the two stops must be adjacent in this corridor's own `route_direction_stops` order | `buildLinkObservations` pairs visits adjacent in a *vehicle's* timeline, which is not the same as stops adjacent on the *route*. One missed geofence and the traversal spans two legs — and `fitLinkTravelTimes` keys on `toStopId`, so the over-long time is filed against the last leg of the run rather than discarded. No threshold to choose. |
| **implied leg speed** | leg distance ÷ traversal time must fall in 5–100 km/h | A stationary vehicle whose fixes jitter between two geofences registers a traversal it never made. Needs `cumulativeDistanceMeters`; where a caller does not supply it the rule reports that it judged **nothing** rather than passing silently. |
| **boarding-dwell bound** | dwell ≤ `beta_0 + beta_b x capacity` = 120 + 2.5 × 52 = **250 s** | The longest dwell a *boarding process* could produce given the fleet. Above it the row is being explained by something the regressor cannot see. Applied to the dwell fit only. |

The third matters most and is worth naming plainly. It does not distinguish a
terminal layover from a parked bus from a bus stuck at a level crossing. It
excludes all three together, because the dwell model has nothing to say about
any of them — and **a layover is the dangerous case, not the noisy one**: its
length is set by the same timetable that sets the dispatch interval, so
regressing it on preceding headway returns a confident slope with no boarding
in it at all. That is the mechanism behind the 2.503 eigenvalue in section 1.

**MEASURED**, on the live data: across the 185 (route-direction, stop) groups
with ≥ 13 visits, median dwell at a route's first or last stop is **524 s**
against **105 s** mid-route. Visits over 30 minutes cluster at named bus
stations — BARABANKI 67% of its visits, VARANASI CANT 50%, SULTANPUR 49%,
KAUSHAMBI 48%, GORAKHPUR 45%.

### What the exclusions remove

**MEASURED**, over the 158 corridors:

| | kept | considered | removed |
|---|---|---|---|
| dwell observations | 2,910 | 4,268 | **1,358 (31.8%)** |
| link traversals | 422 | 822 | **400 (48.7%)** |
| — not a single leg of the corridor | | | 389 |
| — implied speed outside 5–100 km/h | | 433 judged | 11 |

Three honest notes on that table.

**The single-leg rule does nearly all the work, and it is not a parked-bus
rule.** It is a missed-geofence rule. Network-wide the cascade is 2,666
consecutive-visit pairs at different stops → 2,215 pass the shipped
`travel_s ∈ (0, 3600]` guard → **1,228 are route-adjacent**. So **987 of the
2,215 traversals the shipped fit uses (44.6%) are not one leg of the route
they are filed against.** That is a defect in the shipped fit independent of
any parked bus.

**The implied-speed rule judged nothing on 80 of the 158 corridors**, because
those callers supplied no leg distance. On those corridors a map-matched
stationary vehicle would not have been caught, and `ContaminationReport` says
so per corridor rather than reporting a clean pass. Where it did judge, the
artefact is unmistakable: the top of the observed implied-speed distribution
reaches 1,346 km/h.

**It removes little in count and it matters anyway.** Eleven traversals out of
433 judged — but those eleven are the ones with the shortest times and
therefore the largest leverage on a variance.

### The result

Pooled within-link CV, degrees-of-freedom weighted
(`sqrt( Σ (n−1)·cv² / Σ (n−1) )`), 95% CI from 4,000 bootstrap resamples of
links:

| scope | | links | d.o.f. | CV | 95% CI |
|---|---|---|---|---|---|
| 158 measured-policy corridors | unfiltered | 173 | 317 | 0.263 | [0.222, 0.326] |
| | **filtered** | 97 | 193 | **0.210** | **[0.176, 0.255]** |
| all 571 route-directions with visits | unfiltered | 439 | 771 | 0.265 | [0.239, 0.293] |
| | **filtered** | 254 | 493 | **0.221** | **[0.194, 0.247]** |

**The contamination was inflating dispersion by about 0.05, roughly a fifth of
it.** That is a real effect and it is smaller than the parked-bus framing
suggests, because `buildLinkObservations` already refuses same-stop pairs and
traversals over an hour — the links were partly protected before any of this.

### Why the estimator is pooled, and what pooling costs

`fitLinkTravelTimes` needs 8 traversals. **MEASURED: six links out of 695
reach it network-wide** (six of 1,444 unfiltered), which is why `linksFitted`
is 3 and why `measuredAssumptionsFromFittedLinks` returns null on essentially
every corridor. A mean CV over six links does not measure a network.

A minimum-sample cut also *selects*: links with more traversals have had more
chances to show their tail, so the answer rises with the cut for a reason that
is about the cut and not about the roads. **MEASURED**, filtered, population
estimator, network-wide:

| min samples | links | mean CV |
|---|---|---|
| ≥ 3 | 119 | 0.150 |
| ≥ 4 | 55 | 0.158 |
| ≥ 6 | 15 | 0.219 |
| ≥ 8 | 6 | 0.247 |

The pooled estimator uses every link with two traversals and does not select
on sample count. Its cost is an assumption — that the within-link CV is
roughly common across legs — and `DispersionMeasurement.perLink` is returned
so a reader can check it. **MEASURED: it does not hold tightly**, and section
below gives the spread.

### Per corridor: mostly, this is not measurable yet

**MEASURED**: of 158 corridors, **45** have any dispersion measurement at all
and **6** reach 10 degrees of freedom.

| corridor | links | d.o.f. | CV filtered | CV unfiltered |
|---|---|---|---|---|
| KAISERBAGH TO BAHRAICH VIA BARAB… | 8 | 20 | 0.244 | 0.458 |
| CHARBAGH TO PRATAPGARH BUS STATI… | 5 | 19 | 0.166 | 0.176 |
| BADAUN TO KAUSHAMBI BUS STATION… | 6 | 18 | 0.236 | 0.247 |
| GONDA TO KAISERBAGH | 5 | 15 | 0.190 | 0.204 |
| GORAKHPUR BUS STATION TO MAGAHAR… | 5 | 10 | 0.249 | 0.249 |
| KAUSHAMBI BUS STATION TO BADAUN… | 5 | 10 | 0.270 | 0.307 |

Those six span **0.166 to 0.270**. Across all 45 corridors with any
measurement at all, including the ones resting on a single link pair, the
range is **0.006 to 0.658**.

**The other 113 corridors do not have a dispersion measurement**, and the
pooled network figure must not be read as one for each of them. Setting a
per-corridor `travelTimeVariation` from this data is possible on six
corridors and on no others.

### One quantified lower bound

`buildLinkObservations` drops traversals over 3,600 s. **MEASURED**: that cap
removes 397 pairs, of which **23 are genuine single legs — 1.8% of the 1,228
route-adjacent traversals**. It truncates the right tail, so every CV above is
understated by whatever that 1.8% would have contributed. The direction is
known; the size is not, because the cap removes exactly the observations that
would size it.

---

## 3. The 1.78, and why it is not this number

**MEASURED: reproduced.** Median CV of `headway_states.h_fwd_seconds` across
the 132 route-directions with ≥ 10 samples is **1.793**.

**MEASURED: the parked-bus gaps are real, and they are not the cause.**
23,400 of 164,555 non-null `h_fwd` rows (**14.2%**) are ≤ 1 second — the
signature the brief describes, present exactly as described. Dropping every
one of them moves the median CV from 1.793 to **1.725**. The number is 1.78
because `h_fwd` is a gap/speed model whose distribution spans 0.03 s to 86,400
s against a median target headway of 1,324 s, not because of the sub-second
rows.

**MEASURED: decontamination makes the headway CV worse, not better.**
Departure-to-departure headway at stops, from `stop_visits` — the blueprint's
preferred measurement — over groups with ≥ 4 gaps:

| | groups | median CV |
|---|---|---|
| all visits | 941 | 1.283 |
| **service visits only** (dwell ≤ 250 s) | 626 | **1.577** |

That filter is on the *dwell*, so it is independent of the headway value and
cannot lower the CV by construction. Removing the parked and laying-over buses
removes closely-spaced departures, and the spacing reads *worse*.

**MEASURED: the irregularity is not generated on the road.**
Departure-to-departure CV by position along the route, service visits only:

| quarter along route | groups | median CV |
|---|---|---|
| first | 145 | 1.514 |
| second | 178 | 1.543 |
| third | 150 | 1.577 |
| fourth | 153 | 1.646 |

Buses are already ~1.51 CV irregular in the first quarter of the route, and
the whole remaining corridor adds 9%.

**The reading.** 1.78 is neither an artefact to be cleaned away nor a
candidate value for `travelTimeVariation`. It is a real and severe headway
irregularity, present close to dispatch and barely amplified along the route —
the shape of a dispatch problem, not a running-time problem. Substituting it
for `travelTimeVariation` would have put a road input an order of magnitude
above anything a road produces.

---

## 4. Is the shipped 0.18 realistic, optimistic or pessimistic?

### OPTIMISTIC — modestly, and nowhere near the pessimistic end of the sweep.

**MEASURED.** 0.210 [0.176, 0.255] on the 158 corridors control can run on;
0.221 [0.194, 0.247] across every route-direction with visits. 0.18 sits below
both point estimates: inside the first interval, and below the lower bound of
the second.

**MEASURED: which preset this network resembles.** Cruise speed over clean
single-leg traversals is **37.5 km/h**, with a mean leg of **7.4 km / 715 s**
(n = 1,188).

| preset | cruise | mean leg | ships `travelTimeVariation` |
|---|---|---|---|
| urban | 18 km/h | ~1 km | 0.18 |
| suburban | 32 km/h | ~4 km | 0.16 |
| inter-city | 60 km/h | ~44 km | 0.14 |
| **this network, measured** | **37.5 km/h** | **7.4 km** | **0.210–0.221** |

The real network sits closest to the **suburban** preset, which ships 0.16. So
against the preset it most resembles the shipped value is optimistic by about
30%, and against the urban preset the 60.7% headline was measured on, by about
17%. Both presets understate; **inter-city's 0.14 understates most.**

**INFERRED** — linear interpolation between the two nearest measured points of
the published sweep (0.18 → 60.7%, 0.36 → 43.7%, `docs/FLEET_TRIAL.md`). An
interpolation, not a measurement; re-run `sim:fleet`'s
`travel_time_variation` study at 0.21 to replace it with one.

| dispersion | excess-wait improvement |
|---|---|
| 0.18 shipped | 60.7% — measured |
| **0.210 measured** | **~58%** — inferred |
| 0.255 CI upper | ~54% — inferred |
| 0.36 | 43.7% — measured |
| 0.60 | 14.1% — measured |

**Nothing in this data supports the 14.1% figure.** It needs 0.60, which is
2.4x the top of the measured 95% interval and 2.9x the point estimate. The
headline is not robust to dispersion, but the dispersion this network actually
runs at costs a few points, not an order of magnitude.

### The larger caveat, which is not about this number

Correcting `travelTimeVariation` to ~0.21 removes a known error. It does not
make the trial a model of this network, and quoting it as though it did would
replace one overconfidence with another.

**The measured leg dispersion cannot produce the measured headway
irregularity.** A corridor with 0.21 leg CV and regular dispatch does not
arrive at a 1.51 headway CV in the first quarter of its route. Section 3 shows
this network does, and that the road adds 9% on top of it. The dominant
disturbance here is **dispatch**, and the fleet trial books its timetable from
the uncontrolled arm's own arrivals — a regular one. That input is not swept,
and this task did not measure it.

The honest summary for a headline figure: dispersion was the largest *named*
uncertainty, it is now measured, and it costs a few points. The largest
*unnamed* one is dispatch irregularity, and on this evidence it is bigger.

---

## 5. What is available, and what is switched off

`CALIBRATION_CONTAMINATION_FILTER_ENABLED` (default **false**). Off is
byte-identical: `calibrateFromVisits` builds the same observations, fits the
same models and returns the same numbers it returned before this document
existed. `test/evaluation/calibrate.test.ts` and
`test/calibrationContamination.test.ts` pin that.

The flag is read in `calibration/flags.ts` rather than declared in
`config/env.ts` — deliberately, and that file says why: `config/env.ts`
validates the whole service environment at import and throws without three
unrelated secrets, which would make a database URL a precondition of fitting a
straight line. Every function that reads the flag also takes an explicit
override, so nothing in the fitting path is reachable only through an
environment variable.

Available on every `CorridorCalibration` whether the flag is on or off:

- `lambdaPassengersPerSecond` — the fitted median, in the units
  `mpc/objective.ts#arrivalRatePaxPerSecond` returns, so a later task wiring
  it in is comparing like with like. **Published, not wired.**
- `dispersion` — the pooled leg-time CV, its per-link spread, and what the
  eligibility-style estimator would have said.
- `contamination` — the tallies, **populated even with the filter off**, so a
  report can say how much of a fit rests on observations no boarding process
  could have produced *without* changing the fit. `filterApplied` says which
  of those two things a given number is.

**It ships off because the exclusions are correct and the data is not yet
thick enough for them to pay.** No corridor reaches `isCalibrated` either way,
and filtering turns 57 thin fits into 22 thinner ones. Turn it on the day a
corridor clears that bar — not before, because today it would replace one
number nobody should quote with a cleaner number nobody should quote.

### What would change the answer

- **More days.** Every count here is 10.7 hours. `fitDwellModel`'s 12 samples
  and `fitLinkTravelTimes`' 8 traversals are both satisfied by time alone.
- **Leg distances at every caller.** 80 of 158 corridors judged nothing on
  implied speed. `CorridorInputs` supplies `cumulativeDistanceMeters`
  structurally; `evaluation/eligibilityCli.ts` builds a corridor without it.
- **Time-of-day banding.** `fitLinkTravelTimes` supports it and this pools the
  whole day, which inflates within-link variance by mixing peak and off-peak.
  One day cannot afford the bands; a fortnight can, and the pooled CV should
  be re-measured banded before it is used to set a preset.
- **A dispatch-regularity input in the trial**, per section 4. That is the
  larger uncertainty now, and nothing measures it.

## Reproducing this

Read-only, `SELECT` only. The snapshot figures come from one repeatable-read
transaction; the fits come from pure functions run over its rows.

```
pnpm --dir control-service sim:run --calibrate --corridors sample:20
pnpm --dir control-service sim:eligibility     # inputs_provenance
npx vitest run test/calibrationContamination.test.ts test/calibrationDispersion.test.ts
```

The network-wide pooled CV and its bootstrap interval come from
`measureDispersion` over `buildLinkObservations` per route-direction, with and
without `excludeContaminatedLinks`, resampling links 4,000 times.
