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

This directory is schema-only for now.
The control service's own runtime (ingestion, state estimation, detection,
command dispatch) is a separate, not-yet-built system; provisioning,
hosting, and a migration-runner choice for it are out of scope for this
ticket (see section 6 of the integration contract — "PostGIS hosting
choice ... an infra decision for the ticket that provisions the control
service's datastore").

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
