# Local development setup

How to run the full system — both the Next.js web app and the independent
`control-service` — on your own machine, against real local databases, with
no cloud accounts required for the operations surface (`/ops/*`).

This is the exact setup used to verify the system end-to-end during
development: real UPSRTC data, real map-matching, real bunching detection,
real MPC recommendations, real command approval/issue/ack.

## What you get without any cloud keys

`/ops/*` — the entire operations surface (driver, dispatcher, depot,
control-room, planner, admin, pilot-driver) — runs fully locally. It has its
own auth system (its own cookie, its own Postgres, its own session secret)
that has nothing to do with Supabase.

`/project/*` and `/login` (the original enterprise dashboard) need a
Supabase project and will 503 until one is configured. That is expected and
does not block anything under `/ops/*`.

## Prerequisites

- Node.js 20+ and `pnpm` (`corepack enable` will install the pinned version
  automatically — see `packageManager` in the root `package.json`)
- Docker Desktop (or another Docker Engine) — used only for the two
  Postgres databases. Neither the web app nor control-service runs in a
  container; both run as normal host processes via `pnpm dev`.

## 1. Clone and install

```sh
git clone <repo-url>
cd "Olympuss Unified App"
pnpm install
cd control-service && pnpm install && cd ..
```

Two independent packages, two independent installs — `control-service` is
excluded from the root `tsconfig.json` and has its own lockfile. There is no
workspace linking them.

## 2. Start the databases

```sh
docker compose up -d
```

This starts exactly two containers, defined in the root `docker-compose.yml`:

| Container | Image | Port | Why |
|---|---|---|---|
| `olympuss-control-db` | `postgis/postgis:16-3.4` | `55432` | control-service's own datastore. Must be PostGIS — the schema uses `geography(Point,4326)` / `geography(LineString,4326)` columns. |
| `olympuss-ops-db` | `postgres:16` | `55433` | The web app's own datastore (RBAC, audit log, approvals, breakdown reports). Plain Postgres — no geometry columns. |

Non-default ports (`55432`/`55433`) so this can run alongside any other
local Postgres on `5432` without a conflict. Data persists in named Docker
volumes across restarts; `docker compose down -v` wipes it.

Wait for both to report healthy:

```sh
docker compose ps
```

> **Apple Silicon note:** `postgis/postgis` only ships an `amd64` image, so
> Docker will emulate it. You'll see a platform-mismatch warning on first
> pull — harmless, just a one-time slower image pull.

## 3. Create your env files

Copy the examples and fill in the local values:

```sh
cp .env.example .env.local
cp control-service/.env.example control-service/.env.local
```

**Minimum required in `control-service/.env.local`** to boot the service at
all (everything else in that file has a working default):

```sh
CONTROL_SERVICE_DATABASE_URL=postgres://postgres:olympuss@127.0.0.1:55432/control_service
SERVICE_TOKEN_SECRET=<32+ random chars, e.g. `openssl rand -hex 32`>
WEBHOOK_HMAC_SECRET=<32+ random chars, e.g. `openssl rand -hex 32`>
```

**Minimum required in `.env.local`** for the `/ops/*` surface to work:

```sh
OPS_DATABASE_URL=postgres://postgres:olympuss@127.0.0.1:55433/ops
OPS_SESSION_SECRET=<32+ chars, e.g. `openssl rand -base64 48`>

# To see LIVE control-service data on the ops dashboards instead of the
# "control service unavailable" placeholder state — use the SAME value as
# control-service's SERVICE_TOKEN_SECRET above, byte-for-byte:
CONTROL_SERVICE_BASE_URL=http://127.0.0.1:8080
CONTROL_SERVICE_SERVICE_TOKEN=<same value as control-service's SERVICE_TOKEN_SECRET>

# To receive command-lifecycle webhooks (delivered/acknowledged/superseded)
# — use the SAME value as control-service's WEBHOOK_HMAC_SECRET, byte-for-byte:
CONTROL_SERVICE_WEBHOOK_SECRET=<same value as control-service's WEBHOOK_HMAC_SECRET>
```

`SERVICE_TOKEN_SECRET` / `CONTROL_SERVICE_SERVICE_TOKEN` are **one shared
secret used on both ends** — not a keypair. Same for `WEBHOOK_HMAC_SECRET` /
`CONTROL_SERVICE_WEBHOOK_SECRET`. A mismatch doesn't crash anything; it just
makes every call fail auth (401) or every webhook fail signature
verification (400, silently — the sender doesn't retry a 400).

Everything else in `.env.example` (Supabase, Google Maps, Anthropic, Resend,
Redis) is optional for local dev. Leaving it blank makes the corresponding
feature fail closed (a clear 503, never a crash, never a silent fallback) —
see each variable's comment in `.env.example` for exactly what depends on it.

## 4. Apply migrations

```sh
# control-service's own database
cd control-service
CONTROL_SERVICE_DATABASE_URL=postgres://postgres:olympuss@127.0.0.1:55432/control_service \
  pnpm migrate
cd ..

# the web app's own database
OPS_DATABASE_URL=postgres://postgres:olympuss@127.0.0.1:55433/ops \
  pnpm migrate:ops
```

Both runners are idempotent (safe to re-run) and record what they've
applied in a `schema_migrations` table in each database.

## 5. Seed the network (route geometry, stops, vehicles)

Control-service's route/shape/stop/vehicle tables start **empty**. Without
this step, every GPS fix will map-match to nothing (`off_route`), because
the map-matcher has no route geometry to match against.

```sh
cd control-service
CONTROL_SERVICE_DATABASE_URL=postgres://postgres:olympuss@127.0.0.1:55432/control_service \
SERVICE_TOKEN_SECRET=<your value> \
WEBHOOK_HMAC_SECRET=<your value> \
  pnpm seed --report=/tmp/seed-report.json
cd ..
```

This harvests real route geometry from the live UPSRTC feeds (no API key
needed — both endpoints are public). It takes several minutes for the full
network (~650 route-directions). Add `--limit=20` for a fast partial seed
while you're just getting the system running, or `--dry-run` to see what it
would do without writing anything.

> **Run this during Uttar Pradesh service hours.** The live feed only carries
> `routename` / `route` / `vehicle_journey_id` once buses have been assigned
> their duties for the day. Overnight IST the feed still returns ~9,000
> records with complete GPS, but **zero** of them carry a route — measured at
> 04:17 IST: `routename` populated on 0 / 9157 records. The seeder groups by
> route to plan its probes, so an overnight run harvests nothing. GPS
> ingestion is unaffected and works around the clock; it is only route
> *identity* that is diurnal.
>
> Two consequences worth knowing:
> - Target headway (H\*) derivation needs **several vehicles on the same
>   route**. A sparse sample gives ~1 vehicle per route and derives nothing,
>   so those routes fall back to a fabricated default. Seed from a busy
>   period, not a quiet one.
> - `--live-feed-file=<path>` lets you capture a good payload once and re-seed
>   from it later, which is both outage-proof and reproducible:
>   ```sh
>   curl -s https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php > live.json
>   pnpm seed --live-feed-file=live.json --report=/tmp/seed.json
>   ```

### Checking H\* calibration afterwards

A fabricated H\* is worse than a missing one: every threshold in
`src/headway/` is a ratio of it, so an affected route-direction is silently
excluded from bunching detection and its CV/EWT are meaningless. The seeder
prints a breakdown by `calibration_source` and warns loudly about the
fabricated ones. To audit at any time:

```sql
select calibration_source, count(*),
       round(min(target_headway_seconds)) as min_h,
       round(max(target_headway_seconds)) as max_h
  from route_policies where effective_to is null
 group by 1 order by 2 desc;
```

Read the `calibration_source` column as follows, best evidence first:

| value | meaning |
| --- | --- |
| `timetable` | Measured from `getStaticData.php`, the published departure board: the median gap between successive departures of this line-direction at one stop area. The endpoint serves 22 stops on the Lucknow–Raebareli–Prayagraj corridor and cannot be widened. |
| `od_timetable` | Measured from `getBusBetweenStops.php`, the statewide origin-destination schedule, swept over the ordered pairs of the published cities. Same estimator, bucketed by boarding stop. Real published schedule, statewide reach, coarser vantage point. |
| `none` | **No target exists.** Neither published source had an answer, so none was invented: `target_headway_seconds` carries the sentinel `1`, `loadActiveRoutePolicy` refuses the row, and the route-direction is observation-only. Detection is off *visibly*. |
| `journey_span` / `fleet_span` | The older vehicle-derived estimators. Only a `--no-timetable` run emits these. |
| `default` | **Fabricated** — not derived from anything. Treat as observation-only. |

Precedence is strict: `timetable` > `od_timetable` > `none`. A route-direction
that already has a corridor-timetable H\* is never overwritten by the coarser
source; the seeder reports `timetableDowngraded`, which must always be `0`.

A full OD sweep is a ~650-query prefix drill over `getStopAreaAndGroup.php`
(nothing publishes the city ids) plus 210 POSTs, all against a shared PHP host.
Capture it once and replay it:

```sh
pnpm seed --recalibrate-only --dry-run \
  --timetable-out=/tmp/tt.json --od-out=/tmp/od.json
pnpm seed --recalibrate-only \
  --timetable-file=/tmp/tt.json --od-file=/tmp/od.json
```

Every seeded route starts at rollout stage `observation` — detection runs,
but no command can be issued on it until an admin promotes it via
`/ops/admin/rollout-stages`. This is deliberate and fail-safe.

## 6. Create ops accounts

There is no self-service signup on `/ops/*` — every account is
admin-provisioned. Seed the first admin, then whichever operational roles
you want to log in as:

```sh
OPS_DATABASE_URL=postgres://postgres:olympuss@127.0.0.1:55433/ops \
  node scripts/seed-ops-admin.mjs --email admin@example.local --name "Local Admin"
# prompts for a password on stdin — never pass it as an argument

OPS_DATABASE_URL=postgres://postgres:olympuss@127.0.0.1:55433/ops \
OPS_SEED_PASSWORD='<a-password-you-choose>' \
  node scripts/seed-ops-user.mjs --email control.room@example.local --role control_room --name "Control Room"
```

Valid `--role` values: `driver`, `pilot_driver`, `dispatcher`, `depot`,
`control_room`, `planner`. (`seed-ops-user.mjs` deliberately refuses
`--role admin` — that's what `seed-ops-admin.mjs` is for, so a compromised
seed script can't mint a second admin.)

## 7. Run both services

Two terminals:

```sh
# terminal 1 — control-service
cd control-service
pnpm dev
```

```sh
# terminal 2 — web app
pnpm dev
```

Optional: set `GPS_POLL_ENABLED=true` in `control-service/.env.local` to
have the service poll the live UPSRTC feed itself every 30s and feed
positions through the same ingestion path a real deployment would use. Off
by default so it doesn't surprise you with background network activity and
~5s-per-poll load on first run.

## 8. Sign in

- **http://localhost:3000/ops/login** — the account(s) you seeded in step 6.
- **http://localhost:8080/healthz** — control-service liveness (always 200
  once the process is up).
- **http://localhost:8080/readyz** — control-service readiness. Returns
  `503 {"reason":"network_not_seeded"}` until step 5 has run; `200` once at
  least one route-direction has geometry.

## Running the pilot-driver E2E suite locally

`tests/e2e/pilot-driver-command.spec.ts` drives the whole command lifecycle
against both running services and both databases. It **skips** locally when
its env is unset (and hard-fails in CI, so it can never silently stop
running). To run it here, with both services up and an ops account seeded as
`pilot_driver` **with a `vehicle_id` assigned**:

```sh
E2E_ORIGIN=http://127.0.0.1:3000 \
E2E_PILOT_DRIVER_EMAIL=pilot@example.local \
E2E_PILOT_DRIVER_PASSWORD='<the password you seeded>' \
E2E_CONTROL_SERVICE_URL=http://127.0.0.1:8080 \
E2E_CONTROL_SERVICE_TOKEN='<control-service SERVICE_TOKEN_SECRET>' \
E2E_CONTROL_SERVICE_DATABASE_URL=postgres://postgres:olympuss@127.0.0.1:55432/control_service \
E2E_OPS_DATABASE_URL=postgres://postgres:olympuss@127.0.0.1:55433/ops \
  npx playwright test pilot-driver-command
```

> **Start control-service with `COMMAND_TTL_SWEEP_INTERVAL_MS=5000` for this
> run.** Two of the four tests assert that the periodic backstop sweep expires
> a short-TTL command within 30s. At the 30s production default the sweep may
> not tick inside the assertion window, so test 4 fails on timer alignment
> rather than on anything being wrong. CI sets the same value. This changes
> the sweep cadence, not what is being tested.

Note `pnpm test:e2e -- pilot-driver-command` does **not** filter — the `--`
is swallowed. Use `npx playwright test pilot-driver-command`.

## Everyday commands

```sh
docker compose up -d          # start the databases (idempotent)
docker compose down           # stop, keep all data
docker compose down -v        # stop and WIPE all data — re-run steps 4-6 after

pnpm test                     # web app test suite
cd control-service && pnpm test   # control-service test suite

pnpm build                    # production build check
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/ops/login` credentials "don't work" | You're actually on `/login` (Supabase auth) | `/ops/*` and `/login` are two completely separate auth systems. Use `/ops/login`. |
| Ops dashboards show a "control service unavailable" banner | `CONTROL_SERVICE_BASE_URL` / `CONTROL_SERVICE_SERVICE_TOKEN` unset, or the token doesn't match control-service's `SERVICE_TOKEN_SECRET` | Set both in `.env.local`, byte-for-byte matching. |
| `/readyz` stuck at 503 `network_not_seeded` | Step 5 hasn't run, or was run with a small `--limit` | Run `pnpm seed` (no limit) for the full network, or seed only the routes you need. |
| Live map-matching shows every vehicle as `off_route` | Same as above — no shape for that vehicle's route | Same fix. |
| `ECONNREFUSED` on either DB port | Containers not running, or removed | `docker compose up -d`; if data was lost, re-run steps 4-6. |
| "Live data is unavailable — Upstream returned malformed JSON" on `/ops/control-room`, with an empty fleet table | The **external** UPSRTC upstream is down or rate-limiting, not this app | Transient. Retry in a minute. The table stays empty on purpose — no placeholder vehicles are substituted. For local work without connectivity, set `ALLOW_FIXTURE_FALLBACK=1` in `.env.local` (off by default; never set it on a real deployment). |
