# App datastore

This directory holds the schema for this Next.js app's **own** Postgres
datastore, first introduced by the multi-role RBAC ticket
(`docs/olympuss/RBAC.md`).

## Why this app now has a datastore

Before this ticket, `src/` had no database of its own — the pitch-demo PIN
auth (`docs/olympuss/AUTH.md`) needs no persistence beyond an env-var hash and
a signed cookie. Per-person accounts, admin invites and a server-side audit
trail do need one. `docs/CONTROL_SERVICE_INTEGRATION.md` §3 anticipates this:
"This app's own datastore (if/when one is introduced) is separate and is not
exposed to the control service except through the REST/webhook contract."
This directory is that datastore. It is wholly separate from
`control-service/db/`, which belongs to the independently-deployed control
service and which this app never connects to directly.

## Applying migrations

Files under `migrations/` are plain, ordered, idempotent SQL
(`CREATE ... IF NOT EXISTS`), safe to re-run. Apply them with the runner:

```sh
OPS_DATABASE_URL=postgres://... pnpm migrate:ops
```

`scripts/migrate-ops.mjs` applies every file not yet recorded in
`schema_migrations`, in **lexicographic filename order** (which the
`YYYYMMDDHHMMSS__name.sql` convention makes chronological order too). It
guarantees:

- **One transaction per file.** The file's SQL and its `schema_migrations`
  row commit together, so a half-applied migration is impossible. Each file
  wraps itself in `begin;`/`commit;` for historical psql use; the runner
  strips that outer pair and supplies the transaction itself, because
  Postgres does not nest transactions and the file's inner `commit` would
  otherwise commit the runner's transaction early.
- **A `pg_advisory_lock`** for the whole run, so two concurrent invocations
  serialize instead of racing.
- **Checksum drift detection.** Each file's sha256 is recorded; editing a
  migration that has already been applied anywhere aborts the run naming the
  file, rather than letting environments silently diverge. Add a new
  migration instead — that rule is not advisory any more, it is enforced.

A non-zero exit means nothing was left half-done. Applying a single file by
hand still works (`psql "$OPS_DATABASE_URL" -f migrations/....sql`) but skips
the `schema_migrations` bookkeeping, so prefer the runner.

`OPS_DATABASE_URL` is read by `src/lib/db/pool.ts` at runtime; nothing in
`src/` falls back to an in-memory store if it is unset, so every ops route
fails closed (503) rather than silently running without persistence.

## Bootstrapping the first admin

Every `ops_users` row after the first is created by accepting an
`ops_invites` row issued by an existing admin — there is no self-service
signup, per this ticket's acceptance criteria ("admin-invite only"). The very
first admin has no inviter, so it is seeded directly against the database:

```sh
OPS_DATABASE_URL=... node scripts/seed-ops-admin.mjs --email you@example.com --name "Your Name"
```

The script prompts for a password on stdin (never as an argv, so it never
lands in shell history), hashes it with the same bcrypt cost factor as every
other ops password, and inserts the row directly. Run it once per
environment; it refuses to run if an admin already exists.

## Rollback

This is the first migration for this datastore — there is no production data
yet, so rollback is dropping the four tables listed at the top of the
migration file (in reverse dependency order: `ops_dispatcher_actions`,
`ops_audit_log`, then the `ops_users_invite_id_fkey` constraint, then
`ops_invites`, then `ops_users`) rather than a scripted `down` migration.
Once this schema has real data, future migrations must add new files rather
than editing this one, per the standing rule against hand-editing shipped
migrations.

## Contents

- `migrations/20260805210000__ops_rbac.sql` — `ops_users`, `ops_invites`,
  `ops_audit_log` (append-only, enforced by trigger), `ops_dispatcher_actions`
  (the logged human-approval record referenced by
  `docs/CONTROL_SERVICE_INTEGRATION.md` §1 as the future `dispatcherActionId`
  source).
- `migrations/20260806120000__ops_breakdown_reports.sql` — `ops_breakdown_reports`,
  the audited driver breakdown-report submission record.
- `migrations/20260806140000__ops_copilot.sql` — `ops_copilot_interactions`
  (append-only, enforced by trigger — every LLM prompt/response the
  incident-explanation/shift-report/NL-query copilot makes) and
  `ops_shift_report_drafts` (AI-drafted shift reports; a CHECK constraint
  makes a `saved`/`sent` row without a human `saved_by`/`sent_by` impossible
  at the database level). See `src/lib/copilot/`.
- `migrations/20260806160000__ops_approval_queue_and_kill_switches.sql` — the
  reject path on `ops_dispatcher_actions`, plus the `ops_kill_switches` table
  behind the control-room halt on new automatic commands.
- `migrations/20260806170000__ops_pilot_driver_role.sql`: adds the
  `pilot_driver` role to `ops_users`/`ops_invites`, a restricted cohort
  distinct from `driver` for the driver PWA command interface. (Originally
  timestamped `20260806160000`, colliding with the approval-queue migration
  above; renumbered once the runner made filename order load-bearing. The two
  touch disjoint objects — role CHECK constraints vs. `ops_dispatcher_actions`
  columns and a new table — so the renumber changes nothing semantically.)
- `migrations/20260806180000__ops_users_vehicle_assignment.sql`: adds
  `ops_users.vehicle_id` and `ops_invites.vehicle_id`, the admin-set
  driver/pilot_driver-to-vehicle assignment, set via
  `POST /api/ops/admin/users/:id/vehicle` (or at invite time) and read via
  `GET /api/ops/auth/session` (`vehicleId`). Its `comment on column
  ops_users.vehicle_id` is the **authoritative statement of how a null
  assignment must be treated**: command-carrying surfaces fail closed with
  `409 VEHICLE_NOT_ASSIGNED`, read-only convenience surfaces may fall back to
  a self-reported registration. Read it before adding a new read site.
- `migrations/20260808100000__ops_users_vehicle_id_index.sql`: the partial
  index `ops_users_vehicle_id_idx`, extracted from a duplicate
  `…200000__ops_users_vehicle_assignment.sql` that has been deleted — see
  that file's header for the full story.
