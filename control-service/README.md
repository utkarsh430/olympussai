# Control service datastore

This directory holds the schema for the **persistent control service's own
Postgres/PostGIS datastore** — the always-on bunching-detection/dispatch
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
under `src/` in this directory - see "Application runtime" below.
Ingestion and state estimation from live GPS feeds are a further, separate
piece of work; the runtime here consumes/produces the core-data-model
tables and exposes the REST/webhook surface, but does not itself run a
GPS ingestion pipeline yet.

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
- `control-service/Dockerfile` - multi-stage build referenced by
  `render.yaml` (`dockerfilePath: ./control-service/Dockerfile`).

## Applying migrations

Files under `db/migrations/` are plain, ordered, idempotent SQL
(`CREATE ... IF NOT EXISTS`), safe to re-run.
Apply them in filename order against a Postgres 14+ instance with the
`postgis` extension available, e.g.:

```sh
psql "$CONTROL_SERVICE_DATABASE_URL" -f db/migrations/20260805190000__core_data_model.sql
```

Any dedicated migration runner (dbmate, node-pg-migrate, Flyway, ...) can
adopt these files as-is later; none is wired up yet, since choosing one is
a separate, infra-level decision (tracked as an open item above) rather
than a data-model concern.

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
