# The deployed laws on the corridors that exist

Every published conclusion in this project came from three invented corridor
shapes — urban 24 km, suburban 60 km, inter-city 400 km — chosen to sample a
continuum. This is the first run of the same laws across the network itself,
and the first check of whether those three shapes predict it.

Reproduce, from `control-service/`:

    pnpm sim:run --config experiments/real-corridors.json --out experiments/runs/real
    pnpm sim:run --config experiments/presets.json        --out experiments/runs/presets

Both are read-only. 104 route-directions and 3 presets, five scenarios each, 20
seeds each. The running-time inputs are **measured**: dispersion 0.210 and
cruise speed 37.5 km/h, fitted from `stop_visits` in
`docs/CALIBRATION_MEASURED.md`. That matters more than it looks, because the
band a corridor lands in is a ratio of `sigma_leg` — those two numbers decide
which corridors are in this run at all. Against the modelled 0.2 / 35 km/h this
document was first drafted on, `sigma_leg / H*` falls about 2%, which moved the
selection by three corridors: two entered under the 0.16 ceiling (at 0.159 and
0.158) and one fell through the 0.03 floor. 102 of the original 103 are the same
corridors, and no headline below moves by more than one point. Every figure is a **paired** difference — the same seed drives the
controlled arm and the no-control baseline on the identical corridor, scenario
and demand draw — with a 95% percentile bootstrap interval, and a difference
whose interval spans zero is no effect however large its mean.

Changes are `controlled - no control`, so a **negative excess wait is an
improvement and a positive passenger time is time SPENT**. (The fleet trial
publishes that guardrail with the opposite sign, as
`passengerSecondsSavedPercent`. The two are easy to confuse in a handover.)

## The headline

**The presets predict three to four times more excess-wait improvement than the
real network delivers.** They are right about the sign and wrong about the size,
in the flattering direction, on every comparison that can be made.

| | Corridors | Readable groups | Excess wait, median | Passenger time, median | Bunching, median |
|---|---:|---:|---:|---:|---:|
| Three presets | 3 | 12 | **−52.2%** | **+5.4%** | −82.5% |
| Real, in band | 104 | 437 | **−13.6%** | **+0.7%** | −41.2% |

Per scenario the gap is consistent, so it is not one scenario's accident:

| Scenario | Preset EWT | Real EWT | Preset pax time | Real pax time |
|---|---:|---:|---:|---:|
| `none` | −62.9% | −25.5% | +6.5% | +0.8% |
| `missed_trip` | −33.0% | −7.5% | +3.9% | +0.5% |
| `gps_dropout` | −30.8% | −10.4% | +5.4% | +0.7% |
| `non_compliance` | −48.5% | −17.4% | +5.9% | +0.8% |
| `demand_burst` | *(all three saturated)* | −31.1% | — | +1.6% |

**The preset results do not contain the real ones.** The twelve preset groups
span −74.1% to −23.6%. Only 110 of the 437 real groups (25%) fall inside that
span; **327 of them (75%) are weaker than the weakest preset result.**

The controller does help. Of the 437 readable real groups, **356 are a real
improvement** on excess wait (interval excluding zero, and winning on more seeds
than it loses), 67 show no effect, and **14 fail that bar while still being
significant** — 11 of them significantly in the WRONG direction, and 3 that move
the right way on the mean while losing on half their seeds or more. 88 of 104
corridors are better on at least half their readable scenarios and 3 are better
on none.

The finding is not that the laws fail. It is that **the number a reader carries
away from the preset evidence is roughly four times what this network would
return** — and that the preset evidence contains no case at all where control
makes excess wait worse, while the real network has eleven.

Per corridor, taking each one's median across its readable scenarios:

| p10 | p25 | median | p75 | p90 |
|---:|---:|---:|---:|---:|
| −24.0% | −17.7% | **−12.5%** | −6.9% | −1.2% |

21 of 104 corridors gain less than 5%.

## Three reasons, in the order of how much they explain

### 1. The presets do not span the network. They sit at and below its short end.

The entire case for three shapes is that they sample a continuum. Measured
against the 104 in-band route-directions:

| Preset | H* | Real in-band corridors with a SHORTER headway |
|---|---:|---:|
| urban | 360 s | **0%** |
| suburban | 720 s | 3% |
| inter-city | 1,800 s | 22% |

The real in-band headways run 600 s to 12,449 s with a median of **2,475 s**.
The shape the trial treats as its long extreme sits at the network's 22nd
percentile, and the urban shape — which produces the largest gain and carries
most of the argument — has no counterpart on this network at all. The three
presets do not bracket the continuum; they cluster below it.

Matched by headway the overstatement survives but shrinks, which is what a
range problem looks like rather than a modelling one:

| Preset | Preset EWT median | Matched real corridors (H* ±25%) | Their EWT median |
|---|---:|---|---:|
| inter-city (1,800 s) | −30.8% | 39 corridors, 160 groups | −17.4% |
| suburban (720 s) | −33.0% | 7 corridors, 28 groups | −9.3% |
| urban (360 s) | −58.7% | **none in range** | — |

### 2. `max_hold_seconds` is a flat 600 on all 198 calibrated policies.

Each preset deliberately sets its hold budget to **a third of its own headway**
— the urban preset's docblock calls it "proportionate to the headway" in as
many words. The real network ships one number for every corridor against
headways spanning 300 s to 12,497 s, so the ratio a corridor gets is an
accident of its route: the quartiles are 0.168, 0.333 and 0.627, and the extremes
are 0.048 and 2.0.

| 600 s / H* | Corridors | Groups | Excess wait, median | Pax time, median | Hold applied per run |
|---|---:|---:|---:|---:|---:|
| under 0.10 | 11 | 45 | **−2.6%** | +0.2% | 629 s |
| 0.10 – 0.20 | 26 | 116 | −13.3% | +0.6% | 2,114 s |
| 0.20 – 0.35 | 51 | 213 | −16.4% | +1.0% | 2,139 s |
| 0.35 – 1.0 | 15 | 59 | −14.1% | +1.1% | 1,125 s |
| over 1.0 | 1 | 4 | −7.5% | +1.4% | 366 s |

Eleven in-band corridors have a hold budget under a tenth of their headway and
get almost nothing: the laws propose, the cap truncates, and 661 s of hold
across a whole run cannot close gaps measured in thousands of seconds. One
corridor has a cap of **twice** its headway, which is not a setting anybody
chose either.

This is a `route_policies` column, not an algorithm change, and it is exactly
the case `AGENTS.md` names — *a value fitted on one corridor and shipped for all
is the single commonest error in this area.* It explains the weak tail. **It
does not explain the whole gap**: even in the healthy 0.20–0.35 band the real
median is −16.4% against the presets' −52.2%.

The same is true of the gains. `kf`, `kb`, `self_equalizing_k`,
`bunched_threshold_ratio` and `warning_threshold_ratio` are *identical on all
198 calibrated policies* — one setting shipped network-wide.

### 3. The laws that fire are a different mix.

| Law | Preset: generated / selected | Real: generated / selected |
|---|---|---|
| `terminal_dispatch` | 3.6% / 3.4% | **11.3% / 10.7%** |
| `two_way` | **17.3% / 15.5%** | 10.3% / 9.5% |
| `self_equalizing` | 5.4% / 5.3% | 2.8% / 2.8% |
| `cost_optimal` | 15.3% / **0.0%** | 9.7% / **0.0%** |
| `boarding_limit` | 0.8% / 0.0% | 0.7% / 0.0% |

Over 23,000 preset decisions and 264,480 real ones. Terminal dispatch does three
times as much of the work on the real network and two-way holding a little over
half as much, so a gain tuned on the presets is tuned against a different
balance of laws from the one that would actually run.

`cost_optimal` generates on 9.7–15.3% of decisions and is selected on **none**,
on both — reproducing the known defect exactly: `mpc/objective.ts`'s lambda
proxy is `1/H*`, the score charges a real-passenger load against a wait term
scaled by the same understated lambda, and the one law that checks its own
objective declines. See `AGENTS.md`, "The objective's lambda is a proxy, and it
is a loaded gun". `boarding_limit` is near-silent on both for the reason
`presets.ts` gives: it is an urban lever and needs a bus within 240 s behind.

## The guardrail

Total passenger time is **significantly worse on 266 of the 437 readable real
groups** (61%) and significantly better on none. Holding buys spacing with the
time of the people already aboard, and on the real network it does so on roughly
two thirds of what it touches.

The magnitude is what the presets get wrong, and here they overstate in the
*cautious* direction: **+0.7% on the real network against +5.4% on the presets.**
So the trade is real, and smaller than the preset evidence implies in both
directions at once — less wait saved, less time spent. That is consistent, and
both follow from holds that are shorter relative to their headway.

## Saturation

The run this replaces could not answer any of the above. With one invented
boarding rate, real corridors saturated at 74.6–96.4% denied boardings, and a
saturated corridor is the one regime where excess wait cannot respond to control
at all. That was never a fact about the corridors: a stop boards `lambda x H`
and sheds `alightingFraction` of the load, so a modelled bus's load is
**proportional to the corridor's own target headway**, and the 0.8/min default
was picked against a 900 s synthetic corridor while this network's median
measured headway is 1,800 s. 79% of in-band corridors were over their seat count
before any scenario ran, and `lambda x H* / alighting` against 52 seats
predicted saturation on exactly the three of five sampled corridors that
measured it.

`evaluation/demand.ts` now sizes each corridor's rate from its own headway, stop
count, alighting fraction and seats. With that:

| | Saturated groups |
|---|---|
| real | 83 of 520 — **81 of them `demand_burst`**, plus 2 `missed_trip` |
| presets | 3 of 15 — one `demand_burst` each |

`demand_burst` puts an ×8 surge on one stop; it is *supposed* to overload, and it
saturates the presets too. Outside it the real network is clear: 0 of 104 on
`none`, `gps_dropout` and `non_compliance`. Saturated groups are excluded from
the pooled headline and named — the same rule and the same measured reason as
`FleetTrialReport.headlineScope` — and they stay in the per-corridor table.

## What this run does NOT establish

- **The demand is still invented, only per corridor now.** The derived rate is
  inverted out of a target peak load of 0.65 of the seats — the middle of the
  range the three presets themselves run at (48%, 64%, 74%) — so a real corridor
  is compared with them in their own load regime. It is a choice, it is the one
  free parameter left in `demand.ts`, and it is printed on every report. A rate
  fitted from `stop_visits` beats it wherever one exists and arrives through
  `demand.boardingRatePerMinuteByRouteDirectionId` — but as of the first day of
  recorded visits **no corridor is calibrated**: none of the 158 with visits
  reaches `isCalibrated`, the best reaching 20% of stops against a 50% bar
  (`docs/CALIBRATION_MEASURED.md`). So that seam is real and currently empty,
  and every boarding rate in this run is derived. Alighting fraction and seat
  count remain invented for every corridor.
- **The band now rests on ONE DAY of measurement, not on nothing.** Selection
  is `sigma_leg / H*` inside `CONTROLLABLE_BAND`, and its two inputs are now the
  fitted 0.210 and 37.5 km/h rather than assumptions — but that fit covers 10.7
  hours of a single calendar day, which is not a measurement by this repo's own
  seed-spread convention. It is also sensitive: 132 route-directions are in band
  at a spread of 0.12 and 104 at 0.21. See `docs/CALIBRATION_MEASURED.md` and
  `docs/CORRIDOR_ELIGIBILITY.md`.
- **The gap is not the travel-time spread, though the presets do understate
  it.** All three presets run below the measured 0.210 — they ship 0.18, 0.16
  and 0.14 — so every preset result is produced on a corridor calmer than this
  network's. That is a real bias, and it is not the explanation: re-running the
  presets AT the measured 0.21 moves their excess-wait median only from −52.2%
  to **−51.2%**, against the network's −13.6%.
- **The command lifecycle is not modelled.** Cooldowns, minimum action time,
  `max_concurrent_actions`, acknowledgement and TTL live in the command path.
  These are what the laws INTEND, not what would reach a driver.
- **Six buses per corridor, on all of them.** `vehicleCount` is 6 for presets and
  real corridors alike, so the comparison is like for like — but a six-bus
  dispatch spans 14,904 s on the median real corridor against 4,320 s on the
  median preset, so a longer-headway corridor is answering the question over a
  longer window with the same fleet. Worth varying before treating the
  long-headway rows as final.
- **`too_few_vehicles` is waived here.** The live-vehicle half of an eligibility
  verdict is a 300-second snapshot of `vehicle_states`, and it moves: this
  network had 57 route-directions carrying a live pair when this run was made.
  The simulator dispatches its own fleet, so that snapshot decides nothing about
  the simulation. These 104 are the corridors that are calibrated and in band;
  which of them the decision cycle can act on *today* is `pnpm sim:eligibility`'s
  question, not this one's.

## What to do about it

1. **Stop quoting preset numbers as network numbers.** Anything sourced from the
   three shapes should be read as an upper bound on this network — roughly 4× on
   excess wait, roughly 7× on the passenger-time cost — and as silent about the
   corridors where control makes things worse, because it contains none.
2. **Make `max_hold_seconds` proportionate to H\*.** It is a config sweep, not a
   code change, and 11 in-band corridors currently get almost nothing from
   control because of it. `pnpm sim:run --sweep` prints the SQL and never runs it.
3. **Add a preset above the network's median, or stop calling three shapes a
   continuum.** Two of the three sit below the entire real headway range.
4. **Look at the 7 groups where control makes excess wait significantly worse.**
   The preset evidence contains no such case, so nothing in the existing corpus
   describes them.
5. Nothing here is a reason to change a control law. The laws behave; the
   corridors and the policy rows they run against are the difference.
