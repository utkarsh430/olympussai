# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Layout

Two independent pnpm packages, each with its own `node_modules`/lockfile/test suite/db: the Next.js app at the repo root (`src/`), and `control-service/` (Express + Postgres/PostGIS, deployed separately). Run `pnpm install` in both before `pnpm typecheck`/`pnpm lint`/`pnpm test` work in either — root only covers the web app; `control-service/`'s suite mocks the DB per-test, no Postgres needed to run it.

The web app's suite is the opposite: `src/tests/unit/*Db.test.ts` prove the guarantees that live in SQL rather than TypeScript (keyset pagination not losing safety records, `ON CONFLICT` dedupe) and need a real `OPS_DATABASE_URL`. They skip when it is unset locally and hard-FAIL when `CI=true` - `.github/workflows/ci-web.yml` gives its lint/typecheck/test job an `ops-db` service and runs `pnpm migrate:ops` against it, so nothing in `pnpm test` skips in CI. That guard exists because those files skipped on every CI run this repo had ever done, which made a green suite say nothing about the SQL it was supposed to be protecting; never "fix" a skip by relaxing it.

The web app's own datastore (`db/migrations/`, applied via `OPS_DATABASE_URL=... pnpm migrate:ops`) is separate from `control-service/db/` by design — see `docs/CONTROL_SERVICE_INTEGRATION.md` section 3 for why, `db/README.md` for the migration runner's guarantees (one transaction per file, checksum drift detection, idempotent `IF NOT EXISTS` SQL), and `control-service/src/config/env.ts` / `.env.example` for connection vars. Both Postgres instances in local dev are shared Docker containers another process may depend on — never assume you own them; prove a new migration idempotent against a scratch container, not the shared one.

## Local dev: run both halves, and boot them in order

The web app alone is not a working stack. Every ops dashboard reads control-service, and a missing one does not fail loudly — the consoles render "The control service did not answer, so this list is unknown - not empty", which reads like a data problem rather than a process nobody started. The root `dev` script (`scripts/dev.sh`) starts both halves, waits for both databases first, and tears the pair down together; `dev:web` / `dev:control` run one alone.

Waiting for the databases is the point of it. control-service rehydrates its in-memory state exactly once at boot and never retries (`control-service/src/index.ts`), so an instance started before its Postgres is reachable — or before `control-service/db/migrations/` is applied (`pnpm --dir control-service migrate` — its own runner, `control-service/src/db/migrate.ts`, with the same per-file-transaction and checksum-drift guarantees the web app's has) — parks at `/readyz` -> `rehydrationStatus: "failed"` permanently: ingestion fails closed, so it takes in nothing, while every read endpoint still answers 200 off the tables. It looks alive while the GPS pipeline is dead. So when a surface looks empty rather than wrong, read `/readyz` before suspecting the data — `/healthz` is liveness only and stays green throughout — and fix it by restarting the process, never by waiting for it to recover.

## Ops RBAC: middleware is a ceiling, route guards are the decision

`src/middleware.ts` and every `/api/ops/*` route handler both check roles, independently — middleware's check (via `rolesForOpsApiPath` / `OPS_API_ROLE_OVERRIDES` in `src/lib/auth/rbac/roles.ts`) is a coarse, edge-safe approximation; `requireOpsRole(...)` inside the route handler (`src/lib/auth/rbac/guard.ts`) is the real, narrow, authoritative allowlist. When a route's `requireOpsRole` allowlist is wider than (or undeterminable from) its URL segment alone, add an entry to `OPS_API_ROLE_OVERRIDES` rather than loosening the segment-derived default — it is matched on exact pathname (never a prefix) and must only ever widen a segment's role, never re-home an endpoint to an unrelated one (enforced by a guard test in `src/tests/unit/rbac.test.ts`). Pages (`/ops/<segment>/*`) stay on strict segment equality; only `/api/ops/*` uses the override map.

## Detection has two tiers, and they share one incident row

`headway/bunching.ts` holds both. The REACTIVE rule (`evaluateBunchingRule`) is an observation — k consecutive samples with `h_fwd/H*` under a threshold. The PREDICTIVE rule (`evaluatePredictiveRule`, fed by `headway/riskForecast.ts`) is an extrapolation — a least-squares fit of `h_fwd` against time, projected to a horizon derived from the corridor's own headway (`forecastHorizonSeconds`, ~1×H* bounded to 300–2700s; a fixed horizon makes the tier structurally silent on this network's 1800s median). Both write ONE `bunching_incidents` row per pair on one ladder (`types.ts#SEVERITY_RANK`: predicted < warning < bunched < severe), so a prediction that comes true escalates in place.

Three rules that are easy to get wrong and are each pinned by a test in `test/predictedIncidentLifecycle.test.ts`:
- A `predicted` incident must NEVER close on `rule.recovered`. Its gap never collapsed, so `recovered` is true from the moment it opens — wiring it that way shuts every prediction on the sweep that created it, and the failure is invisible (rows get written, logged, and vanish).
- A null risk is "the forecaster declined to speak", not "no risk". It must neither open nor close anything: a corridor whose GPS went quiet has not been observed to improve.
- Severity only moves UP. A calmer forecast must not de-escalate a measured `warning` back to `predicted`.

`headway_states.forecast_h_fwd_seconds` existed from the core data model and was NULL on every row ever written, because `insertHeadwaySample` never named it. It is now written from the risk fit.

## The alert inbox: absence of evidence is not an all-clear

`GET /v1/alerts` (network-wide, ranked worst-and-soonest-first in SQL — the ordering IS the triage) backs `/ops/control-room/alerts`. Before it, an incident reached a human only if somebody had already opened the console on that exact corridor, out of ~1,020.

The inbox distinguishes three states that a naive implementation collapses into one: nothing wrong / nothing read yet / feed unreadable. `src/lib/controlService/alerts.ts` serves the last good feed flagged `stale` rather than an empty list on an outage, because an empty alert list reads as an all-clear. `src/tests/unit/alertInbox.test.tsx` is where that rule is enforced — do not "simplify" those branches into one empty state.

Solving is deliberately NOT done on the list. A solve carries a 90s freshness verdict from the safety filter, so solving every corridor per render produces a page of silently-lapsed proposals. The operator asks per alert (`AlertSolutionPanel`), and issuing still goes through the console's approval path — never duplicated.

## Alighting-only: the one lever that fixes bunching by REMOVING delay

`mpc/boardingLimit.ts` proposes "let people off, take nobody on" on the LEADER of a bunched pair — note the inversion, every other law acts on the follower. In a bunch the leader absorbs all the demand, and its own long dwells are what drag it late and let the follower close; cutting its boarding dwell lets it recover while the follower collects who was left. It reuses the existing `boarding_limit` command type, so no new command vocabulary was needed — but that moved it out of the "instructions nothing generates" set, which the depot console and control-room console both derive by subtracting `ENGINE_ACTION_TYPES`. Both updated with no edit; that derivation is why.

Four guards, each of which a live solve proved necessary: at least as bunched as the corridor's own `bunchedThresholdRatio` (never a constant — a hardcoded 0.35 was *looser* than the 0.25 default, firing on pairs the corridor did not call bunched); an ABSOLUTE 240s cap on how long anyone waits (a ratio would permit 450s on a 1800s corridor); a 30s floor (a live solve produced a 0.675s "gap" — one position reported twice); and one proposal per vehicle (a live solve named the same bus three times, because `db/rehydrate.ts` keeps the latest sample per (leader, follower) across *all* history, so stale pairings survive until the first sweep).

It is proposed, never auto-selected, and its `objectiveCost` is 0 — unpriced, not free. Neither side of its trade can be priced: the cost needs lambda, the benefit needs a fitted dwell model. Zero is only safe because `solver.ts` excludes it from `safeMidRoute`; ranked, zero would sort FIRST.

## Never render a proxy-derived passenger count

`arrivalRatePaxPerSecond` returns `1/H*`, so any passenger figure derived from it lands between 0 and 1 whatever the corridor or hour — a live solve produced `0.0007`. That is an artefact, not an imprecise estimate. `BoardingLimitEstimate.leftBehindPassengers` is therefore `null` while `lambdaIsProxy`, so a surface *cannot* render "about 1 passenger" at a stop where forty people are waiting. Show `leftBehindWaitSeconds` instead — it is measured. Same rule applies to anything else derived from lambda.

## The occupancy switch, and why OFF is not the timid choice

`control_settings.weigh_occupancy` (network-wide singleton, `db/settings.ts`, `PUT /v1/settings`, toggled at `/ops/control-room/alerts`) gates the objective's in-vehicle term. It is enforced at `objective.ts#liveOnboardCount` — the one place that already answers "is there a load worth weighing?", so one check covers all four laws and none of them learns about the switch.

OFF the objective is exactly the operator's two stated priorities: even spacing, and the timetable delay bunching causes. ON is the dangerous direction, not the kind one — see the loaded-gun note below. The read is cached 10s, never caches a failure, and falls back to OFF: it sits on the solver's hot path, which had no database read before it, and a settings hiccup must not silence the controller network-wide.

The `predictiveAdvisory` deliberately ignores the switch — it decides nothing and exists to show what an occupancy-weighted ranking *would* say, which is the question the switch poses.

## The objective's lambda is a proxy, and it is a loaded gun

`mpc/objective.ts#arrivalRatePaxPerSecond` returns `1/H*`. Under that proxy the closed-form optimum's load penalty is `H*/2 seconds PER ONBOARD PASSENGER` — 900s on a 1800s corridor — so **a single passenger zeroes any hold**. That is inert today only because `vehicle_states.occupancy_count` is NULL everywhere; it becomes live the day occupancy is connected, and it fails silently (a controller proposing nothing looks like a network with no problems). `test/costOptimalAndSelection.test.ts` pins it as a tripwire.

This is why `cost_optimal_hold` (`mpc/costOptimalHold.ts`) is generated, scored and shown on every solve but is NOT selectable unless `COST_OPTIMAL_SELECTION_ENABLED=true`. It is the argmin of the very quantity candidates are ranked by, so letting it compete would replace the tuned Kf/Kb controller network-wide rather than add to it. Calibrate lambda from real boardings before flipping that flag.

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
