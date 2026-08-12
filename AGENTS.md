# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Layout

Two independent pnpm packages, each with its own `node_modules`/lockfile/test suite/db: the Next.js app at the repo root (`src/`), and `control-service/` (Express + Postgres/PostGIS, deployed separately). Run `pnpm install` in both before `pnpm typecheck`/`pnpm lint`/`pnpm test` work in either — root only covers the web app; `control-service/`'s suite mocks the DB per-test, no Postgres needed to run it.

The web app's suite is the opposite: `src/tests/unit/*Db.test.ts` prove the guarantees that live in SQL rather than TypeScript (keyset pagination not losing safety records, `ON CONFLICT` dedupe) and need a real `OPS_DATABASE_URL`. They skip when it is unset locally and hard-FAIL when `CI=true` - `.github/workflows/ci-web.yml` gives its lint/typecheck/test job an `ops-db` service and runs `pnpm migrate:ops` against it, so nothing in `pnpm test` skips in CI. That guard exists because those files skipped on every CI run this repo had ever done, which made a green suite say nothing about the SQL it was supposed to be protecting; never "fix" a skip by relaxing it.

The web app's own datastore (`db/migrations/`, applied via `OPS_DATABASE_URL=... pnpm migrate:ops`) is separate from `control-service/db/` by design — see `docs/CONTROL_SERVICE_INTEGRATION.md` section 3 for why, `db/README.md` for the migration runner's guarantees (one transaction per file, checksum drift detection, idempotent `IF NOT EXISTS` SQL), and `control-service/src/config/env.ts` / `.env.example` for connection vars. Both Postgres instances in local dev are shared Docker containers another process may depend on — never assume you own them; prove a new migration idempotent against a scratch container, not the shared one.

## Ops RBAC: middleware is a ceiling, route guards are the decision

`src/middleware.ts` and every `/api/ops/*` route handler both check roles, independently — middleware's check (via `rolesForOpsApiPath` / `OPS_API_ROLE_OVERRIDES` in `src/lib/auth/rbac/roles.ts`) is a coarse, edge-safe approximation; `requireOpsRole(...)` inside the route handler (`src/lib/auth/rbac/guard.ts`) is the real, narrow, authoritative allowlist. When a route's `requireOpsRole` allowlist is wider than (or undeterminable from) its URL segment alone, add an entry to `OPS_API_ROLE_OVERRIDES` rather than loosening the segment-derived default — it is matched on exact pathname (never a prefix) and must only ever widen a segment's role, never re-home an endpoint to an unrelated one (enforced by a guard test in `src/tests/unit/rbac.test.ts`). Pages (`/ops/<segment>/*`) stay on strict segment equality; only `/api/ops/*` uses the override map.

## Command lifecycle: control-service is the only thing that delivers a command

A command goes `authorized` (on create/supersede) -> `delivered` -> `acknowledged`/`executing`/... . `control-service/src/commands/deliverAndNotify.ts` performs the `authorized -> delivered` transition (`deliverCommand`, `control-service/src/db/commands.ts`) AND awaits its `command.delivered` webhook together — used by `POST /v1/commands/:id/deliver`, the inline attempt after `POST /v1/commands/:id/supersede` commit, and the `commandDeliverySweep` backstop job. `POST /v1/commands` (create) is the one exception: it calls `deliverCommand` directly (still awaited — the response's `command`/`delivered` fields must reflect the real outcome) but dispatches its webhooks via `notifyWithoutWaiting`, deliberately NOT awaited. Reason: `dispatchWebhook`'s own worst case (`MAX_ATTEMPTS` retries x its request timeout, plus backoff, ~15.75s) exceeded the web client's 8s timeout (`src/lib/controlService/client.ts`) even though the command had already committed and delivered — proven live to tell an operator "the approval was not consumed and can be re-issued" while the driver already had the instruction on screen. Every call site builds the `command.delivered` event via the shared `buildDeliveredWebhookEvent` helper (same file) so the idempotency key format (`${id}:delivered:v${version}`) never drifts between them, awaited or not. Never add another code path that flips a command to `delivered` directly, and never add a response path that awaits `dispatchWebhook` against a caller with a tight timeout.
`authorized` is the state a *failed* delivery rests in by design (not an error state) — see `control-service/src/db/commands.ts#createCommand`'s doc comment for why inserting directly as `delivered` was rejected.

## E2E testing convention: don't give a spec the REST client it's proving doesn't need to exist

`tests/e2e/control-room-command-delivery.spec.ts` asserts control-service's own state by reading `pg` directly via `E2E_CONTROL_SERVICE_DATABASE_URL`, and is structurally incapable of constructing a control-service REST client — see its file header for the incident this convention prevents (a sibling spec's REST-backed fixture helper stayed green while the real create -> deliver product path was silently broken end to end). `tests/e2e/pilot-driver-command.spec.ts` is that sibling and is NOT held to this convention: it does construct one (`controlServiceFetch`), because no REST endpoint anywhere in this repo creates a `dispatcher_actions` approval or a `vehicles` row for it to seed through instead — see that spec's own file header. When a spec exists specifically to prove a product code path works end-to-end (not just to seed fixtures) — that is `control-room-command-delivery.spec.ts`'s job, not the pilot-driver spec's — keep it structurally incapable of reaching the backend endpoint(s) that path is supposed to reach. Shared fixture helpers (route-direction/vehicle seeding, pilot-driver vehicle assignment) live in `tests/e2e/fixtures/`.
Both specs require a live control-service + web app + seeded ops accounts (dispatcher/control_room/pilot_driver) and skip locally when their `E2E_*` env vars are unset; `.github/workflows/ci-web.yml` provisions all of it (all three accounts, all `E2E_*` vars, both specs run by name in one job) and sets `CI=true`, which turns a missing var into a hard failure instead of a skip.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
