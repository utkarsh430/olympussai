# Control Service Simulator — Historical Replay & Regression Suite

Status: **Implemented, library-level.** Covers the AC of "Historical
replay & mesoscopic simulator with regression suite": a calibrated
event-based simulator, a historical-replay mode, a pluggable-controller
interface, and a regression scenario library that auto-runs as a release
gate. Blueprint reference: `docs/Olympuss_AI_UPSRTC_Bus_Bunching_Technical_Blueprint.md`
section 11.1, "Mesoscopic simulator - non-negotiable" - this document is
explicit that the simulator must exist and pass before any live control,
and section 12's checklist item "Historical replay and simulator
regression suite passed for planned controller version."

Code lives at `control-service/src/simulation/` (a standalone module tree
inside the control-service package - see "Isolation guarantee" below for
why it is not exported from the service's process entrypoint). Tests live
at `control-service/test/simulation/`.

## What it is

An event-based mesoscopic simulator: it steps a set of vehicles through an
ordered stop sequence for one route-direction, at each stop computing
stochastic (or, in replay mode, recorded) link travel time, passenger
boarding/alighting against a capacity limit, and dwell time, and calling a
pluggable controller at designated control-point stops to decide whether
to hold the vehicle. It accumulates the full stop-visit timeline and a KPI
summary (headway mean/CV, bunching incidents, excess wait time, denied
boardings, on-time dispatch rate, compliance rate).

| Blueprint capability (11.1) | Where |
|---|---|
| Vehicle movement: link-level stochastic travel times | `engine.ts` samples `LinkTravelTimeModel` via `Rng.nextNonNegativeGaussian` |
| Stops and dwell: boarding/alighting, capacity, holds | `engine.ts` capacity clamp + `StopDemandModel` dwell formula |
| Operations: terminal dispatch, missed trip, non-compliance, no-overtake | `types.ts` `Disturbance` union + `minSeparationSeconds` clamp in `engine.ts` |
| Control plug-in: run against the same scenario | `Controller` interface (`types.ts`), `controllers.ts` |
| Passenger accounting | `kpi.ts` (`KpiSummary`) |
| Replay mode | `replay.ts` (`runHistoricalReplay`, `compareControlToNoControl`) |
| Release tests | `regressionRunner.ts` + `scenarios/*` + `test/simulation/regression.test.ts` |

## Isolation guarantee (AC: "writes no production data and never touches the live command path")

`control-service/src/simulation/**` has zero imports from `../db`,
`../state` (the live in-memory `stateStore`), `../routes`, `../webhooks`,
or `../mpc` (the real `mpc.solve` used by the live command path). It never
opens a Postgres connection, never calls `fetch`/`express`, never signs or
sends a webhook. Every function in the module is a pure computation over
caller-supplied plain-data inputs (`ScenarioConfig`, `HistoricalDayFixture`)
returning plain-data outputs (`SimulationResult`); nothing it does is
observable outside the returned value. `control-service/src/index.ts` (the
process entrypoint) does NOT re-export `simulation/` the way it does
`state-estimation/` - that re-export happens at module-import time and
would otherwise pull simulation code into the same import graph as the
side-effecting `app.listen(...)` / `rehydrateState()` calls at the bottom
of that file. Import the simulator directly from
`control-service/src/simulation/index.ts`.

This is asserted, not just described: `test/simulation/replay.test.ts`
("writes no production data and touches no live command path") walks
every file under `src/simulation/` and fails if any of them import from
`../db/`, `../state/`, `../routes/`, `../webhooks/`, or `../mpc/`.

## Pluggable controller interface

```ts
interface Controller {
  name: string;
  decide(context: ControllerContext): ControllerDecision;
}
```

`controllers.ts` ships two: `noControlController` (baseline, never
intervenes) and `createSelfEqualizingController({ gain })` (mirrors the
gain-on-headway-deviation law in `../mpc/solver.ts`, reimplemented
independently per the isolation guarantee above - not imported from it).
Any other controller (rule-based, two-way, MPC, a research/RL policy)
plugs in by implementing the same interface; `engine.simulate(config,
controller)` and `replay.compareControlToNoControl(fixture, controller)`
run the identical scenario/recorded day under any controller, which is
the mechanism behind the "no-control vs controlled comparison" AC.

## Historical replay mode & reproduction tolerance

`replay.ts`'s `runHistoricalReplay(fixture, controller, toleranceRatio)`
feeds a `HistoricalDayFixture`'s exact recorded per-vehicle, per-stop link
travel times and boarding/alighting counts through the full engine (no
sampling occurs - see `RecordedInputs` in `types.ts`) and compares the
resulting KPIs against `fixture.recordedKpis`.

**`fixture.recordedKpis` is computed independently of the engine**, via
`referenceKpi.ts`'s `computeReferenceKpisFromRecordedInputs` - a direct
cumulative-time walk over the recorded inputs with no no-overtake
clamping, no capacity-driven denial, and no controller. This keeps the
reproduction check meaningful: it is comparing two independent
implementations of "what happened that day," not the engine against
itself.

The shipped fixture (`fixtures/historicalDay.ts`) is a synthetic
stand-in for a real AVL/APC extract (none is available in this repo);
capacity and minimum separation are deliberately generous so the
engine's clamps never bind against this particular day, meaning
`recordedKpis` and the full-engine replay should agree almost exactly.

**Documented tolerance: `DEFAULT_REPLAY_TOLERANCE_RATIO = 0.02` (2%
relative, with an absolute floor of 1 unit for near-zero baselines)**,
applied to mean headway, headway CV, bunching incidents, excess wait
time, denied boardings, stranded passengers, on-time dispatch rate, and
total boardings (see `KPI_KEYS_CHECKED` in `replay.ts`). `test/simulation/replay.test.ts`
asserts every one of those KPIs is within tolerance for the shipped
fixture, per-key, with the failure message naming which KPI and by how
much if it ever regresses.

When a real AVL/APC extract becomes available, replace
`HISTORICAL_RECORDED_INPUTS` in `fixtures/historicalDay.ts` with the
ingested extract and recompute `recordedKpis` the same way (calling
`computeReferenceKpisFromRecordedInputs`); the 2% tolerance should be
revisited then against real sensor noise/rounding rather than the
synthetic day's near-exact agreement.

## Regression scenario library (release gate)

`scenarios/` ships the four scenario categories the AC requires, each a
`ScenarioConfig` builder registered in `scenarios/index.ts`'s
`ALL_SCENARIOS`:

- **`demand-burst`** (`demandBurst.ts`) - an 8x boarding-rate spike at one
  stop for a 20-minute window.
- **`missed-trip`** (`missedTrip.ts`) - one scheduled vehicle never
  dispatches; the engine's wait-window bookkeeping means the next vehicle
  inherits the larger accumulated demand automatically.
- **`gps-dropout`** (`gpsDropout.ts`) - one vehicle's state is marked
  stale for the whole run; the guardrail is that no controller may issue
  a hold referencing stale state.
- **`non-compliance`** (`nonCompliance.ts`) - one vehicle's driver ignores
  70% of issued hold instructions; `KpiSummary.complianceRate` tracks the
  gap between intended and applied holds.

`regressionRunner.ts`'s `runRegressionSuite(controllers)` runs every
scenario against every supplied controller and checks universal
guardrails on each result: no NaN/Infinity KPI, every applied hold within
`[0, maxHoldSeconds]`, no hold applied while state was stale, no negative
passenger counts.

**How this "auto-runs as a release gate":** `test/simulation/regression.test.ts`
calls `runRegressionSuite` and throws (failing the test) if any guardrail
is violated. That test file matches `vitest.config.ts`'s
`test/**/*.test.ts` include, so `pnpm test` runs it, and
`.github/workflows/ci-control-service.yml` runs `pnpm test` (along with
lint/typecheck/build) on every pull request and push touching
`control-service/**`. No separate scheduler, cron, or workflow was added
- the existing CI gate for this package is the release gate; a guardrail
violation fails that job exactly like any other failing unit test.

## Scope and simplifications (read before extending)

- **No-overtake is corridor-wide, not per-segment.** Vehicles are
  processed in terminal-dispatch order and keep that relative order for
  the whole route-direction (`minSeparationSeconds` clamp in `engine.ts`),
  rather than modeling specific no-overtake segments vs. passing zones.
  Sufficient for headway/bunching KPIs on a single route-direction; not a
  general traffic simulation.
- **Single route-direction per run.** Corridor/shared-trunk interaction
  across multiple route-directions (leader-follower ordering across
  routes, per `state-estimation/ordering.ts`) is out of scope for this
  engine; it operates on one `RouteDirectionDefinition` at a time.
  Extending to multi-route-direction corridors is a natural follow-up,
  not attempted here.
- **Breakdown is not modeled as a distinct disturbance.** The AC's
  required regression set (demand burst, missed trip, GPS dropout,
  non-compliance) is implemented; the blueprint additionally mentions
  breakdown, red/green splits, and link blockages as further simulation
  tests (`docs/Olympuss_AI_UPSRTC_Bus_Bunching_Technical_Blueprint.md`
  line 889) - those are natural additions to `scenarios/` later, following
  the same `Disturbance` pattern, but are not part of this ticket's
  required set.
- **Calibration is a follow-up, not this ticket.** The link/dwell
  distributions in `fixtures/sampleRouteDirection.ts` and
  `fixtures/historicalDay.ts` are hand-authored, not fit from real AVL/APC
  data (none is available in this repo yet). "Calibrated" per the
  blueprint's phrase "calibrated event-based or mesoscopic simulator"
  will require replacing these fixtures with parameters fit to real
  historical data before any live-control tuning decision is made from
  simulator output - the mechanism (recorded-inputs replay) is in place,
  the calibration itself is not.
