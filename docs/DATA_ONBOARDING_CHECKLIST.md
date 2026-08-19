# Data onboarding — read this before connecting anything

Everything in the bunching controller is built, wired and tested. What
remains is data. This document is the set of things that are **not obvious
from the code** and that will cost you real time or produce quietly wrong
answers if you skip them.

Companion documents:
- `docs/CONNECTING_THE_DATA.md` — the mechanical steps per data source
- `docs/BUNCHING_CONTROLLER_AUDIT.md` — why the controller is shaped this way
- The data request artifact — what to ask UPSRTC for, field by field

---

## Before anything else: run the migrations

Four migrations were added and **none of them has been applied**. Nothing
below works until they are.

```bash
cd control-service
DATABASE_URL=... pnpm migrate
```

| Migration | Adds |
|---|---|
| `20260819120000__raise_hold_cap` | Hold cap default 90s → 600s |
| `20260819140000__schedule_adherence` | `route_policies.ks`, `.max_lateness_seconds` |
| `20260819150000__stop_visits` | The stop crossing log |
| `20260819160000__measured_kpis` | Nine KPI columns, one set per priority |

**Prove the stop-visit migration idempotent against a scratch container, not
the shared one.** Both local Postgres instances are shared and another process
may depend on them.

---

## The three things most likely to bite you

### 1. Calibrate λ *before* you switch occupancy on — not after

This is the single highest-risk item in the whole handover.

`mpc/objective.ts#arrivalRatePaxPerSecond` currently proxies the passenger
arrival rate as `1/H*` — one passenger per planned headway, at every stop, at
every hour. It is a placeholder, not an estimate.

λ sets the exchange rate between two competing costs in the objective:

```
J = w_h · λ · h²/2   ← passengers WAITING at the stop
  + w_v · L · d      ← passengers RIDING the bus you are holding
  + w_c · d
```

- **λ too low** → the onboard term dominates → the controller always holds the
  emptiest bus, regardless of the gap it is supposed to be fixing.
- **λ too high** → it holds a crush-loaded bus to spare one person at a stop.

Neither failure announces itself. Both produce a controller that runs, emits
plausible-looking holds, and optimises the wrong thing.

**Why it is harmless today:** occupancy is null fleet-wide, so `L` is zero, the
onboard term vanishes, and λ cancels out of the ranking entirely. Ranking is
currently pure second-moment wait cost, which is correct.

**The moment you populate `occupancy_count`, λ stops cancelling.** Fit it with
`calibration/demand.ts` from ticketing data and replace the proxy in
`arrivalRatePaxPerSecond`. Do that in the same change that enables occupancy,
not in a follow-up.

### 2. Check whether the timetable is itself evenly spaced

The day the timetable lands, before tuning anything, check the distribution of
scheduled gaps per corridor.

If the published schedule has 12-minute gaps followed by 48-minute gaps, then
**punctual and evenly spaced are mathematically incompatible** and no
controller can deliver both. That is a planning problem, not a control
problem, and no amount of gain tuning will fix it.

It is roughly an afternoon's work to check and it changes what you should
promise about the system. Do it first.

### 3. Pace guidance is deliberately not dispatchable

`mpc/paceGuidance.ts` is built and returned on every solve as
`paceAdvisories`. It is **not** a `CandidateAction`, and that is not an
oversight to tidy up later.

The solver ranks candidates in passenger-seconds and would happily select a
speed instruction — but no delivery path can carry one. A hold is executed at
a stop where the driver is already stationary; a pace target only means
something on a display they can read while moving, and must never become
something read mid-corner. Keeping it off the candidate list is what makes
dispatching it *impossible* rather than merely discouraged.

Today a dispatcher acts on it by radio. It is the **only lever that improves
punctuality and spacing simultaneously**, because a bus running early spends
slack it already holds instead of adding delay.

Promote it to a candidate type only when a driver-facing display exists.

---

## Fit the dwell model first — it needs nothing from UPSRTC

`stop_visits` starts filling from your existing 30-second GPS feed the moment
this deploys. After roughly two weeks, `calibration/dwell.ts` can fit:

```
dwell = β₀ + β_h · preceding_headway
```

**`1 + β_h` is the headway propagation eigenvalue.** Above 1, a stop amplifies
headway deviations and bunching is inevitable without control. This is the
first number in the system's history that says *how fast a given corridor
comes apart*.

Two decisions come directly out of it:

- **Which corridors need control at all.** A corridor at 1.02 drifts slowly
  enough that terminal dispatch alone may hold it. One at 1.4 will bunch
  within a handful of stops whatever happens at the terminal.
- **Where control points belong.** At the high-β_h stops — not evenly spaced.
  A handful of stops generate most of the variance; placing control points
  uniformly spends the intervention budget where it does nothing.

Run this before asking UPSRTC for anything else. It will tell you which
corridors are worth the pilot.

---

## What each data source unlocks

| You provide | Switches on | Config to set |
|---|---|---|
| *(nothing)* | Decision loop, stop crossings, at-stop EWT/CV, dwell + link calibration | `DECISION_CYCLE_ENABLED=true` |
| Timetable + **service calendar** | `−Ks·ε` term, `max_lateness_breach`, on-time rate, p90 lateness | `route_policies.ks`, `.max_lateness_seconds` |
| Ticketing / ETM | In-vehicle cost term, denied boarding, load balance, λ | `.occupancy_capacity`, `.occupancy_stale_seconds` |
| Bus capacity table | The denominator for everything occupancy-related | `.occupancy_capacity` |
| Stop holding eligibility | Which stops may be held at | Per-stop config |

The **service calendar** is the piece people forget. You already ingest
`sta`/`std` per journey per stop area; what is missing is which journeys run
on which day type and each timetable version's effective dates. Without it,
seconds-since-midnight cannot become an instant on a date, and *nothing*
punctuality-related works.

---

## Rules the codebase enforces — do not "fix" them

These look like gaps and are deliberate. Each has a test pinning it.

**`null` means not measured, never zero.** A zero on-time rate and an
unmeasured one look identical on a dashboard and mean opposite things. If a
UI renders a missing `on_time_rate` as 0%, it is stating the opposite of the
truth.

**An unscheduled departure contributes nothing to on-time performance.**
Counting it as on-time would make punctuality *rise* as timetable coverage
*falls* — the most misleading direction the number can move.

**Unknown occupancy costs nothing in the objective — it is not assumed to be
half-full.** The advisory tier substitutes a mid-load fraction; the selection
path does not. A constant invented identically for every candidate cannot
break a tie, only skew the wait/onboard balance on an unmeasured number.

**A visit with no ticket record is unobserved, not empty.** Counting it as
zero boardings would drag λ toward zero in exact proportion to how patchy the
ticketing feed is.

**The decision cycle writes proposals, never commands.** A test reads its
source and fails if the command or webhook modules are ever imported. Run it
on **one instance** — the duplicate guard reads-then-writes, so two replicas
ticking together can both write the same proposal.

**Pace guidance only ever advises going slower.** A controller that tells a
late bus to hurry has made road safety its adjustment variable.

---

## Two numbers that will disagree, and should

`daily_kpi_snapshots` carries both:

- `ewt_seconds` / `cv` — from `headway_states`, the **gap/speed model** sampled
  wherever buses happen to be. This is what the controller acts on, because it
  is available continuously and control cannot wait for a departure.
- `ewt_at_stop_seconds` / `cv_at_stop` — from `stop_visits`, **measured**
  departure-to-departure headway at stops. This is what the operator priority
  is defined on.

They will disagree. The disagreement is information about the model, not a
fault in either. Expect the model-based figure to be least trustworthy exactly
at stops, where a stationary vehicle is floored to 1 km/h and reports a
headway of hours.

---

## Precision limits worth knowing

`stop_visits` timestamps come from a 30-second GPS poll and a geofence, not a
door sensor. Arrival is the first fix inside; departure is the first fix
outside. Each carries up to one polling interval of error.

- **Fine** for headway at a 1,800s median (under 2% error) and for comparing
  dwells across a day.
- **Not fine** for fitting boarding rates on short dwells.

This is why `stop_visits` has no stored `dwell_seconds` column — callers derive
it explicitly, having decided the precision suits their purpose. If UPSRTC's
AVL platform emits real stop events, take them: `stop_visits.source`
distinguishes `gps_geofence` from `avl_stop_event` so the two are never
silently averaged together.

---

## Still not built

- **Persisted calibration models.** `calibration/` fits are computed in place
  inside the daily KPI. There is no table of fitted models and no job
  refreshing them. Fine for now; needed if you want cross-day fits or want the
  live controller to consume a dwell model.
- **Pace advisories in the web UI.** The solver returns them; no schema or
  component surfaces them yet.
- **Per-stop holding eligibility.** No column exists. Currently every control
  point is assumed holdable.
- **Simulator validation gate.** The simulator cannot yet replay a historical
  day and prove it reproduces observed headway CV within a stated tolerance —
  it dispatches vehicles sequentially, so it structurally cannot supply the
  vehicle *behind* the one being decided about. Closing that needs an
  interleaved event loop, and it is the blocker on validating the corrected
  two-way law in simulation.
