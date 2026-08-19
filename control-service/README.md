# Control service

This directory holds the **persistent control service's own
Postgres/PostGIS datastore** (schema under `db/`) and, as of the live
route-direction state estimation ticket, its first piece of application
code (`src/state-estimation/`) - the always-on bunching-detection/dispatch
system described in the technical blueprint
(`docs/Olympuss_AI_UPSRTC_Bus_Bunching_Technical_Blueprint.md`, section 5 and
section 12) and scoped by the accepted integration contract in
[`docs/CONTROL_SERVICE_INTEGRATION.md`](../docs/CONTROL_SERVICE_INTEGRATION.md).

## Why this lives outside `src/`

The integration contract (section 1, section 3) is explicit: the control
service is an independently deployed process that owns its own datastore.
The Next.js app in `src/` never connects to this database directly and
never holds write credentials to it.
It talks to the control service only over REST plus signed webhooks,
validated with the Zod schemas in `src/models/control.ts`.
Nothing under `control-service/` is imported by the Next.js app, and
nothing in `src/` should ever gain a Postgres connection string for this
database.
That boundary is load-bearing: see section 1 of the integration contract
for the rejected alternative (shared DB) and why it was rejected.

The application runtime (Node/TS, Express REST + signed-webhook API, MPC
solver, on-boot state rehydration, `/healthz` + `/readyz`, Sentry) lives
under `src/` in this directory - see "Application runtime" below. It now
also has a real, tested state-estimation library (`src/state-estimation/`)
implementing map matching, trip/direction confidence scoring, Kalman
smoothing, stop-state classification, and leader-follower ordering - see
"Application code" below. The runtime consumes/produces the
core-data-model tables and exposes the REST/webhook surface; wiring the
state-estimation library's `processPositionEvent()` into a live GPS
ingestion endpoint is a further, separate piece of work - `src/index.ts`
re-exports `StateEstimationService` for that purpose, but the runtime does
not call it yet.

Hosting, CI/CD, staging/pilot environments, health checks, dashboards and
alerting are decided in
[`docs/CONTROL_SERVICE_DEPLOYMENT.md`](../docs/CONTROL_SERVICE_DEPLOYMENT.md)
(Render, `render.yaml` in this directory). The application scaffold that
doc's "Blocker" section was waiting on now exists (`package.json`,
`Dockerfile`, health/readiness handlers); connecting `render.yaml` to a
live Render account/team and setting the `sync: false` secrets is the
remaining step to go live - see that doc's "Blocker" section for the
up-to-date status.

## Application runtime

`src/` is a standalone Node/TypeScript service (pnpm, Express, `pg`,
Zod, `@sentry/node`) - not part of the Next.js app's build. It is its own
deployable with its own `package.json`, lockfile and lifecycle, matching
the boundary described in `docs/CONTROL_SERVICE_INTEGRATION.md` section 1.

```sh
cd control-service
pnpm install
cp .env.example .env.local   # fill in CONTROL_SERVICE_DATABASE_URL etc.
pnpm dev                     # tsx watch, local dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Key pieces:

- `GET /healthz` / `GET /readyz` - liveness/readiness, exact contract in
  `docs/CONTROL_SERVICE_DEPLOYMENT.md` "Health/readiness contract".
- `POST /v1/commands` - service-token authenticated; enforces the
  `dispatcherActionId` non-negotiable from
  `docs/CONTROL_SERVICE_INTEGRATION.md` section 1 (both at the request
  layer and, as the actual source of truth, via the
  `consume_dispatcher_action` DB trigger), then dispatches an HMAC-signed
  webhook back to the web app.
- `GET /v1/vehicle-states`, `POST /v1/mpc/solve` - service-token
  authenticated reads/compute against the in-memory state rehydrated on
  boot from `vehicle_states` / `headway_states` / `route_policies`.
- `GET /v1/route-directions`, `POST /v1/route-directions/:id/headway/compute`,
  `GET /v1/incidents` (`src/headway/`) - service-token authenticated
  time-domain headway/EWT/CV metrics and reactive bunching detection
  (blueprint 7.1-7.3). Unlike the two reads above, these query
  `vehicle_states` / `route_policies` directly on every call rather than the
  in-memory store, since nothing currently refreshes that store between
  boot and the not-yet-built GPS ingestion endpoint (see "Application code"
  below) - see `src/headway/repository.ts`'s file comment. The compute
  endpoint is detection-and-display only: it never creates a `commands` row
  or calls the MPC solver.
- `control-service/Dockerfile` - multi-stage build referenced by
  `render.yaml` (`dockerfilePath: ./control-service/Dockerfile`).

## Application code

`src/state-estimation/` is a self-contained TypeScript library (no HTTP
dependency of its own) that computes, per position event, a vehicle's
distance-along-route, matched route-direction with a scored confidence,
smoothed speed (via a Kalman filter whose state persists across restarts),
and stop-state classification, plus leader-follower ordering per
route-direction (including terminal wrap-around for loop routes and
shared-trunk/corridor ordering). See the module's own file-level comments
for the design, and `tests/` for coverage (`pnpm test` from this
directory). `src/index.ts` re-exports `StateEstimationService` from it;
wiring that into the HTTP runtime above (calling `rehydrate()` once at
startup, gating `/readyz` on completion, then calling
`processPositionEvent()` per incoming GPS fix) is the remaining
integration step, tracked separately from this library's own tests.

`src/headway/` computes time-domain forward/backward headway, the
route-direction-wide CV/EWT aggregate, and the reactive bunching rule
(blueprint 7.1-7.3): `metrics.ts` is pure math (gap → hFwd/hBwd → CV/EWT,
no I/O), `bunching.ts` is the pure k-consecutive-samples reactive rule,
`repository.ts` is the Postgres access, and `service.ts` orchestrates one
compute cycle for a route-direction - load live state, order
leader/follower (reusing `state-estimation/ordering.ts`), compute and
persist one `headway_states` row per pair, then open/escalate/close
`bunching_incidents` as the rule dictates. Never creates a `commands` row.

Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
from this directory to verify. These are exactly the steps
`.github/workflows/ci-control-service.yml` runs in CI.

## Decision engine (`src/mpc/`, `src/tsp/`)

`POST /v1/mpc/solve` (`src/mpc/solver.ts`) runs the control hierarchy from
blueprint section 8 against the in-memory state for one route-direction:

- `terminalDispatch.ts` - Algorithm A, terminal dispatch regulation
  (8.2): the default first line for a vehicle dwelling at the
  route-direction's origin terminal (`route_direction_stops` sequence 0,
  loaded into `stateStore` on rehydrate).
- `twoWayHold.ts` / `selfEqualizing.ts` - Algorithms B/C (8.3/8.4), exactly
  the Appendix A formulas. Self-equalizing only fires for a pair two-way
  couldn't cover (missing Kf/Kb or backward headway) - it is a fallback,
  not a second opinion on the same pair. Both take `h_bwd` to mean the gap
  to the vehicle BEHIND the one being held, which is what makes two-way
  holding two-way; a linear route-direction's back-most vehicle has no such
  gap and is therefore self-equalizing's, by design.
- `objective.ts` - the passenger-and-operator cost every candidate is
  ranked by (9.1 step 6), quadratic in headway and charged against the live
  onboard count. It also carries the closed-form cost-minimising hold and
  the one-sentence rationale each candidate ships with. Read its header
  before changing how candidates are ordered.
- `safety.ts` - the hard safety filter (9.1 step 5): rejects a candidate
  computed from stale state, one that breaches the policy's max-hold cap,
  or one whose vehicle already has a conflicting active command
  (`listActiveVehicleIds` in `src/db/commands.ts`). Rejections are
  returned (not dropped) on `rejectedCandidates` for auditability.
- `occupancyMpc.ts` - Algorithm E (8.6), an occupancy-weighted re-score of
  the safety-filtered candidates against the Appendix A wait/onboard cost
  terms. Returned as `predictiveAdvisory`, always `label: 'PREDICTIVE'` -
  advisory only, never the source of `selectedActionType` (matches the
  blueprint's phasing: MPC follows the simulator/command workflow, it
  doesn't replace the deterministic controllers yet).

`src/tsp/eligibility.ts` is the conditional Transit Signal Priority
eligibility stub from Appendix E Phase 5 / blueprint 8.7: a pure function
that decides whether a gapped bus with an authorized signal interface and
fresh state qualifies, and if so computes the request payload it would
carry. It never makes a network call - wiring an actual signal-interface
adapter is separate, tracked work. `test/tspEligibility.test.ts` is its
regression suite and must stay green before any future ticket connects it
to a live interface.

## Simulator (historical replay & regression suite)

`src/simulation/` is a calibrated event-based/mesoscopic simulator
(blueprint section 11.1, "Mesoscopic simulator - non-negotiable"):
historical-day replay, a pluggable controller interface for no-control
vs. controlled comparison, and a regression scenario library (demand
burst, missed trip, GPS dropout, non-compliance) that runs as part of
this package's normal `pnpm test` - i.e. the existing CI gate above. It
has no dependency on `../db`, `../state`, `../routes`, `../webhooks`, or
`../mpc`, so it never writes production data and never touches the live
command path; see
[`docs/CONTROL_SERVICE_SIMULATOR.md`](../docs/CONTROL_SERVICE_SIMULATOR.md)
for the full design, the documented replay-reproduction tolerance, and
known simplifications. It is intentionally NOT re-exported from
`src/index.ts` (importing that file starts the live HTTP server) - import
from `src/simulation/index.ts` directly.

## Applying migrations

Files under `db/migrations/` are plain, ordered, idempotent SQL
(`CREATE ... IF NOT EXISTS`), safe to re-run, applied against a Postgres 14+
instance with the `postgis` extension available. Apply them with the runner:

```sh
CONTROL_SERVICE_DATABASE_URL=postgres://... pnpm migrate
```

`src/db/migrate.ts` applies every file not yet recorded in
`schema_migrations`, in **lexicographic filename order** (which the
`YYYYMMDDHHMMSS__name.sql` convention makes chronological order too). It
guarantees:

- **One transaction per file.** The file's SQL and its `schema_migrations`
  row commit together, so a half-applied migration is impossible. Each file
  wraps itself in `begin;`/`commit;` for historical psql use; the runner
  strips that outer pair and supplies the transaction itself, because
  Postgres does not nest transactions and the file's inner `commit` would
  otherwise commit the runner's transaction early. See the long-form
  rationale on `stripOuterTransaction` in that file.
- **A `pg_advisory_lock`** for the whole run — two Render instances booting
  simultaneously serialize instead of racing.
- **Checksum drift detection.** Each file's sha256 is recorded; editing a
  migration that has already been applied anywhere aborts the run naming the
  file, rather than letting environments silently diverge. Add a new
  migration instead — that rule is now enforced, not just documented.

A non-zero exit means nothing was left half-done. Applying a single file by
hand still works (`psql "$CONTROL_SERVICE_DATABASE_URL" -f db/migrations/....sql`)
but skips the `schema_migrations` bookkeeping, so prefer the runner.

**In deployment** this runs as `render.yaml`'s `preDeployCommand` on both
services, so the schema is never behind the code that queries it. The hook
invokes `node dist/db/migrate.js`, not `pnpm migrate`: the runtime image
(`Dockerfile`) ships only `dist/` plus production `node_modules` and never
enables corepack, so neither `tsx` (a devDependency) nor `pnpm` exists there.
`src/db/migrate.ts` is inside `tsconfig.build.json`'s `include`, so it
compiles to `dist/db/migrate.js` as part of the normal build, and the
Dockerfile copies `db/` into the image because the runner reads those `.sql`
files at runtime.

The web app's own datastore has a separate, equivalent runner
(`scripts/migrate-ops.mjs`, `pnpm migrate:ops` at the repo root) against
`OPS_DATABASE_URL`. The two datastores stay isolated — this one never runs
against that database or vice versa
(`docs/CONTROL_SERVICE_INTEGRATION.md` §3).

## Rollback

This is the first migration for this datastore — there is no production
data yet, so rollback is `DROP SCHEMA public CASCADE; CREATE SCHEMA
public;` (or dropping the individual `CREATE TABLE` objects listed at the
top of the migration file) rather than a scripted `down` migration.
Once this schema has real data, future migrations must add new files
rather than editing this one, per the standing rule against hand-editing
shipped migrations.

## Contents

- `db/migrations/20260805190000__core_data_model.sql` — route / route
  shape / stop / control point, trip / block, vehicle and headway state,
  bunching incident, recommendation, command (with the `dispatcherActionId`
  authorization FK required by the integration contract), outcome, and
  per-route-direction policy configuration (thresholds, control points,
  hold caps — config, not code).
- `db/migrations/20260805210000__state_estimation.sql` - additive follow-up:
  loop/corridor-ordering columns on `route_directions`, and low-confidence
  flag / persisted Kalman filter state / stop-entry timestamp columns on
  `vehicle_states`, for `src/state-estimation/`.
- `src/state-estimation/` - the state estimation library described above.
- `src/simulation/` - the mesoscopic simulator, historical replay, and
  regression scenario library described in "Simulator" above and in
  `docs/CONTROL_SERVICE_SIMULATOR.md`.
