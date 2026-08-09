# Control Service — Hosting, CI/CD & Observability Plan

Status: **Infra decided, execution blocked on application scaffold.**
This resolves the infra half of the ticket "Provision persistent
control-service hosting with CI/CD and observability." It cannot be
executed end-to-end yet - see "Blocker" below - but every decision here
is final so the runtime ticket can build straight to this contract instead
of re-deciding platform/topology.

Related docs: `docs/CONTROL_SERVICE_INTEGRATION.md` (service boundary,
auth, failure isolation - accepted), `control-service/README.md`
(datastore scope), `docs/PRODUCTION_ROADMAP.md` (Phase 0 gate: no
production/pilot traffic without UPSRTC authorization, regardless of what
infra exists).

## Blocker (read this first)

`control-service/package.json` now exists: the live route-direction state
estimator (map matching, direction confidence, Kalman smoothing,
stop-state classification, leader-follower ordering - see
`src/state-estimation/`) is real, tested application code, not just SQL.
`ci-control-service.yml`'s scaffold-detection step now finds a
`package.json` and runs real lint/typecheck/test/build against it (all
four pass locally as of this change: 59 tests). What's still missing is
the piece that turns this into a deployable service: no server
entrypoint, no `Dockerfile`, no `/healthz` or `/readyz` handler, no MPC
solver, no REST ingestion endpoint or webhook layer. Nothing in
`control-service/src/` is wired to an HTTP listener yet - it is a library
waiting for that runtime to import it. `control-service/README.md` has
been updated to match.

Consequences for this ticket's acceptance criteria, stated plainly instead
of worked around:

- **"CI runs lint/typecheck/test/build ... for both codebases"** - done
  for the web app (`.github/workflows/ci-web.yml`, real, currently green)
  and now also enforced for real against `control-service/` (lint,
  typecheck, 59 unit tests, build all pass in CI as of this change) -
  though it only covers the state-estimation library so far, not an HTTP
  server, since that doesn't exist yet.
- **"Service deploys via CI/CD, rehydrates state from DB on restart,
  separate staging/pilot envs"** - topology decided and checked in
  (`control-service/render.yaml`), not live. There is nothing to deploy
  and no Render account/team connected to this repo yet.
- **"Health/readiness endpoint and dashboards for MPC/command latency and
  fallback-mode rate"** - endpoint contract specified below for the
  runtime ticket to implement; dashboards below describe panels against
  metrics that don't exist to query yet.
- **"Alerts fire on health-check failure or elevated latency; rollback
  documented"** - alert rules and rollback command are documented below
  and are mechanically ready (Render health checks + Sentry alert rules),
  but cannot be enabled against a service that Render has never deployed.

A follow-up ticket ("Build control-service application runtime") has been
filed to unblock this; see the comment on this ticket for its id. Once
that lands, executing this plan is: connect the Render blueprint, set the
`sync: false` secrets, push to `dev`/`main`, confirm the smoke test below,
and flip the two GitHub required-status-check boxes for
`ci-control-service` in branch protection (currently advisory only, since
a required check that can never pass would block all control-service
PRs).

## Platform choice: Render

Ticket named Render/Fly/Railway as acceptable options. Render, not Fly or
Railway:

- Native Blueprint (`render.yaml`) IaC checked into the repo, reviewed in
  the same PR as application code - matches this repo's existing
  convention of config-as-code over dashboard clicking.
- Managed Postgres with the `postgis` extension enabling
  (`CREATE EXTENSION IF NOT EXISTS postgis;`) available on standard plans,
  so the control service's own PostGIS datastore
  (`docs/CONTROL_SERVICE_INTEGRATION.md` section 3) doesn't need a
  separate DB vendor.
- Built-in HTTP health checks with automatic instance restart and
  deploy-time promotion gating (a new deploy that fails its health check
  never receives traffic) - directly satisfies "health/readiness
  endpoint" and "rollback" acceptance criteria without extra tooling.
- Zero-downtime rolling deploys and one-command rollback to any prior
  immutable deploy (see Rollback below).

This does not change anything about the Next.js web app's own hosting
(Vercel) - the two are independent deploys per
`docs/CONTROL_SERVICE_INTEGRATION.md` section 1 ("each service deploys,
migrates and scales independently").

## Environments

| Env | Render service (render.yaml) | Branch | DB | Purpose |
| --- | --- | --- | --- | --- |
| staging | `control-service-staging` | `dev` | `control-service-db-staging` (basic-256mb) | Every merge to `dev` auto-deploys here. Used for integration testing against the web app's staging/preview deploys. |
| pilot | `control-service-pilot` | `main` | `control-service-db-pilot` (basic-1gb, 2 instances) | Promoted via PR from `dev` to `main`. This is the Phase 1 pilot environment from `docs/PRODUCTION_ROADMAP.md` - real corridor traffic only after the Phase 0 authorization gate in that doc is satisfied, independent of infra readiness. |

No shared database between the two envs or between this service and the
web app's Supabase instance (`docs/CONTROL_SERVICE_INTEGRATION.md`
section 3).

## CI/CD pipeline

1. PR opened touching `control-service/**` -> `ci-control-service.yml`
   runs lint, typecheck, test, build (once scaffold exists).
2. PR opened touching web app paths -> `ci-web.yml` runs lint, typecheck,
   test, build. Both workflows are required status checks on `main` and
   `dev` (branch protection: Settings -> Branches -> require
   `ci-web / lint-typecheck-test-build` and, once unblocked,
   `ci-control-service / lint-typecheck-test-build`).
3. Merge to `dev` -> Render auto-deploys `control-service-staging` from
   the `Dockerfile` built in that PR.
4. Merge to `main` -> Render auto-deploys `control-service-pilot`.
5. On boot, the service must rehydrate in-memory MPC/headway state from
   `CONTROL_SERVICE_DATABASE_URL` (vehicle_states, headway state, active
   policy config tables from the core-data-model migration) before
   reporting `/readyz` healthy - this is what makes a restart safe under
   Render's rolling-deploy model instead of losing in-flight state.
   Render only routes traffic to an instance once `/readyz` returns 200,
   so a slow rehydration delays cutover instead of serving stale state.

### Migration order

Migrations apply before the new app revision receives traffic:
`control-service/db/migrations/*.sql` in lexicographic filename order,
idempotent (`CREATE ... IF NOT EXISTS`), run by the service's own migration
runner as `render.yaml`'s `preDeployCommand` on both services. Render runs
it before swapping traffic to the new instance; a non-zero exit aborts the
deploy and the previous instance keeps serving.

```yaml
preDeployCommand: node dist/db/migrate.js
```

`node dist/db/migrate.js` rather than `pnpm migrate` because the runtime
image ships only `dist/` plus production `node_modules` and never enables
corepack, so neither `tsx` (a devDependency) nor `pnpm` is present there;
see `control-service/README.md` "Applying migrations" for the full
rationale and the runner's guarantees (one transaction per file, advisory
lock, checksum-drift abort). The equivalent for the web app's own datastore
is `pnpm migrate:ops` (`scripts/migrate-ops.mjs`) against
`OPS_DATABASE_URL`.

### Smoke test (post-deploy, both envs)

```sh
curl -sf https://control-service-staging.onrender.com/healthz
curl -sf https://control-service-staging.onrender.com/readyz
# expect readyz to report state-rehydration-complete: true and a DB
# round-trip check, not just "process is up"
```

Render's own health check performs the equivalent of the first line
automatically pre/post every deploy; the second line is what CI's
post-deploy smoke-test step should call explicitly since `/readyz` is a
stronger claim than "process started."

### Rollback

Render keeps every deploy as an immutable, redeployable build. Rollback
is one command against the affected service, no rebuild:

```sh
render deploys list --service control-service-pilot   # find last-good deploy id
render deploys rollback --service control-service-pilot --deploy <deploy-id>
```

Same for `control-service-staging`. This is the documented rollback for
this ticket's acceptance criterion; no manual redeploy-from-source step is
needed or should be used ahead of the CLI rollback.

## Health/readiness contract (for the runtime ticket to implement)

- `GET /healthz` - liveness only: process is up, can serve HTTP. No DB
  call. Used by Render's health check for restart decisions.
- `GET /readyz` - readiness: DB reachable, state rehydration from
  `CONTROL_SERVICE_DATABASE_URL` complete. Used by Render to gate traffic
  cutover on deploy. Returns 503 (not 200) while rehydrating.

## Dashboards & metrics

Two metric sources, matching where each measurement actually happens per
`docs/CONTROL_SERVICE_INTEGRATION.md` section 2:

1. **Control-service side (MPC/command latency)** - Sentry Performance,
   separate Sentry project `control-service` (distinct DSN from the web
   app's project), release tagged with the git SHA on every Render deploy
   (`SENTRY_RELEASE` env var set from `RENDER_GIT_COMMIT`, a Render-
   provided build-time var). Custom spans the runtime ticket must emit:
   - `mpc.solve` - time to compute a hold/skip recommendation for one
     route-direction cycle.
   - `command.dispatch` - time from a dispatcher-approved command
     (carrying `dispatcherActionId`) to webhook delivery acknowledged by
     the web app.
   Dashboard: Sentry -> Performance -> project `control-service`,
   saved view "Control Service Latency" grouped by these two span names,
   p50/p95/p99.

2. **Web-app side (fallback-mode rate)** - this is measured where the
   fallback ladder actually lives: the Next.js app's outbound
   web -> control-service client
   (`docs/CONTROL_SERVICE_INTEGRATION.md` section 2, "fresh response ->
   last-known-good cached -> explicit unavailable"). The client (built by
   whichever backend ticket implements the REST call) must fire a PostHog
   event `control_service_fallback_engaged` with properties
   `{ routeDirectionId, fallbackTier: "cached" | "unavailable" }` each
   time it fails over. Dashboard: PostHog -> new dashboard
   "Control Service Health" -> insight "fallback rate" = count of
   `control_service_fallback_engaged` / count of all
   `control_service_call_attempted`, trended hourly, split by
   `fallbackTier`.

## Alerts

| Trigger | Rule | Route |
| --- | --- | --- |
| Health-check failure | Render native alert: `control-service-{staging,pilot}` health check fails 2 consecutive checks | Render -> Slack `#control-service-alerts` (Render's built-in notification integration, configured per-service in the Render dashboard, not in render.yaml) |
| Elevated MPC/command latency | Sentry alert rule on project `control-service`: p95(`mpc.solve` or `command.dispatch`) > 2s over a 5 min window | Slack `#control-service-alerts`, same channel as above so on-call sees both signal types together |
| Elevated error rate | Sentry alert rule: error rate > 5% over 5 min on project `control-service` | Slack `#control-service-alerts` |
| Elevated fallback rate | PostHog alert (or a scheduled check if PostHog alerting on insights isn't available on the current plan - fall back to a Sentry cron monitor that queries the PostHog API hourly): fallback rate > 10% over 1 hour for any route-direction | Slack `#control-service-alerts` |

On-call routing: same rotation that already owns web-app Sentry alerts
(no new rotation stood up by this ticket) - `#control-service-alerts` is a
new channel so control-service noise doesn't drown the existing web-app
alert channel, but pages the same people.

## Blast radius of this change

New files only, nothing destructive, no existing behavior changed:

- `.github/workflows/ci-web.yml` (new) - adds a required-check-eligible
  workflow; does not yet touch branch protection settings (that's a
  one-time GitHub Settings change to make outside this diff).
- `.github/workflows/ci-control-service.yml` (new) - scoped to
  `control-service/**` paths, no-ops safely until scaffold exists.
- `control-service/render.yaml` (new) - inert until connected to a Render
  account.
- `control-service/.env.example` (new) - documentation only, no secrets.
- `docs/CONTROL_SERVICE_DEPLOYMENT.md` (new, this file).
- `control-service/README.md` (updated) - links to this doc.

No production traffic, no existing service, no data affected.
