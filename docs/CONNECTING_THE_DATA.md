# Connecting the data

Everything described here is built, tested and deployed-safe **today**. Each
section below is what happens when one data source arrives, and what you have
to change to switch it on. In every case the answer is a migration or an
`UPDATE`, not a code change — the code paths already exist and already run,
they just resolve to `null` and degrade to the previous behaviour.

The design rule throughout: **an unmeasured quantity is `null`, never `0`.**
A zero on-time rate and an unmeasured one look identical on a dashboard and
mean opposite things.

---

## 0. Available now — no UPSRTC data needed

Two things start working the moment this deploys, from the GPS feed already
running.

### The decision loop is closed

`scheduler/decisionCycle.ts` asks the controller what to do every 90 s for
every corridor with live vehicles, and writes `recommendations` rows. Before
this, `mpc/solve` had exactly one caller — a dispatcher opening the console —
so a corridor coming apart at 03:00 produced an incident nobody answered.

It writes proposals only. A test reads its source and fails if the command or
webhook modules are ever imported.

Switch: `DECISION_CYCLE_ENABLED` (default `true`). Run it on **one** instance
in a multi-replica deployment — the duplicate guard reads-then-writes, so two
replicas ticking together can both write the same proposal. The consequence is
a duplicated row in history, never a duplicated instruction.

### Stop crossings start recording

`stop_visits` fills from geofence entry/exit in the state estimator. Within a
day you have departure-to-departure headway **at stops** — the measurement the
operator priority is actually defined on, which nothing in this system had
before. `daily_kpi_snapshots.ewt_at_stop_seconds` / `.cv_at_stop` populate
automatically.

Precision is one 30 s polling interval at each end. On a 1,800 s median
headway that is under 2% of what is being measured. It would **not** be good
enough for fitting boarding rates on short dwells — which is why
`stop_visits` stores no `dwell_seconds` column and callers derive it
explicitly.

---

## 1. Timetable + service calendar → punctuality

**Populate:** `trips` and `trip_stop_times`.

You already ingest `sta`/`std` per journey per stop area from
`getScheduledBusInfo.php` (`ingestion/upsrtc/staticData.ts`) — it is currently
used only to derive a median target headway and then discarded. What is
missing is the **service calendar**: which journeys run on which day type, and
each timetable version's effective dates. Without it, seconds-since-midnight
cannot become an instant on a date.

**Then set, per corridor:**

```sql
update route_policies
   set ks = 0.3,                    -- schedule-adherence gain
       max_lateness_seconds = 600   -- hard punctuality bound
 where route_direction_id = '...' and effective_to is null;
```

**What switches on:**

| Where | Effect |
|---|---|
| `mpc/twoWayHold.ts`, `terminalDispatch.ts` | The `−Ks·ε` term. Early bus → longer hold (free); late bus → shorter hold, so the gap is closed from the vehicle behind instead. |
| `mpc/safety.ts` | `max_lateness_breach` rejection. A hold that would push a bus past the bound is refused, and refused *distinguishably* from a hold-cap breach. |
| `mpc/objective.ts` | The lateness term starts pricing punctuality into candidate ranking. |
| `schedule/punctuality.ts` | On-time rate, early rate, p90 lateness — computable once `stop_visits` and `trip_stop_times` both have rows. |

`vehicle_states.trip_id` populates automatically via
`resolveCurrentTrip` — that chain is already wired and merely starved.

**Tuning `ks`:** it is the dial between pure headway control (`ks = 0`,
today's behaviour) and pure schedule adherence. Start low. The **bound** is
the punctuality guarantee; `ks` is only the preference.

**Check first:** if the published timetable is itself unevenly spaced — 12
minutes then 48 — then punctual and evenly spaced are mathematically
incompatible and no controller can deliver both. That is a planning fix, not a
control fix. Worth an afternoon the moment the timetable lands.

---

## 2. Ticketing / ETM → occupancy, demand, denied boarding

**Populate:** `vehicle_states.occupancy_count` (running load) and, for
calibration, boardings per stop per trip.

**Then set, per corridor:**

```sql
update route_policies
   set occupancy_capacity = 52,
       occupancy_stale_seconds = 300
 where route_direction_id = '...' and effective_to is null;
```

**What switches on:**

| Where | Effect |
|---|---|
| `mpc/objective.ts` | The in-vehicle cost term stops being zero. Between two equally-bunched pairs the controller starts preferring to hold the emptier bus. |
| `headway/deniedBoarding.ts` | Detects the bunching *amplifier* — at-capacity **and** dwell far below the fitted model. Needs a dwell model too (§3). |
| `computeLoadBalance` | p90 load and load spread — the third priority stated directly. |

> ### ⚠️ Calibrate λ before enabling occupancy
>
> `mpc/objective.ts#arrivalRatePaxPerSecond` proxies λ as `1/H*` — one
> passenger per planned headway, everywhere, always. That is a placeholder.
>
> λ sets the exchange rate between passengers **waiting** and passengers
> **riding**. Too low and the onboard term dominates: you get a controller
> that always holds the emptiest bus regardless of the gap it is fixing. Too
> high and it holds a crush-loaded bus to spare one person at a stop.
>
> This is harmless *today* only because occupancy is null, so the onboard term
> is zero and λ cancels out of the ranking. **The moment occupancy is enabled
> it stops cancelling.** Fit λ with `calibration/demand.ts` first and replace
> the proxy.

---

## 3. Calibration — runs on your own data, no UPSRTC feed

`calibration/` fits from `stop_visits`, so it works as soon as §0 has been
collecting for a couple of weeks.

- **`dwell.ts`** — fits `dwell = β₀ + β_h · preceding_headway` per stop.
  `1 + β_h` is the **headway propagation eigenvalue**: above 1 the stop
  amplifies deviations and bunching is inevitable without control. This is the
  first number that says *how fast a given corridor comes apart*, which
  decides whether it needs control at all and how early. Also tells you where
  control points belong — the high-β_h stops, not evenly spaced ones.
- **`linkTravelTime.ts`** — empirical distribution per link per time band.
  Keeps the samples, not just a mean: controller robustness lives in the
  tails, and a hold computed against a mean link time is wrong on exactly the
  day that needed control.
- **`demand.ts`** — λ. Needs boardings; returns `[]` until then, and that
  emptiness is asserted in the tests.

When ticketing arrives, `fitDwellModel` gains boarding/alighting regressors
and β_h decomposes into a boarding rate and a per-passenger service time.
Nothing above it changes — consumers ask for an expected dwell, and both forms
provide one.

---

## 4. Pace guidance — needs a driver display, not data

`mpc/paceGuidance.ts` is built and returned on every solve as
`paceAdvisories`. It is **deliberately not a `CandidateAction`**: the solver
ranks candidates in passenger-seconds and would happily select a speed
instruction that no delivery path can carry. A hold is executed at a stop
where the driver is already stationary; a pace target only means anything on a
display they can see while moving. The type system is what prevents it being
dispatched.

Today a dispatcher can act on it by radio. It is the **only lever that
improves punctuality and spacing at the same time** — a bus running early and
closing on its leader spends slack it already holds, rather than adding delay.

Safety posture, deliberate and tested: it only ever advises going **slower**,
and never advises easing off into the bus behind.

Set `speed_band_min_kmph` / `speed_band_max_kmph` per corridor to bound it.

---

## Where each number appears

| Priority | Column | Needs |
|---|---|---|
| On time | `on_time_rate`, `p90_lateness_seconds` | Timetable (§1) |
| Evenly spaced at the stop | `ewt_at_stop_seconds`, `cv_at_stop` | **Nothing — live now** |
| Passengers evenly distributed | `p90_load_fraction`, `load_spread_fraction`, `denied_boarding_count` | Occupancy (§2) |

`ewt_seconds` / `cv` (no suffix) remain the **gap/speed model** from
`headway_states`. Both are kept side by side on purpose: they answer different
questions and will disagree, and the disagreement is information about the
model rather than a fault in either.
