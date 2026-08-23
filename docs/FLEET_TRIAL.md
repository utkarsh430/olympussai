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

## What the trial still does not test

- **The command lifecycle.** Cooldown, minimum action interval, maximum
  concurrent actions, acknowledgement and expiry all live in the command path.
  A result here is the control law's **intent**, not the rate at which
  instructions would reach a driver.
- **The state estimator.** Production map-matches and filters a GPS fix and
  excludes low-confidence vehicles before any headway is computed. The simulator
  knows its own world exactly.
- **Real demand.** Every passenger was invented.
- **The timetable.** "Punctuality" here is end-to-end journey time and what
  holding added to it, not lateness against a published departure.

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
