# Olympuss handover: setting it up, and operating it

This is the whole job, written for someone picking Olympuss up cold on a machine that has never run it.
It assumes no prior conversation, no tribal knowledge, and nobody available to ask.

Every command below was executed, in the order written, from a fresh `git clone` against empty databases created for the purpose.
Where a step needed correcting, it has been corrected here rather than worked around silently.
Where something could not be verified, it is marked **unverified** instead of asserted.
The verification log is [Appendix A](#appendix-a-what-was-actually-executed).

This document supersedes `docs/LOCAL_DEV_SETUP.md`, which is now a pointer to this file.

## Contents

- [1. What Olympuss is](#1-what-olympuss-is)
- [2. Two paths, and which one you are on](#2-two-paths-and-which-one-you-are-on)
- [3. Prerequisites](#3-prerequisites)
- [4. The two databases](#4-the-two-databases)
- [5. Environment files, variable by variable](#5-environment-files-variable-by-variable)
- [6. Migrations](#6-migrations)
- [7. Seeding the route network](#7-seeding-the-route-network)
- [8. The depot registry](#8-the-depot-registry)
- [9. Accounts: the first admin, and everyone after](#9-accounts-the-first-admin-and-everyone-after)
- [10. Running both services, and proving they are healthy](#10-running-both-services-and-proving-they-are-healthy)
- [11. Operating it: the consoles and who uses them](#11-operating-it-the-consoles-and-who-uses-them)
- [12. The honest-data vocabulary](#12-the-honest-data-vocabulary)
- [13. What the numbers mean, and what they do not](#13-what-the-numbers-mean-and-what-they-do-not)
- [14. The command path, end to end](#14-the-command-path-end-to-end)
- [15. Constraints an agent cannot see in the code](#15-constraints-an-agent-cannot-see-in-the-code)
- [16. Verification suites and their baselines](#16-verification-suites-and-their-baselines)
- [17. Known open issues](#17-known-open-issues)
- [Appendix A: what was actually executed](#appendix-a-what-was-actually-executed)

---

## 1. What Olympuss is

Olympuss is a bus-bunching detection and control system built over live Uttar Pradesh State Road Transport Corporation telemetry.
It is two independently deployable services plus two Postgres databases.

| Piece | What it is | Default port |
| --- | --- | --- |
| Web app | Next.js 15, repo root (`src/`). Serves the public landing page, the enterprise dashboards under `/project/*`, and the whole operations console under `/ops/*`. | 3000 |
| `control-service/` | Express + Postgres/PostGIS. Owns route geometry, map-matching, headway computation, bunching detection, and the command lifecycle. | 8080 |
| Control database | PostGIS. `control-service`'s own datastore. | 55432 |
| Ops database | Plain Postgres. The web app's own datastore: accounts, roles, audit log, approvals, breakdown reports. | 55433 |

The two databases are deliberately isolated and neither service reads the other's.
The reasoning is in [`CONTROL_SERVICE_INTEGRATION.md`](CONTROL_SERVICE_INTEGRATION.md) section 3, and it is a boundary, not an accident.
They talk over REST plus signed webhooks.

The product's governing commitment is that it never invents data.
That commitment is load-bearing in the code, in the seeder, and in the words on screen, and section 12 is the part of this document you must not skip.

## 2. Two paths, and which one you are on

**Path A: restore this exact system.**
You have the owner's credentials and want the same Supabase project, the same accounts, and the same data back on a new machine.
Follow every section, and in section 5 reuse the existing secret values rather than generating new ones.
The route network in section 7 has to be re-harvested regardless, because it is not in the repository.

**Path B: stand up a fresh instance.**
You have none of the owner's credentials and must obtain your own.
You will need to create, at minimum:

| What you must create | Where | What it is for | Required? |
| --- | --- | --- | --- |
| A Supabase project | supabase.com | The single sign-in front door for every human user. Gives you the project URL, the anon key, and the service-role key. | Yes, for any sign-in at all |
| A Google Maps JavaScript API key | Google Cloud Console | The fleet map. Restrict it by HTTP referrer and to the Maps JavaScript API only. | No; maps degrade visibly without it |
| A Claude subscription token | `claude setup-token` on the host | The control-room assistant. | No; the assistant returns a clean refusal without it |
| A Resend API key | resend.com | Delivering invite emails. Without it you copy invite links out of the admin console by hand. | No |
| An Upstash Redis endpoint | upstash.com | Shared rate limiting and circuit-breaker state across instances. | No; single-instance falls back to in-process counters |

Everything else is generated locally.
You cannot obtain the owner's Supabase project, so Path B always means a new one, and a new one always means creating your own first admin in section 9.

## 3. Prerequisites

Verified working on macOS on Apple Silicon with these versions:

| Tool | Version used | Requirement |
| --- | --- | --- |
| Node.js | 24.18.0 | `control-service/package.json` declares `>=20`. The web app does not declare one; 20+ is the practical floor. |
| pnpm | 10.29.3 | Pinned by `packageManager` in both `package.json` files. Run `corepack enable` and it installs the pinned version itself. |
| Docker | 29.6.1 | Only for the two databases. Neither service runs in a container. |
| `claude` CLI | 2.1.232 | Only for the control-room assistant. Everything else runs without it. |

Two independent pnpm packages, two independent installs.
There is no workspace linking them, and `control-service` is excluded from the root `tsconfig.json`.

```sh
git clone https://github.com/utkarsh430/olympussai.git
cd olympussai
git checkout integration/main   # NOT main - see section 15
pnpm install
cd control-service && pnpm install && cd ..
```

> The repository's default branch is `main`, but `main` is not where work lives.
> A plain `git clone` puts you on the wrong branch.
> Read section 15 before you commit anything.

**Apple Silicon note:** `postgis/postgis` publishes only an `amd64` image, so Docker emulates it and prints a platform-mismatch warning on first pull.
This is harmless and was confirmed harmless on this run.

## 4. The two databases

```sh
docker compose up -d
docker compose ps        # wait for both to report healthy
```

`docker-compose.yml` starts exactly two containers and nothing else:

| Container | Image | Host port | Why this image |
| --- | --- | --- | --- |
| `olympuss-control-db` | `postgis/postgis:16-3.4` | 55432 | **Must be PostGIS.** The schema uses `geography(Point,4326)` and `geography(LineString,4326)` columns, and the seeder calls `ST_MakeLine` and `ST_Length`. Plain `postgres:16` cannot run the migrations. |
| `olympuss-ops-db` | `postgres:16` | 55433 | Plain Postgres is correct here. The web app's own schema has no geometry columns. |

The ports are non-default on purpose so this can coexist with any other local Postgres on 5432.
Data persists in named Docker volumes; `docker compose down -v` wipes it and sends you back to section 6.

**If a machine is already running an Olympuss stack, do not reuse these ports.**
The container names and ports in `docker-compose.yml` are hardcoded, so a second stack needs its own compose file with different names and ports.
This matters more than it sounds: section 15 explains why pointing test tooling at port 55432 has already caused an incident.

## 5. Environment files, variable by variable

```sh
cp .env.example .env.local
cp control-service/.env.example control-service/.env.local
```

### The trap that has bitten more than one person

**`control-service` does not read `control-service/.env.local`.**

`control-service/src/index.ts` imports `dotenv/config`, and dotenv loads `.env` - never `.env.local`.
Nothing in the service sets `DOTENV_CONFIG_PATH` or loads that filename.
So the file the setup instructions tell you to create is silently ignored, and the service refuses to boot with a message naming variables you can plainly see in a file on disk.

It is worse for the command-line entrypoints.
`src/db/migrate.ts` and `src/seed/index.ts` do not import dotenv at all, so they read nothing from any file, ever.

The fix is to source the values into the shell before running anything in `control-service/`:

```sh
cd control-service
set -a; . ./.env.local; set +a
```

Do that in every shell where you run `pnpm migrate`, `pnpm seed`, or `pnpm dev` for the control service.
Naming the file `.env` instead works for `pnpm dev` only, and still leaves the migrate and seed commands broken, so sourcing is the answer that works everywhere.

**And then unset it before running the tests.**
Sourcing `.env.local` exports `REQUIRE_SEEDED_NETWORK=true`, which overrides the default the test suite relies on and fails one readiness test.
Run `pnpm test` from a shell that has not sourced the file. See section 16.

### `control-service/.env.local`

Three variables are required to boot at all.
Everything else has a working default.

| Variable | What it is for | Fails closed without it |
| --- | --- | --- |
| `CONTROL_SERVICE_DATABASE_URL` | This service's own PostGIS datastore. Never the web app's. | Refuses to start. |
| `SERVICE_TOKEN_SECRET` | The bearer token the web app presents on every REST call inbound to this service. **Minimum 16 characters**, and the migrate command validates it even though it never uses it. | Refuses to start. |
| `WEBHOOK_HMAC_SECRET` | The key this service signs outbound webhooks with. Minimum 16 characters. | Refuses to start. |
| `WEB_APP_WEBHOOK_URL` | Where to deliver signed command-lifecycle webhooks, i.e. `http://<web>/api/control-service/webhook`. | Optional. Unset means deliveries are skipped and logged, which looks like "nothing is happening" rather than an error. |
| `PORT` | Listen port. Defaults to 8080. | Optional. |
| `GPS_POLL_ENABLED` | Makes this instance poll the live UPSRTC feed every 30s and ingest through the same path a real deployment uses. | Optional, default `false`. Turn it on for exactly one instance, never several, or every replica ingests the same fixes. |
| `REQUIRE_SEEDED_NETWORK` | Makes `/readyz` return 503 until at least one route-direction has geometry. | Optional, default true outside tests. Leave it alone. |
| `SHAPE_CACHE_TTL_MS`, `HEADWAY_*`, `COMMAND_*` | Scheduler cadences. `HEADWAY_COMPUTE_INTERVAL_MS` multiplies time-to-first-detection directly. | Optional, all defaulted. |
| `SENTRY_DSN`, `LOG_LEVEL` | Error tracking and log verbosity. | Optional. |

Generate the two secrets with `openssl rand -hex 32`.

### `.env.local` (web app)

| Variable | What it is for | Fails closed without it |
| --- | --- | --- |
| `OPS_DATABASE_URL` | The web app's own Postgres. | The entire `/ops/*` surface is unusable. |
| `OPS_SESSION_SECRET` | HS256 signing secret for the legacy ops session cookie. Minimum 32 characters (`openssl rand -base64 48`). | The legacy sign-in door cannot mint a session. Still required while that door exists (section 17). |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. Public by design. | No sign-in at all. Everything behind the front door is unreachable. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key. Public by design, embedded in the browser bundle. Access control comes from Supabase Auth plus this app's own profile check, not from hiding it. | No sign-in at all. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only, bypasses row-level security, never prefixed `NEXT_PUBLIC_`.** Used to provision sign-in identities for invited operators and to write their role claim. | Invites cannot create accounts; role claims cannot be pushed. |
| `CONTROL_SERVICE_BASE_URL` | Where to reach `control-service`. | Ops dashboards show a "control service unavailable" state instead of live data. |
| `CONTROL_SERVICE_SERVICE_TOKEN` | **Byte-for-byte identical to `control-service`'s `SERVICE_TOKEN_SECRET`.** One shared secret on both ends, not a keypair. | A mismatch is not a crash; every call just fails auth with a 401. |
| `CONTROL_SERVICE_WEBHOOK_SECRET` | **Byte-for-byte identical to `control-service`'s `WEBHOOK_HMAC_SECRET`.** | A mismatch makes every webhook fail signature verification with a 400, which the sender does not retry, so every command lifecycle event is dropped silently. Unset is safer than wrong: unset answers 503, which is retryable. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | The fleet map. Not a secret; it is visible in browser JS by design. Secure it with Google Cloud referrer and API restrictions. | Maps degrade visibly. Nothing else breaks. |
| `CLAUDE_CODE_OAUTH_TOKEN` | The control-room assistant, authenticated by a **Claude subscription**, not a metered API key. Mint it with `claude setup-token` on the host. It expires; when it does you re-mint it. | The three assistant endpoints return `503 COPILOT_UNAVAILABLE`. They never fabricate an answer. |
| `CLAUDE_CLI_PATH` | Absolute path to the `claude` binary when it is not on `PATH`. | Optional. |
| `ANTHROPIC_MODEL` | Model id the assistant asks for. Defaults to `claude-sonnet-4-5`. | Optional. |
| `COPILOT_CLAUDE_TIMEOUT_MS` | Per-request assistant timeout, default 60000. | Optional. |
| `SITE_URL` | Canonical origin. | Optional locally. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Sending invite emails. | Optional. Without them you hand out invite links manually. |
| `REDIS_URL`, `REDIS_TOKEN` | Shared rate-limit and circuit-breaker state. `REDIS_URL` is the single activation switch. | Optional. Unset keeps per-process in-memory counters, which is correct for a single instance and inadequate for several. `REDIS_URL` set without `REDIS_TOKEN` is a misconfiguration, logged at error level, and falls back to in-memory. |
| `ALLOW_FIXTURE_FALLBACK` | Permission to substitute bundled fixture data when a live upstream call has failed. | Optional, default OFF. **Leave it unset on anything real.** Its whole purpose is to be off, so a failed call shows zero rows rather than demo buses that do not exist. |
| `NEXT_PUBLIC_DEMO_MODE` | Forces bundled fixtures and never calls upstream. For presentations without connectivity. | Optional, default off. |

**`ANTHROPIC_API_KEY` is deliberately not used.**
It is actively stripped from the assistant's subprocess environment, because the `claude` CLI gives an API key precedence over subscription credentials, and a stray key would silently move every assistant call onto per-token billing.
Do not set it.

## 6. Migrations

Both runners are idempotent, apply one transaction per file, and record a checksum per file so an edited migration aborts the run rather than silently diverging.

```sh
# control-service's own database - env MUST be in the shell (section 5)
cd control-service
set -a; . ./.env.local; set +a
pnpm migrate
cd ..

# the web app's own database
OPS_DATABASE_URL=postgres://postgres:olympuss@127.0.0.1:55433/ops pnpm migrate:ops
```

Expect 7 control-service migrations and 12 ops migrations on a fresh database.

> The published instructions for this step used to pass only `CONTROL_SERVICE_DATABASE_URL` on the command line.
> That fails: the migrate entrypoint loads the logger, which loads the full environment schema, which requires the two secrets as well.
> This is the corrected form.

## 7. Seeding the route network

`control-service` starts with empty route, shape, stop and vehicle tables.
Until this runs, every GPS fix map-matches to nothing and `/readyz` stays at 503 `network_not_seeded`.

```sh
cd control-service
set -a; . ./.env.local; set +a
pnpm seed --report=/tmp/seed-report.json
```

This harvests real route geometry from the public UPSRTC feeds.
No API key is needed; both endpoints are public.

### Run it during Uttar Pradesh service hours. This is the single most important operational fact in this document.

The live feed only carries `routename`, `route` and `vehicle_journey_id` once buses have been assigned their duties for the day.
Overnight the feed still returns roughly 9,000 records with complete GPS and **no route identity at all**, and the seeder groups by route to plan its probes, so an overnight run harvests almost nothing.
GPS ingestion is unaffected around the clock; it is only route *identity* that is diurnal.

Measured on this run, and it is not a binary switch but a ramp:

| Time (IST) | Records in feed | Carrying a route name | Source |
| --- | --- | --- | --- |
| 04:17 | 9,157 | 0 (0.0%) | earlier measurement, retained |
| 05:15 | 9,198 | 410 (4.5%) | measured during this run |

A seed started at either of those times harvests a rounding error.
**This is why the system sat at 7% coverage.**
Seed in the middle of the UPSRTC operating day, when the fleet is fully dutied.

The exact daily window in which the feed is richest is **unverified** - it was not observed across a full day during this run.
Treat "midday IST" as the working assumption and check `routename` population before committing to a long seed:

```sh
curl -s https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php > /tmp/live.json
python3 -c "import json;r=json.load(open('/tmp/live.json'));print(sum(1 for x in r if (x.get('routename') or '').strip()),'/',len(r))"
```

Capture a good payload once and re-seed from it later.
This is both outage-proof and reproducible, and it is how you avoid re-hammering a shared public PHP host:

```sh
pnpm seed --live-feed-file=/tmp/live.json --report=/tmp/seed.json
```

### `--limit` does not make the seed fast

`--limit=N` bounds the per-route schedule probes only.
The timetable fetch, the geography drill and the origin-destination sweep all run in full regardless.
Measured on this run with `--limit=8`, total wall time was 10 minutes 36 seconds, split:

| Phase | Time | Bounded by `--limit`? |
| --- | --- | --- |
| Timetable fetch and index | 12s | No |
| Geography index enumeration (650 queries) | 5m 33s | No |
| Origin-destination sweep (210 POSTs) | 4m 44s | No |
| Schedule probes | 8s | Yes |
| Persist | <1s | Yes |

So 97% of the run is independent of `--limit`.
Budget accordingly, and prefer `--recalibrate-only` with captured `--timetable-file` / `--od-file` payloads when you are iterating.

### What a good result looks like

The seeder prints a breakdown by `calibration_source`, and this is the number that matters.
A target headway is what every bunching threshold is a ratio of, so a fabricated one is worse than a missing one: it silently produces meaningless detection.

Audit at any time:

```sql
select calibration_source, count(*),
       round(min(target_headway_seconds)) as min_h,
       round(max(target_headway_seconds)) as max_h
  from route_policies where effective_to is null
 group by 1 order by 2 desc;
```

The reference full-network result, read from the running production instance:

| `calibration_source` | Count | Meaning |
| --- | --- | --- |
| `timetable` | 69 | Measured from the published departure board. Best evidence. |
| `od_timetable` | 129 | Measured from the statewide origin-destination schedule. Real published schedule, coarser vantage point. |
| `none` | 561 | **No target exists and none was invented.** Carries the sentinel `1`, the policy loader refuses the row, and the corridor is observation-only with detection visibly off. |
| `default` | **0** | Fabricated. Must stay zero. |
| **Total** | **759** | Corridors with geometry. |

So: **759 corridors, 198 of them with a measured target headway, zero fabricated.**
198 is 69 plus 129, and it is 26% of 759.

Precedence is strict: `timetable` beats `od_timetable` beats `none`.
The seeder reports `timetableDowngraded`, which must always be `0`.

Every seeded corridor starts at rollout stage `observation`.
Detection runs, but no command can be issued on it until an admin promotes it at `/ops/admin/rollout-stages`.
That is deliberate and fail-safe.

## 8. The depot registry

```sh
pnpm seed-ops-depots
```

This reads the live feed and populates the depot registry from the distinct depot names it finds.
It is **required before any depot-role account can be used at all**: a depot operator is scoped to their assigned depot, and until the registry holds that depot there is nothing to assign.
An unassigned depot operator is refused, never shown the statewide fleet.

Verified on this run: 9,198 vehicles read, 143 distinct depots, 0 vehicles with no usable depot, registry seeded to 143.
That matches the production instance exactly.

## 9. Accounts: the first admin, and everyone after

There is no self-service signup anywhere.
The first admin is created directly; every account after it is created by accepting an admin invite.

### Sign-in is one front door

`/login` is the single front door for both the enterprise dashboards and the operations console.
It routes each of the seven roles to its own dashboard on sign-in.

Signing in is not the same as being authorized.
Admission is decided against an **active, linked `ops_users` profile**, re-read from the database on every guarded request.
A valid Supabase session with no such profile reaches nothing and lands on a plain "no operations access" explanation.
That is not incidental: while the guards asked only "is there a session?", any stranger who registered with the Supabase project could open the command centre and read the entire live fleet feed.

`/ops/login` still exists and forwards to `/login`.
It must not be deleted yet; see section 17.

### The first admin

```sh
OPS_DATABASE_URL=postgres://... \
  node scripts/seed-ops-admin.mjs --email you@example.com --name "Your Name"
# prompts for a password on stdin with echo disabled, never as an argv
```

It refuses to run if an active admin already exists.
The password must be at least 12 characters.
A pipe that ends without delivering a line is treated as an error, not an empty password.

**For a real email address this creates the profile row but no Supabase sign-in identity, and that is correct.**
A real administrator's login is created deliberately, not by a script a pull request can run.
So you must then link one by hand:

```sh
# 1. create the Supabase Auth account
SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm run create-project-user -- --email you@example.com

# 2. link it to the ops profile
OPS_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm backfill-ops-links -- --email you@example.com --apply --actor-email you@example.com

# 3. push the role claim
```

Step 3 has no script.
The role claim (`app_metadata.ops_role`) is the ceiling the edge gate checks, and it is written by re-assigning the role the database already holds: `POST /api/ops/admin/users/<your ops user id>/role` with `{"role":"admin"}`.
Re-assigning an unchanged role is deliberately not a no-op.

There is a chicken-and-egg problem here and it is the easiest thing to get wrong.
That endpoint sits behind `/api/ops/*`, which the edge gate protects, and until your claim exists a Supabase-only session has no ceiling to pass it with.
So **make that call while signed in through the legacy door at `/ops/login?legacy=1`**, which is precisely why that escape hatch still exists.

Then prove both doors, in this order, and skip none of them:

1. In your normal browser, stay signed in at `/ops/login`. Do not sign out. This is your escape hatch.
2. In a private window, sign in at `/login` and confirm you reach your dashboard with admin access.
3. Back in the normal browser, confirm the old session still works.

If (2) fails, roll back your own link before touching anyone else's account.
The full procedure, including rollback, is [`olympuss/AUTH_CUTOVER_RUNBOOK.md`](olympuss/AUTH_CUTOVER_RUNBOOK.md).

> **Test identities are different, and easier.**
> An address inside the `*.qa@example.test` namespace gets its Supabase identity and role claim provisioned automatically by the same seed scripts, because CI needs that.
> The automation is confined to that namespace and refuses anything outside it, so a seed script can never reset a real person's password.
> Use `*.qa@example.test` for anything disposable, and clean up with `scripts/qa-identity-teardown.mjs`.

### Everyone after the first admin

Invites, from the admin console at `/ops/admin/invites`.
Accepting an invite creates the Supabase account and links it inside one transaction, so it cannot half-succeed into a spent invite with no account or an account with no profile.
Tokens are stored hashed, expire, are single-use under a row lock, and are limited to one live invite per email.
An address that already has a Supabase account is refused with `409 IDENTITY_ALREADY_EXISTS` rather than adopted, because adopting it would mean resetting a stranger's password to whatever was typed into the invite form.

Other roles can also be seeded directly for local work:

```sh
OPS_SEED_PASSWORD='...' node scripts/seed-ops-user.mjs \
  --email someone@example.com --role control_room --name "Name"
```

Valid roles: `driver`, `pilot_driver`, `dispatcher`, `depot`, `control_room`, `planner`.
This script deliberately refuses `--role admin`, so a compromised seed script cannot mint a second admin.

**Tell operators one thing:** after a role change they must sign out and sign in again.
The role rides in their token, and a token minted before the change disagrees with the database, which the guard refuses on purpose.

## 10. Running both services, and proving they are healthy

```sh
# terminal 1
cd control-service
set -a; . ./.env.local; set +a
pnpm dev

# terminal 2
pnpm dev
```

The web app reads `.env.local` itself; only `control-service` needs the sourcing.

**"Running" is not "healthy". Check all four of these.**

| Check | Healthy answer | What a bad answer means |
| --- | --- | --- |
| `curl localhost:8080/healthz` | `200` | Liveness only. It is 200 as soon as the process is up and proves nothing about data. |
| `curl localhost:8080/readyz` | `200` with `"status":"ready"` | `503 network_not_seeded` means section 7 has not run. This endpoint recomputes its counts on every call, so it is trustworthy after a re-seed without a restart. |
| `/readyz` body: `counts.routeDirectionsWithShape` | Non-zero, and the number you expect | This is the real coverage number. A low number after a full seed means you seeded outside service hours. |
| Sign in at `/login`, open a dashboard | Live data, no "control service unavailable" banner | That banner means `CONTROL_SERVICE_BASE_URL` or the shared token is wrong. A token mismatch is a 401, not a crash. |

A healthy `/readyz` body looks like this:

```json
{"status":"ready","stateRehydrationComplete":true,"dbReachable":true,
 "counts":{"vehicleStates":0,"routeDirectionsWithHeadway":0,"activePolicies":2,
           "routeDirectionsWithShape":6,"vehicles":9198}, ...}
```

Note `activePolicies: 2` against `routeDirectionsWithShape: 6` in that sample.
That gap is the honest-detection design working, not a fault: four of those six corridors have no measured target headway, so the policy loader refuses them and detection is visibly off for them.

## 11. Operating it: the consoles and who uses them

Seven roles, each with its own surface under `/ops/<role>`.
Four of them are the consoles rebuilt on the shared shell and are where nearly all real use happens.

| Console | Who uses it | What it is for |
| --- | --- | --- |
| `/ops/control-room` | Control room staff | The operational centre. Picks a corridor, shows its headway health, live fleet, detected bunching incidents, and the recommendations that can become instructions. Opens on a corridor that can actually report rather than a screen of dashes. |
| `/ops/depot` | Depot operators | One depot's own fleet, running order, and breakdown reports. Scoped to their depot and nothing else. |
| `/ops/driver` and `/ops/pilot-driver` | Drivers in the cab | Built for a phone, bilingual. The pilot-driver surface is the command console that receives and acknowledges instructions. Safety-critical; see section 15. |
| `/ops/admin` | Administrators | Accounts, invites, role assignment, the depot and network registries, and rollout stages. |

The other three: `/ops/dispatcher` approves recommendations before the control room can issue them, `/ops/planner` is the planning surface, and `/ops/forbidden` and `/ops/unavailable` are terminal explanation states.

**Roles are strict, and an admin is not a superuser.**
Role segments are matched on exact equality.
An admin signed in at `/ops/admin` who requests `/ops/control-room` is redirected to `/ops/forbidden`, and that was verified on this run.
If you need to see another console, sign in as an account holding that role.

## 12. The honest-data vocabulary

This is the product's central design commitment.
A reader who does not understand it will "fix" it into a lie.

Every upstream this console reads degrades the same way: it returns an empty array and a flag.
Render the array length straight into a tile and the console reports a calm, confident `0` during a total outage, which is the single most dangerous thing an operations display can do.

So a reading carries *why* it is empty, and the three whys are not interchangeable:

| State | On screen | Meaning |
| --- | --- | --- |
| `observed` | the number | The source answered and this is real. A `0` here is a fact an operator may act on. |
| `not-yet-computed` | a dash, `—` | The source answered and has nothing for this key yet. Real, benign, and **not a number**. |
| `unavailable` | `n/a` | The source did not answer. There is no value and the console says so rather than drawing a zero. |

The two non-observed states get visibly different glyphs, never a shared dash, because an operator scanning a strip during an incident has to tell "nothing has happened" from "I am blind" without reading the hint line underneath.
The tile renderer keys off the availability field, never off `value === null`, so the two can never collapse into the same glyph.

Verified on this run: a freshly seeded scratch instance with a reachable backend rendered 36 dashes and zero `n/a` on the control room, which is exactly right.
Nothing had been computed yet, and nothing was unreachable.

Related commitments that are part of the same rule:

- **Corridors marked "no detection."** A corridor with no measured target headway is labelled as such in the picker rather than shown with plausible-looking blank metrics. 561 of 759 corridors are in this state.
- **Arrival times carry a confidence band and a basis, or decline by name.** An arrival estimate says what it is derived from and how confident it is, and where it cannot be derived it declines explicitly instead of guessing.
- **The assistant never fabricates.** Every failure mode - missing credential, expired credential, CLI absent, timeout, empty response - returns `503 COPILOT_UNAVAILABLE`. There is deliberately no fallback path that produces text without a successful model call. Its citations are built directly from the evidence records handed to the model, never parsed out of the model's prose, so a citation cannot be hallucinated.
- **A failed upstream shows zero rows, not fixtures.** That is what `ALLOW_FIXTURE_FALLBACK` being off by default means.
- **Vocabulary is decided in one module** (`src/lib/ops/vocabulary.ts`) and asserted by tests. The rule is *simplify the vocabulary, never the meaning*: where a term is genuinely load-bearing and has no plain synonym, the term is kept and a gloss is attached, because renaming it would name a different statistic.

If you find yourself about to make a screen look more complete, stop.
The blankness is the feature.

## 13. What the numbers mean, and what they do not

**Coverage is corridors surveyed, not the whole network.**
759 is the count of route-directions that have geometry harvested into the database.
It is not the size of the UPSRTC network, and the network is not fully surveyed.

**A corridor is one route in one direction, and is deliberately never called a route.**
759 corridors are drawn from roughly 380 routes.
Calling a corridor a route halves every count the product prints.

**Detection requires a measured target headway, which only 198 of 759 corridors have.**
Every threshold in the headway engine is a ratio of the target headway.
Without one there is nothing to be a ratio of, so those 561 corridors are observation-only: positions are tracked, but bunching detection is off, visibly.
That is 26% detection coverage, and it is the honest number.

The main lever to raise it is not more seeding.
It is the geography drill, which currently finds only 15 cities out of the statewide index (141 truncated prefixes, 117 unexpanded, measured again on this run).
Widening that drill widens the origin-destination schedule sweep, which is where 129 of the 198 measured headways come from.
That is tracked as an open issue; see section 17.

**A `0` on a dashboard is only a fact if it is `observed`.** See section 12.

## 14. The command path, end to end

An instruction to a driver passes through three people and two services, and no step can be skipped.

1. **Detection.** `control-service` computes headway on eligible corridors, detects bunching, and raises an incident with a cause class and a controllability. Only corridors with a measured target headway are eligible.
2. **Recommendation.** The control room sees the incident and the recommended action (hold, short-turn, and so on) on `/ops/control-room`.
3. **Dispatcher approval.** A dispatcher must approve the action first. This creates a `dispatcher_actions` approval row. The control room cannot issue an instruction that has not been approved, and the corridor's rollout stage must permit commands at all - every corridor starts at `observation`, where none can be issued.
4. **Control room issues.** The control room consumes the approval and issues the command. `control-service` is the only thing that can create one.
5. **Delivery.** The command goes `authorized` then `delivered`. `control-service` performs that transition and dispatches a signed `command.delivered` webhook to the web app. A failed delivery rests at `authorized` by design, which is not an error state, and a backstop sweep retries it.
6. **The driver acknowledges.** The instruction appears on `/ops/pilot-driver` with a countdown and a reason. The driver acknowledges, and that acknowledgement is queued locally before any network call is attempted.
7. **Audit.** Every step is recorded in both systems, in append-only, trigger-protected tables.

Verified end to end on this run: dispatcher approval, control-room issue, delivery, and visibility on the driver console within one poll.

## 15. Constraints an agent cannot see in the code

### Branch posture

All work lands on **`integration/main`**.
`dev` and `main` are forbidden without the owner's explicit say-so.

The repository is **`utkarsh430/olympussai`**, and the captain is a collaborator, not the owner.
This has practical consequences: anything needing repository settings, GitHub Actions secrets, or branch protection changes needs the owner, and at least one open issue is blocked on exactly that.

`git clone` puts you on `main`, which is not where work lives.
Check out `integration/main` before doing anything.
Never force-push.
If a push is rejected, rebase and retry, because other agents work this repository in parallel and one landed a change during the writing of this document.

### Depot scoping is a security boundary

It is enforced server-side and fails closed.
It is not a client-side filter and must never become one.

Two properties carry the weight, and both are tested:

- Depot codes are normalized by exactly one function, used both when the registry is seeded and when a live vehicle is matched, so seeding and matching cannot drift apart.
- **A vehicle that matches no depot is owned by no depot.** It is not bucketed into whichever depot is asking, and there is no "everything" scope a depot caller can reach.

The normalization deliberately does not do fuzzy matching, transliteration, or punctuation stripping.
Suffixed names like `SAHARANPUR(A)` and `BAREILLY(R)` distinguish same-city depots, and the `ENFORCEMENT_*` entries are a separate operational fleet.
Collapsing any of those would grant one depot's operator another depot's vehicles, which is the one mistake this boundary must never make.

More broadly, on the ops RBAC surface: middleware is a coarse edge-safe **ceiling**, and the `requireOpsRole(...)` check inside each route handler is the real, narrow, authoritative decision.
Widen a route by adding an entry to the override map, never by loosening the segment default.

### The pilot-driver command console is safety-critical

Its guarantees must be proven by running them, not by reading them:

- An acknowledgement is queued locally, in IndexedDB, **before any network call is attempted**, and flushed when connectivity returns.
- Expiry is enforced on **both** sides. The console expires an instruction locally when its TTL lapses, and `control-service` marks it expired through its own periodic sweep even if nobody ever polls it.
- The audit trail is complete in both systems.
- One active command per vehicle.

All four were executed and passed during this run; see Appendix A.
To run them yourself, see section 16, and read the database warning there first because it will otherwise refuse.

### Both services must be deployed together

This is proven, not theoretical.

The web app's driver route screen polls a journey endpoint continuously.
Against a `control-service` that predated the arrivals route, that was a permanent stream of 404s.
Those 404s counted toward the failure streak of a circuit breaker that is **shared by every control-service consumer in the process**, so the breaker opened for everything, including the path a control room's instruction takes to reach a driver.
The driver's screen read "Could not reach the command service" while `control-service` was entirely healthy.

The code was hardened afterwards so that a returned 404 no longer counts as an outage signal, because an answer is not an outage.
But the deployment rule stands: **ship the web app and `control-service` together.**
A web app running against an older backend is a version-skew incident waiting to happen, and it has already broken the safety-critical path once.

### A test never observed to fail proves nothing

Two rules, both learned expensively here.

**A skipped suite is never a pass.**
The database-backed unit tests (`src/tests/unit/*Db.test.ts`) prove guarantees that live in SQL rather than TypeScript, such as keyset pagination not losing safety records.
They skip when `OPS_DATABASE_URL` is unset and **hard-fail when `CI=true`**.
That guard exists because those files skipped on every CI run this repository had ever done, which made a green suite say nothing about the SQL it was supposed to be protecting.
Never "fix" a skip by relaxing it.

**Do not give a spec the client it is proving does not need to exist.**
`tests/e2e/control-room-command-delivery.spec.ts` asserts control-service state by reading Postgres directly and is structurally incapable of constructing a REST client, because a sibling spec's REST-backed fixture helper once stayed green while the real create-then-deliver product path was silently broken end to end.

### `pnpm check:client-boundary`

This exists because a Server Component importing a *value* from a `'use client'` module is a 100% runtime failure that **typecheck, lint, build and unit tests all pass**.
The imported value is a client-reference proxy, not the thing it is declared as, and calling it throws at request time.
`tsc` sees a real function, `next build` never renders a `force-dynamic` page, and vitest has no boundary at all.

The same scan also runs inside `pnpm test`, so the rule survives a workflow edit.
Run it, and if it fires, move the shared value into a plain sibling module with no directive, or use `import type` if it is only ever a type.

### Fixture writes refuse to touch a real database

`scripts/lib/disposable-db.mjs` inspects what is actually **in** a database before anything writes fixtures to it, and refuses if it looks real.

- The ops database is disposable only if every `ops_users` row is inside the `*.qa@example.test` namespace, or the table does not exist yet.
- The control database is disposable only if at most 5 active route-directions carry a shape.

It is content-based rather than flag-based on purpose.
The failure mode it prevents is someone sourcing a CI job's environment and running its commands locally, which reproduces every "CI says this is safe" flag right along with the dangerous ports.
A flag that travels with the copy-paste is not a guard against the copy-paste.
There is no opt-out. Work with it.

Migrations are deliberately **not** guarded this way, because applying migrations is a normal part of a real deploy.

## 16. Verification suites and their baselines

Baselines measured at commit `d83f895` on `integration/main`.

| Suite | Command | Baseline |
| --- | --- | --- |
| Web unit, with a database | `OPS_DATABASE_URL=... pnpm test` | **1725 passed, 0 skipped** |
| Web unit, without a database | `pnpm test` | **1679 passed, 46 skipped** (1725 total) |
| control-service unit | `cd control-service && pnpm test` | **731 passed** |
| Web typecheck | `pnpm typecheck` | clean |
| Web lint | `pnpm lint` | clean (prints a `next lint` deprecation notice, which is expected) |
| Client boundary | `pnpm check:client-boundary` | clean |
| Production build | `pnpm build` | clean |
| control-service typecheck / lint | `cd control-service && pnpm typecheck && pnpm lint` | clean |

The 46 skips are the database-backed tests, and they are only acceptable locally.
In CI they hard-fail. A skipped suite is never a pass.

> **Run the control-service suite from a shell that has not sourced `control-service/.env.local`.**
> Sourcing it exports `REQUIRE_SEEDED_NETWORK=true`, which overrides the default the suite relies on, and one readiness test fails with 503 against an expected 200.
> This is a shell-environment artefact, not a real failure, and it cost time on this run before being identified.

### The end-to-end suites

```sh
E2E_BASE_URL=http://127.0.0.1:3000 E2E_ORIGIN=http://127.0.0.1:3000 \
E2E_PILOT_DRIVER_EMAIL=... E2E_PILOT_DRIVER_PASSWORD=... \
E2E_CONTROL_SERVICE_URL=http://127.0.0.1:8080 E2E_CONTROL_SERVICE_TOKEN=... \
E2E_CONTROL_SERVICE_DATABASE_URL=postgres://... \
E2E_OPS_DATABASE_URL=postgres://... \
  npx playwright test pilot-driver-command
```

Note `pnpm test:e2e -- pilot-driver-command` does **not** filter, because the `--` is swallowed.
Use `npx playwright test <name>`.

Start `control-service` with `COMMAND_TTL_SWEEP_INTERVAL_MS=5000` for this run.
Two of the four tests assert that the backstop sweep expires a short-TTL command within 30s, and at the 30s production default the sweep may not tick inside the assertion window, so a test fails on timer alignment rather than on anything being wrong.
CI sets the same value.

**The end-to-end suites need their own unseeded control-service database.**
This is not documented anywhere else and it will stop you.
The suite calls the disposable-database guard, and a control database with a seeded network has hundreds of shaped route-directions against a threshold of 5, so it refuses:

```
Refusing to write control-service fixtures into 127.0.0.1:55442/control_service:
it already has 6 active route-direction(s) carrying a route_shape - more than
the 5 a throwaway CI database should ever have.
```

Stand up a separate empty PostGIS container, migrate it, point `control-service` and `E2E_CONTROL_SERVICE_DATABASE_URL` at it, and run there.
That is what CI does.
The ops database does not need replacing as long as every account in it is in the `*.qa@example.test` namespace.

## 17. Known open issues

Genuinely open as of this document, summarised honestly.

**The legacy sign-in door cannot be deleted yet, and it is blocked on someone else.**
`/ops/login` still exists as a forwarder, and `/ops/login?legacy=1` still renders the old password form.
Deleting it is blocked on three Supabase secrets being added as GitHub Actions secrets to `utkarsh430/olympussai`, and the repository is owned by `utkarsh430`, not the captain, so it needs the owner's action.
Until then the system carries two doors into one account, and `OPS_SESSION_SECRET` remains a required variable.
The weaker door is neutralised for Supabase-managed accounts by a sentinel password hash the verifier refuses outright, so this is a cleanup debt rather than an open hole.

**GPS coordinate validation is not wired into the live ingest path.**
The validation exists, but `POST /v1/positions` does not reject null-island coordinates.
A vehicle reporting 0,0 will be ingested and map-matched against real geometry.

**The schedule geography drill only finds 15 cities.**
141 prefixes come back truncated and 117 unexpanded, re-measured during this run.
This is the main lever to raise detection above 26%, because widening the drill widens the origin-destination sweep that supplies 129 of the 198 measured target headways.
This is the highest-value open item for the product's core number.

**Inviting an address that already has an `ops_users` row returns a 500.**
It surfaces a raw unique-constraint error instead of a clean message.
Cosmetic, but it is on the admin's happy path.

### Resolved during the writing of this document

The control-room assistant's grounding payload could exceed the `claude` CLI's 10MB stdin cap, which meant a large evidence set produced a failure rather than an answer.
**This was fixed and landed on `integration/main` as `d83f895` while this document was being written**, by bounding the grounding evidence so the assembled prompt cannot exceed the cap.
The baselines in section 16 are measured at that commit and include its new tests.

---

## Appendix A: what was actually executed

This document was verified by executing it from a fresh clone against databases created for the purpose, on isolated ports, with the production instance left untouched throughout.

**Worked first time:** the clone and both installs; `docker compose` bringing up both databases; the ops migrations; the network seed from a captured feed; the depot registry seed; the first-admin seed; both services starting; the single front door authenticating and routing by role; all four dashboards resolving correctly with role scoping enforced; typecheck, lint, client-boundary and build on both packages; both unit suites; and both end-to-end suites.

**Needed correcting, and the correction is in the document:**

1. **The published migrate command failed.** It passed only the database URL, but the entrypoint loads the logger, which loads the full environment schema and requires both secrets. Section 6 now shows the working form.
2. **`control-service` does not read `control-service/.env.local`.** The previous instructions told you to create that file. Nothing reads it: `dotenv/config` loads `.env`, and the migrate and seed entrypoints load no dotenv at all. Section 5 documents the sourcing pattern that works for all three commands. The service does not exit cleanly on this failure either; under `tsx watch` it sits re-throwing, which reads as a hang rather than a configuration error.
3. **Sourcing that file then breaks the control-service test suite.** `REQUIRE_SEEDED_NETWORK=true` overrides a test default and fails one readiness test, 728 of 729 instead of 729. In a clean shell the suite passes 731 of 731 at the current head. Documented in section 16.
4. **Secrets must be at least 16 characters even for a migration** that never uses them. A short placeholder is rejected by the schema.
5. **`--limit` does not make the seed fast.** Measured at 10m 36s with `--limit=8`, of which 97% was calibration work that `--limit` does not bound. Section 7 has the phase breakdown.
6. **The end-to-end suites refuse to run against a seeded control database.** Proven by triggering the refusal. Section 16 explains the separate-database requirement, which was not documented anywhere.
7. **`pnpm seed-ops-depots` was missing from the setup sequence** despite being required before any depot account works. It is now section 8.
8. **The previous guide's central claim was out of date.** It described `/ops/*` as having its own auth system with "nothing to do with Supabase". That was collapsed onto a single Supabase front door. Section 9 describes what is actually there.

**Verified by measurement, not assertion:**

- The seeding timing trap, measured live at 05:15 IST: 9,198 records in the feed, all carrying GPS, and only 410 of them (4.5%) carrying a route name.
- The reference network numbers, read from the running production database: 759 corridors, 69 `timetable` plus 129 `od_timetable` = 198 measured target headways, 561 with none, and **zero fabricated**.
- The depot registry: 9,198 vehicles, 143 distinct depots, 0 unattributable, matching production exactly.
- Role scoping: an admin session requesting `/ops/control-room` is redirected to `/ops/forbidden`.
- The honest-data vocabulary rendering correctly: 36 dashes and zero `n/a` on a fresh instance with a reachable backend.
- All four pilot-driver safety guarantees, executed and passed: the full create-to-acknowledge-to-audit path, the offline acknowledgement queued in IndexedDB and flushed on reconnect, local TTL expiry with control-service agreeing through its own sweep, and the backstop sweep expiring a command nobody polls.
- The dispatcher-to-driver command path, executed and passed.

**Could not be verified, and is marked as such in the document:**

- **The exact daily window of good route identity in the UPSRTC feed.** Only two overnight measurements exist (04:17 and 05:15 IST). "Seed during service hours" is well-founded, but the specific best hours were not observed across a full day.
- **Obtaining a new Supabase project, Google Maps key, Resend key, or Upstash endpoint.** These require accounts this run did not create. Path B in section 2 says what each is for and what fails without it, but the sign-up flows themselves are undescribed.
- **A real SMS sender id.** Nothing in the current codebase sends SMS; invite delivery is email via Resend. If SMS is expected, it does not exist yet.
- **A production deploy.** Only local operation was exercised. Deployment is [`CONTROL_SERVICE_DEPLOYMENT.md`](CONTROL_SERVICE_DEPLOYMENT.md).
- **Provisioning a real (non-QA) admin's Supabase identity end to end.** The three-step link-and-push procedure in section 9 is transcribed from the cutover runbook and the scripts' own interfaces. This run used a `*.qa@example.test` identity, for which the seed scripts do the linking automatically, so the manual path was not executed.
