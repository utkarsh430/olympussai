# Controller evaluation harness

Measuring how well the deployed bunching control laws work, and searching for
better gains, in the mesoscopic simulator. Code lives at
`control-service/src/evaluation/`; the simulator it drives is
`control-service/src/simulation/` (see `docs/CONTROL_SERVICE_SIMULATOR.md`)
and the adapter that runs the *deployed* laws inside it is
`control-service/src/rehearsal/deployedControlLaws.ts`.

```bash
cd control-service

# No database needed. Good for checking the harness and the laws behave.
pnpm sim:run --corridors synthetic --scenarios all --seeds 40

# Real calibrated corridors, spread across the network by length.
CONTROL_SERVICE_DATABASE_URL=... pnpm sim:run \
  --corridors sample:10 --scenarios all --seeds 40 --out experiments/runs/baseline

# Fit dwell, boarding rate and link travel time from recorded stop visits
# instead of using the invented demand profile.
CONTROL_SERVICE_DATABASE_URL=... pnpm sim:run \
  --corridors sample:10 --calibrate --seeds 40 --out experiments/runs/calibrated

# Search the gain grid. Prints the SQL it would apply; never applies it.
CONTROL_SERVICE_DATABASE_URL=... pnpm sim:run \
  --sweep --corridors sample:10 --out experiments/runs/sweep
```

Everything is read-only. `--corridors sample:N` and explicit route-direction
ids issue SELECTs through `rehearsal/corridor.ts#loadCorridorInputs`, the same
reader the live detection path uses, so an uncalibrated corridor is refused
here exactly as it is refused there.

## The two halves of a report

### Control quality

Every figure is a **paired** difference. The same seed drives the controlled
arm and a no-control baseline on the identical corridor, scenario and demand
draw, so the difference is the controller and nothing else. `algo_new.md`
§8.3 rules out the alternative in as many words: a naive before/after mostly
measures the weather.

The interval is a 95% percentile bootstrap over seeds (`statistics.ts`).
Bootstrap rather than a *t*-interval because headway KPIs are bounded below
and skewed — EWT especially, since it is driven by the second moment.

A difference is reported as an improvement only if **all three** hold: the
interval excludes zero, it points the right way, and it wins on more seeds
than it loses. A mean that wins while most days lose is a lottery, not a
control law.

**Excess Wait Time is the headline; headway CV is a diagnostic.** CV is
scale-free, so a controller that lengthens every headway uniformly improves CV
while every passenger waits longer. `metrics.ts` labels the diagnostics and
the report prints the label.

### Algorithm coverage

A KPI table says how well the controller did. It cannot say *which* controller
was measured. This half says which laws generated a candidate, which were
selected, and — for every law that stayed silent — why.

That is not defensive documentation. For as long as the simulator advanced one
vehicle's whole trip at a time, `mpc/twoWayHold.ts` declined every pair it was
ever offered, so every evaluation ever run measured the self-equalizing
fallback alone. Nothing in the numbers said so, and a sweep over `kf` in that
state returns a flat surface whose honest reading is "unmeasured" but whose
obvious reading is "this parameter does nothing".

`test/evaluation/harness.test.ts` fails if two-way coverage returns to zero.

## Findings the harness surfaced, and what was done about them

### Terminal dispatch regulation could not fire — FIXED

`mpc/terminalDispatch.ts` read `h_fwd`. `isAtTerminal` requires
`dwelling_at_stop`, which `stopStateClassifier.ts` only assigns below
`DWELL_SPEED_THRESHOLD_KMPH = 2`; `computePairHeadways` then floors that speed
at `MIN_SPEED_KMPH = 1` and returns `h_fwd = gap / speed`. MEASURED: a 7.7 km
gap became `h_fwd = 27,601s` against a 900s target, so `H* - h_fwd` was always
negative and `rawHold <= 0` skipped every candidate. For `h_fwd` to fall under
a 900s target the preceding bus would have had to be within 250 m of the
terminal. **Algorithm A — "the default first line", and the lever the CTA
deployment measured its largest wait-time reduction from (`algo_new.md` §4.1)
— generated nothing, on every corridor, every cycle.**

The floor was not the bug. `h_fwd` is a *closing time* — "how long until I
reach where my leader is now, at my current pace" — and for a bus that is not
moving and has not begun its trip the honest answer is infinity; the floor
merely makes it finite. The bug was asking a closing-time question where the
quantity that matters is **elapsed** time: how long since the previous bus
pulled out. That is what blueprint 8.2 regulates, and what
`headway/stopHeadway.ts` had already noted the blueprint asks for at stops —
*"Only the second sentence was ever implemented."*

The law now reads an elapsed departure headway from `stop_visits.departed_at`
(`headway/repository.ts#loadLastStopDeparture`, one indexed row on the solve
path). Null — no observed departure — declines rather than falling back.

**Why a departure headway can be a control input here and nowhere else.**
`stopHeadway.ts` declines to be one for a sound reason: a
departure-to-departure gap needs both buses to have departed, by which point
no hold can change it. That does not hold at the origin, where the second bus
is still standing there and the hold is what sets its departure time.

Two things this changed that a reader should know:

- **The objective is scored on the departure gap too.** Fed the stationary
  `h_fwd`, `computePassengerCost` priced a wait nobody was having — roughly
  24,787 passenger-seconds on a candidate that is in fact free. An unclamped
  terminal hold now scores exactly zero, which is correct and is why the
  literature puts this lever first.
- **Terminal dispatch takes absolute priority in `selectActions` and
  suppresses the mid-route laws for any bus at the terminal.** Bringing it to
  life *changes* which buses get held, it does not merely add holds. Measure
  before rollout and stage it through `route_direction_rollout_stages`.

Pinned by `test/terminalDispatch.test.ts` — every fixture there carries
`h_fwd = 27,601s`, so any candidate that appears has demonstrably not been
computed from it — and by a coverage assertion in the harness tests.

### The demand profile was invented, and the invented value saturated — FIXED

`DEFAULT_MODELLED_INPUTS` (1.5 boardings/min, 18% alighting, 52 seats) implies
a steady-state load of `lambda x H* / alighting` ~= 125 against 52 seats. On
the 215 km fixture, 2,042 of 3,359 offered passengers were denied; EWT moved
242.0 -> 239.5 while headway CV moved 0.708 -> 0.557. The controller was
working and the metric was pinned, which is the most dangerous output this
harness can produce.

Two changes. `spec.ts#EVALUATION_DEFAULT_INPUTS` uses a profile with headroom,
and `report.ts` prints a **saturation warning** above `SATURATION_WARN_SHARE`
(20% denied) telling the reader the wait rows cannot respond.

And the real fix: `--calibrate` stops inventing the profile.
`evaluation/calibrate.ts` fits, per stop, from `stop_visits` alone:

```
dwell = beta_0 + beta_h x h_preceding          (calibration/dwell.ts)
lambda = beta_h / beta_b                        because B ~= lambda x h
```

`beta_b` — seconds of dwell per boarding passenger — is the **one** assumed
number, a property of the vehicle's doors and fare handling rather than of the
corridor's demand, and every derived rate scales inversely with it. It is
named in the provenance of every calibrated run. Everything else is measured,
with no ticketing data anywhere in the chain.

Three things fall out of the same fit: `beta_0`, replacing another guess; the
per-link travel-time distribution (`calibration/linkTravelTime.ts`); and the
**headway propagation eigenvalue `1 + beta_h`**, which says how fast a
corridor comes apart and therefore whether it needs control at all.

Still modelled, and still labelled modelled: the **alighting fraction**
(nothing observes passengers leaving, and unlike boardings it does not fall
out of a fit against preceding headway) and **vehicle capacity** (a property
of the fleet). Stops that did not fit keep the invented profile entirely, and
a corridor below `MIN_CALIBRATED_STOP_SHARE` is reported as *partially*
calibrated rather than rounded up — a half-calibrated corridor looks measured
and is the case most likely to mislead.

**The one thing this cannot fix.** `lambda` is also what
`mpc/objective.ts#arrivalRatePaxPerSecond` proxies as `1/H*` — the tripwire in
`CLAUDE.md` that makes a single onboard passenger zero any hold once occupancy
is connected. Fitting it here defuses that, but only once the fitted value is
wired into the objective as well, which is a change to a live control law and
has not been made.

## The sweep

Two stages (`sweep.ts`). A coarse grid at few seeds decides *where* to look;
coordinate-descent refinement at many seeds produces the number anyone is
asked to believe. The grid is centred so that the deployed setting
(`seed/harvest.ts#DEFAULT_GAINS`: kf 0.4, kb 0.2, k 0.35) is a point *on* it —
otherwise "the best grid point beats today" cannot be distinguished from "the
grid never tried today".

A candidate is disqualified if its headline improvement is not significant, or
if any guardrail metric is significantly worse. `deniedBoardings` is a
guardrail because every hold law can improve spacing by making buses wait, and
a full bus made to wait leaves people behind — a cost EWT cannot see, because
the passengers it falls on never boarded to have a wait measured.

Write-back is **printed, not run** (`renderApplySql`). `route_policies` is
versioned by `effective_from`/`effective_to`, so a new setting closes the
current row and inserts a successor; updating in place would destroy the
ability to interpret any KPI recorded under the old one.

## What this harness does NOT model

Stated here because a number without its scope is a number that will be
over-read.

- **The command lifecycle.** `cooldown_seconds`, `minimum_action_seconds`,
  `max_concurrent_actions`, acknowledgement and TTL live in the command path.
  These results are what the control laws **intend**, not the rate at which
  instructions reach a driver. Those parameters are deliberately absent from
  `policyOverrideSchema` — offering them as knobs would produce a confident
  optimum for something the run never exercised.
- **The state estimator.** The simulator knows every position exactly, so map
  matching, the Kalman filter and the low-confidence exclusion never run.
- **Corridor interaction.** One route-direction at a time.
- **Calibration, unless you pass `--calibrate`.** Without it, running time,
  boarding and alighting rates, dwell, capacity and occupancy are all invented
  and every report says so. With it, dwell / boarding rate / link travel time
  are fitted per stop from `stop_visits`; alighting fraction and capacity stay
  modelled either way. Check the data is there first:

  ```sql
  select route_direction_id, count(*), min(departed_at), max(departed_at)
  from stop_visits group by 1 order by 2 desc limit 20;
  ```

  Even fully calibrated, **a gain tuned here is a hypothesis to test on one
  corridor, not a setting to roll out.**
