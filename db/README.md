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
(`CREATE ... IF NOT EXISTS`), safe to re-run. Apply them in filename order
against a Postgres 13+ instance:

```sh
psql "$OPS_DATABASE_URL" -f migrations/20260805210000__ops_rbac.sql
```

No migration runner is wired up yet (same open item as
`control-service/README.md` — a separate infra decision). `OPS_DATABASE_URL`
is read by `src/lib/db/pool.ts` at runtime; nothing in `src/` falls back to an
in-memory store if it is unset, so every ops route fails closed (503) rather
than silently running without persistence.

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
