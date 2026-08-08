# `dev` vs `main` — Deep Technical Analysis

**Repository:** `utkarsh430/olympussai` — Olympuss Unified App
**Analysis date:** 2026-08-08
**Merge base:** `f2f240b` (current tip of `main`)
**Branches compared:** `main` … `dev`

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Branch topology and change metrics](#2-branch-topology-and-change-metrics)
3. [Commit timeline](#3-commit-timeline)
4. [Architectural transformation](#4-architectural-transformation)
5. [Subsystem deep dives](#5-subsystem-deep-dives)
   - [5.1 Authentication — two independent systems](#51-authentication--two-independent-systems)
   - [5.2 The data layer — two isolated datastores](#52-the-data-layer--two-isolated-datastores)
   - [5.3 The control service runtime](#53-the-control-service-runtime)
   - [5.4 State estimation](#54-state-estimation)
   - [5.5 Headway metrics and bunching detection](#55-headway-metrics-and-bunching-detection)
   - [5.6 The decision engine](#56-the-decision-engine)
   - [5.7 Command lifecycle](#57-command-lifecycle)
   - [5.8 The mesoscopic simulator](#58-the-mesoscopic-simulator)
   - [5.9 Pilot rollout gates and KPIs](#59-pilot-rollout-gates-and-kpis)
   - [5.10 The ops web consoles](#510-the-ops-web-consoles)
   - [5.11 The LLM copilot](#511-the-llm-copilot)
   - [5.12 The driver PWA](#512-the-driver-pwa)
6. [Cross-cutting security posture](#6-cross-cutting-security-posture)
7. [Testing and CI](#7-testing-and-ci)
8. [Build and tooling changes](#8-build-and-tooling-changes)
9. [Gap analysis — critical findings](#9-gap-analysis--critical-findings)
10. [Risk register](#10-risk-register)
11. [Merge readiness assessment](#11-merge-readiness-assessment)

---

## 1. Executive summary

`main` is a **single-process Next.js demonstration application**: a marketing landing page, a PIN-gated UPSRTC live-fleet dashboard, and a client-side bus-bunching simulator. It has no database, no user accounts, and no server-side state beyond a signed cookie.

`dev` converts that into a **three-tier operational control system** for real transit fleet management:

- The Next.js app gains its own Postgres datastore, a 7-role RBAC system with an append-only audit trail, and 31 new API endpoints.
- A wholly new, **independently deployable Node/Express service** (`control-service/`) appears with its own Postgres+PostGIS database, its own package manager lockfile, its own CI pipeline, and its own Docker image.
- That service implements real transit control theory: map-matched state estimation with Kalman smoothing, time-domain headway/EWT/CV metrics, reactive bunching detection, a four-algorithm control hierarchy with a hard safety filter, a full command lifecycle with database-enforced authorization, and a calibrated mesoscopic simulator with a regression gate.

The engineering quality is, in the main, **high** — safety invariants are enforced at the database level rather than in application code, architectural boundaries are enforced by lint rules *and* source-scanning tests, and every design decision carries an inline rationale referencing a technical blueprint.

The work is, however, **incomplete in a specific and important way**: the two halves do not yet connect. There is no GPS ingestion endpoint, no webhook receiver, and — most consequentially — **no bridge between the web app's approval records and the control service's approval records**, which live in separate databases with no synchronisation. The end-to-end command path cannot currently execute without direct SQL seeding.

**Verdict:** substantial, well-architected, genuinely impressive work that is roughly one integration ticket away from being a coherent system. It is not production-ready, and the branch's own documentation is honest about most (not all) of why.

---

## 2. Branch topology and change metrics

### Topology

```
main ──● f2f240b  (tip of main, also the merge base)
        │
dev     └──●──●──●── … ──● 13f8a95   (26 commits)
```

| Property | Value |
|---|---|
| Commits on `dev` not in `main` | **26** |
| Commits on `main` not in `dev` | **0** |
| Merge type available | **Fast-forward** (no conflicts possible) |

`dev` strictly supersedes `main`. Nothing on `main` is missing from `dev`.

### Change volume

| Metric | Value |
|---|---|
| Files touched | **328** |
| — Added | 296 |
| — Modified | 26 |
| — Deleted | 6 |
| Raw line delta | **+42,406 / −12,105** |
| Line delta excluding lockfiles | **+30,595 / −556** |

The raw numbers are heavily distorted by dependency lockfiles:

- `package-lock.json` deleted: **−11,549**
- `pnpm-lock.yaml` added: **+8,089**
- `control-service/pnpm-lock.yaml` added: **+3,722**

Netting those out, the true content change is **+30,595 lines added, 556 removed**. The 556 deletions are almost entirely the removal of the PIN authentication system.

### Structural growth

| Dimension | `main` | `dev` |
|---|---|---|
| Deployable services | 1 | **2** |
| Databases | 0 | **2** |
| Database tables | 0 | **34** (26 control-service + 8 ops) |
| Auth systems | 1 (shared PIN) | **2** (Supabase + ops RBAC) |
| User roles | 0 | **7** |
| API route handlers | 5 | **36** |
| React components changed/added | — | **42** |
| New page routes | — | **23** |
| `src/lib` modules changed/added | — | **42** |
| `control-service/src` TypeScript files | 0 | **69** |
| Test files | 8 | **60** |
| Test cases | ~237 | **~590** |
| CI workflows | 0 | **2** |

### Files deleted

```
package-lock.json                 (npm → pnpm migration)
scripts/generate-pin-hash.mjs     (PIN auth removed)
src/lib/auth/config.ts            (PIN auth removed)
src/lib/auth/password.ts          (PIN auth removed)
src/lib/auth/server.ts            (PIN auth removed)
src/lib/auth/session.ts           (PIN auth removed)
```

### Files modified (26)

Documentation (7): `README.md`, `docs/API_DISCOVERY.md`, `docs/ARCHITECTURE.md`, `docs/PRESENTATION_GUIDE.md`, `docs/PRODUCTION_ROADMAP.md`, `docs/olympuss/AUTH.md`, `docs/olympuss/DEPLOYMENT.md`

Configuration (6): `.gitignore`, `eslint.config.mjs`, `package.json`, `playwright.config.ts`, `tsconfig.json`, `vitest.config.ts`

Application (13): `src/middleware.ts`, `src/models/canonical.ts`, `src/lib/auth/{authorize,redirect}.ts`, the three `/api/auth/*` routes, `src/app/(public)/login/page.tsx`, the two protected project pages, `src/components/auth/{LoginForm,AuthenticatedActions}.tsx`, `tests/e2e/command-centre.spec.ts`

---

## 3. Commit timeline

All 26 commits carry the body `Auto-landed by Crewban` plus a ticket UUID. This is **agent-generated work**, landed ticket-by-ticket from the `crewban/*` branches visible on `origin`. That provenance is directly relevant to the defects found in §9 — several arise from two agents independently solving the same problem without shared context.

| # | SHA | Date | Ticket |
|---|---|---|---|
| 4 | `984d6e4` | 08-04 | Merge pull request #4 from utkarsh430/main |
| 5 | `2c3adea` | 08-05 | Fix pre-existing `next build` TypeScript failure: missing `three` type declarations |
| 6 | `1b66664` | 08-05 | Reconcile conflicting npm/pnpm lockfiles |
| 7 | `7d9c658` | 08-05 | **Spike:** architecture & integration contract for the persistent control service |
| 8 | `4b6b5b2` | 08-05 | **Core data model** & Postgres+PostGIS migrations |
| 9 | `eb667af` | 08-05 | Provision control-service hosting with CI/CD and observability |
| 10 | `5c49e36` | 08-05 | **Control-service application runtime** (server, MPC, REST+webhook API, Dockerfile) |
| 11 | `98c3d47` | 08-05 | **Multi-role RBAC auth** (driver, dispatcher, depot, control-room, planner) |
| 12 | `9d09960` | 08-06 | Wire real email delivery for ops RBAC invites (Resend) |
| 13 | `93fa578` | 08-06 | Build real per-role ops dashboards |
| 14 | `0d0dd16` | 08-06 | **Live route-direction state estimation** (map matching, ordering, smoothing) |
| 15 | `628f32b` | 08-06 | Audited breakdown-report submission endpoint |
| 16 | `6c53249` | 08-06 | **Headway/EWT/CV metrics** + live observability dashboard |
| 17 | `5172b17` | 08-06 | **Historical replay & mesoscopic simulator** with regression suite |
| 18 | `3346424` | 08-06 | **Decision engine:** terminal dispatch, two-way holding, self-equalizing, MPC |
| 19 | `6afc9ac` | 08-06 | **LLM copilot** — incident explanation and shift reports |
| 20 | `9f75a87` | 08-06 | **Command lifecycle and delivery service** |
| 21 | `a3bdadc` | 08-06 | **Driver PWA** — single-instruction command interface |
| 22 | `b330694` | 08-06 | Live end-to-end test of the pilot-driver command flow |
| 23 | `dc907e1` | 08-06 | Driver-to-vehicle assignment in ops RBAC schema |
| 24 | `fd692cb` | 08-06 | **Enterprise auth via Supabase** |
| 25 | `d78a76c` | 08-06 | Admin UI panel to assign/reassign driver vehicles |
| 26 | `18e582b` | 08-06 | Apply vehicle assignment to pilot-driver CommandConsole *(A01 gap still open)* |
| 27 | `63a31ba` | 08-06 | Dispatcher, depot & central control-room web consoles |
| 28 | `113cda8` | 08-06 | **Pilot-staging dashboard** with rollout gates and daily KPIs |
| 29 | `13f8a95` | 08-06 | Apply vehicle assignment to DriverDashboard + BreakdownReportPanel |

Note the ordering anomaly: the **Supabase enterprise auth rewrite (#24)** landed *after* the entire ops RBAC system (#11) and most of the control service. The ops RBAC system's code comments therefore still refer to "the PIN system" as an existing peer — a system that #24 subsequently deleted. See §9, finding G6.

---

## 4. Architectural transformation

### `main` — a single-tier demo

```
┌──────────────────────────────────────────────┐
│ Next.js app                                  │
│                                              │
│  /                    public landing (globe) │
│  /login               PROJECT_NAME + PIN     │
│  /project/upsrtc      fleet dashboard        │
│  /project/bunching    client-side simulator  │
│  /api/auth/*          login/logout/session   │
│  /api/upsrtc/*        proxy to upstream      │
│                                              │
│  State: one HS256 cookie. No database.       │
└──────────────────┬───────────────────────────┘
                   │ HTTPS
                   ▼
        margdarshi.upsrtcvlt.com  (UPSRTC live + schedule)
```

Authorization model: a single shared credential. `PROJECT_NAME` matched case-insensitively against an env var, `PROJECT_PIN_HASH` a bcrypt hash. One session claim, `role: 'project-access'`. No per-person identity, therefore no attribution, therefore no audit trail worth the name.

### `dev` — three tiers, two datastores, two auth systems

```
┌─────────────────────────────────────────────────────────────────────┐
│ Next.js app  (src/)                          Vercel / Node          │
│                                                                     │
│  ┌── Surface A: enterprise ───────────────────────────────────┐    │
│  │  /login, /project/*, /api/upsrtc/*                          │    │
│  │  Auth: Supabase Auth (email+password, admin-provisioned)    │    │
│  │  Cookies: @supabase/ssr managed                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌── Surface B: operations ──────────────────────────────────┐     │
│  │  /ops/{driver,pilot-driver,dispatcher,depot,               │     │
│  │        control-room,planner,admin}                         │     │
│  │  /api/ops/*  (31 endpoints)                                │     │
│  │  Auth: own HS256 JWT, own secret, own cookie               │     │
│  │  Store: OPS_DATABASE_URL → 8 tables (db/migrations/)       │     │
│  └─────────────────────────────────────────────────────────────┘    │
└───────┬──────────────────────────────────────┬──────────────────────┘
        │                                      │
        │ REST: Bearer service token           │ Anthropic Messages API
        │ (timeout + circuit breaker)          ▼
        │                            api.anthropic.com
        │
        │ ◄────── HMAC-signed webhooks ─────── ✗ RECEIVER NOT BUILT
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│ control-service/     Node 20 · Express · pg · Zod · Sentry          │
│                      Own package.json, own pnpm-lock, own CI        │
│                      Multi-stage Dockerfile → Render (not deployed) │
│                                                                     │
│  22 endpoints:  /healthz  /readyz  /v1/*                            │
│                                                                     │
│  src/state-estimation/  map matching · Kalman · ordering            │
│  src/headway/           EWT/CV metrics · reactive bunching rule     │
│  src/mpc/               4-algorithm control hierarchy + safety      │
│  src/tsp/               transit signal priority eligibility         │
│  src/pilot/             rollout gates · daily KPI · war room        │
│  src/simulation/        mesoscopic sim · replay · regression suite  │
│  src/db/                command lifecycle · rehydration             │
│  src/webhooks/          HMAC signing · retry with backoff           │
│                                                                     │
│  Store: CONTROL_SERVICE_DATABASE_URL → 26 tables (PostGIS)          │
└─────────────────────────────────────────────────────────────────────┘
        ▲
        │ ✗ NO GPS INGESTION ENDPOINT EXISTS
   (real vehicle position feed — the missing input)
```

### The load-bearing architectural rule

From [`control-service/README.md`](control-service/README.md):

> The Next.js app in `src/` never connects to this database directly and never holds write credentials to it. It talks to the control service only over REST plus signed webhooks, validated with the Zod schemas in `src/models/control.ts`. Nothing under `control-service/` is imported by the Next.js app, and nothing in `src/` should ever gain a Postgres connection string for this database.
>
> That boundary is load-bearing: see section 1 of the integration contract for the rejected alternative (shared DB) and why it was rejected.

This is enforced structurally, not by convention:

- `control-service` is excluded from the root `tsconfig.json`, so the Next.js typechecker cannot even see it.
- It has its own `package.json` and `pnpm-lock.yaml` — a separate dependency graph.
- The two CI workflows are path-scoped so neither can accidentally gate on the other.
- All cross-boundary payloads are re-validated with Zod at the receiving end.

The cost of this rule is real, and it is precisely what causes the disconnection described in §9, finding G3.

---

## 5. Subsystem deep dives

### 5.1 Authentication — two independent systems

`dev` ships **two entirely separate authentication systems** that share no code path, no cookie, no secret, and no datastore.

#### System A — enterprise auth (Supabase), gating `/project/*`

Replaced the PIN system in commit #24. Files deleted: `src/lib/auth/{config,password,server,session}.ts` and `scripts/generate-pin-hash.mjs`. Files added: [`src/lib/supabase/{env,server,middleware}.ts`](src/lib/supabase/).

**Login sequence** ([`src/app/api/auth/login/route.ts`](src/app/api/auth/login/route.ts)):

| Step | Check | Failure |
|---|---|---|
| 1 | Same-origin (`Origin`, falling back to `Referer`) | `403` |
| 2 | `Content-Type: application/json` | `415` |
| 3 | Zod: `email` (validated, ≤254), `password` (1–200) | `400`, generic message |
| 4 | Rate limit, keyed `clientIp:normalizedEmail`, 5 failures / 15 min sliding | `429` + `Retry-After` |
| 5 | `supabase.auth.signInWithPassword()` | `401`, generic message |

Every failure path returns the identical string `Invalid email or password.` Rate limiting is checked *before* the Supabase call and recorded *after* a failure.

**Three notable properties:**

1. **The app never sees a password hash.** Supabase Auth owns hashing and verification entirely. The previous system stored a bcrypt hash in an environment variable, with a documented dotenv `$`-expansion footgun that could silently corrupt it. That entire class of problem is gone.

2. **`getUser()`, not `getSession()`.** Both the middleware and the server-side helpers call `supabase.auth.getUser()`, which re-validates the session against Supabase's servers on every check, rather than `getSession()`, which trusts the cookie's contents. This is the correct choice and is explicitly documented as such in the README.

3. **No self-service signup exists anywhere.** Accounts are provisioned out-of-band by [`scripts/create-project-user.mjs`](scripts/create-project-user.mjs), which prompts for the password with echo disabled (never as an `argv` entry, so it cannot leak via `ps` or shell history) and uses `SUPABASE_SERVICE_ROLE_KEY` — a key that is never imported by any route handler that serves ordinary requests.

**A pre-existing bug was fixed en route.** `main`'s README documented a known gap: `sanitizeNext()` allowlisted only `/project/upsrtc`, so an unauthenticated deep link to `/project/bunching` would redirect correctly to login but then land the user on the wrong page afterward. On `dev`, [`src/lib/auth/redirect.ts`](src/lib/auth/redirect.ts) allowlists both. It failed *safe* before — the fallback was a valid internal path, so it was a broken deep link rather than an open redirect — but it is now correct.

#### System B — ops RBAC, gating `/ops/*`

Entirely new in commit #11. Seven roles defined in [`src/lib/auth/rbac/roles.ts`](src/lib/auth/rbac/roles.ts):

```typescript
export const OPS_ROLES = [
  'driver', 'pilot_driver', 'dispatcher', 'depot',
  'control_room', 'planner', 'admin',
] as const;
```

`pilot_driver` is deliberately distinct from `driver` — the command interface must reach "the pilot driver pool", not every driver account. `admin` is deliberately excluded from `OPERATIONAL_ROLES`: it can invite and manage accounts but has no operational dashboard of its own.

**Why a second system rather than a role column on the first** — from [`docs/olympuss/RBAC.md`](docs/olympuss/RBAC.md):

| Dimension | Enterprise (Supabase) | Ops RBAC |
|---|---|---|
| Cookie | `@supabase/ssr` managed | `olympuss_ops_session` |
| Secret | Supabase-managed | `OPS_SESSION_SECRET` (HS256, ≥32 chars) |
| Datastore | Supabase's own users table | `ops_users` in this app's Postgres |
| Session lifetime | 8h | **4h** — operational accounts re-auth more often |
| Password hashing | Supabase | bcrypt cost 12, ≥12 chars |
| Route surface | `/project/*`, `/api/upsrtc/*` | `/ops/*`, `/api/ops/*` |

> "A token from one system can never verify against the other."

**Middleware routing** ([`src/middleware.ts`](src/middleware.ts)) branches on path prefix before touching either auth backend:

```typescript
if (pathname.startsWith('/ops/') || pathname.startsWith('/api/ops/')) {
  return handleOpsRequest(request);   // never touches Supabase
}
// …otherwise the Supabase branch
```

The ops branch derives the required role from the URL segment (`/ops/control-room/…` → `control_room` via `roleForSegment()`) and then distinguishes four outcomes:

| Condition | Page request | API request |
|---|---|---|
| Correct role | pass | pass |
| Wrong role (authenticated) | `→ /ops/forbidden` | `403 FORBIDDEN` |
| Not authenticated | `→ /ops/login?next=…` | `401 UNAUTHORIZED` |
| Non-role segment (`login`, `auth`, `forbidden`) | pass through to the route's own guard | same |

The wrong-role/not-authenticated distinction is deliberate and correct. From the file's own comment:

> Authenticated-but-wrong-role never bounces to `/ops/login` (that would imply "you are not signed in", which is false and would invite retrying with a different account).

**Defence in depth.** Middleware is the *first* check, never the only one. Every one of the 31 ops route handlers calls [`requireOpsRole()`](src/lib/auth/rbac/guard.ts) itself:

> a middleware matcher mistake can never be the only thing standing between a request and another role's endpoint.

**The invite flow** is the strongest single piece of security engineering in the RBAC system:

- A fresh 256-bit token per invite.
- **Only the SHA-256 digest is stored** in `ops_invites.token_hash` — a database read alone can never be used to accept someone else's invite.
- The raw token and accept URL are never logged.
- `POST /api/ops/admin/invites` **omits the raw `acceptUrl` from its response by default**; it is included only when the admin explicitly passes `revealAcceptUrl: true`.
- Delivery goes through [Resend](src/lib/email/resend.ts) with a branded HTML/text template. If delivery fails, the invite row is still created (never silently dropped) and the response reports `delivered: false` with an actionable message.
- Resend rotates the token — because the raw original was never persisted, a resend *cannot* re-send the same one.

---

### 5.2 The data layer — two isolated datastores

#### Datastore 1: `control-service/db/` — 26 tables, Postgres 14+ with PostGIS

Four migrations, all idempotent (`CREATE … IF NOT EXISTS`), applied in filename order.

**`20260805190000__core_data_model.sql` (664 lines)** — the foundation. 20 tables across five domains:

| Domain | Tables |
|---|---|
| Network topology | `corridors`, `routes`, `route_directions`, `route_shapes`, `route_links`, `stops`, `route_direction_stops` |
| Fleet & scheduling | `vehicles`, `blocks`, `trips`, `trip_stop_times` |
| Live state | `vehicle_states`, `headway_states` |
| Incidents | `bunching_incidents`, `bunching_incident_members` |
| Decision & action | `dispatcher_actions`, `recommendations`, `commands`, `outcomes`, `route_policies` |

`route_policies` is explicitly *configuration, not code*: thresholds, control points, hold caps, and the `Kf`/`Kb` gains the two-way holding algorithm uses are all rows, tunable per route-direction without a deploy.

**`20260805210000__state_estimation.sql`** — additive: loop/corridor ordering columns on `route_directions`; low-confidence flag, persisted Kalman filter state, and stop-entry timestamp on `vehicle_states`.

**`20260806120000__command_lifecycle.sql`** — adds `commands.version`, `commands.supersedes_command_id`, `commands.ack_outcome`, the `command_audit_log` table, the `control_service_expire_commands()` TTL function, and the unique partial index described in §5.7.

**`20260806190000__pilot_rollout_and_kpi.sql`** — `route_direction_rollout_stages`, `rollout_stage_audit_log`, `daily_kpi_snapshots`, `guardrail_breach_log`, `war_room_incident_reviews`.

#### Datastore 2: `db/` — 8 tables, Postgres 13+, the web app's own

| Table | Purpose |
|---|---|
| `ops_users` | Per-person operational accounts, bcrypt password, role, `vehicle_id` |
| `ops_invites` | Admin-issued invites; SHA-256 token digest only |
| `ops_audit_log` | Append-only privileged-action record, trigger-enforced |
| `ops_dispatcher_actions` | Logged human approval/override decisions |
| `ops_breakdown_reports` | Driver-submitted breakdown reports |
| `ops_copilot_interactions` | Append-only LLM interaction log, trigger-enforced |
| `ops_shift_report_drafts` | Copilot-drafted shift handovers |
| `ops_kill_switches` | Route-level and network-wide automation halts |

Seven migrations. Bootstrapping the first admin is handled by [`scripts/seed-ops-admin.mjs`](scripts/seed-ops-admin.mjs), since the very first admin by definition has no inviter.

**Fail-closed by design** — from [`db/README.md`](db/README.md):

> `OPS_DATABASE_URL` is read by `src/lib/db/pool.ts` at runtime; **nothing in `src/` falls back to an in-memory store if it is unset**, so every ops route fails closed (503) rather than silently running without persistence.

#### Neither datastore has a migration runner

Both READMEs acknowledge this identically: files are plain ordered SQL, applied with `psql`, and *"any dedicated migration runner (dbmate, node-pg-migrate, Flyway, …) can adopt these files as-is later; none is wired up yet."* This is the root cause of findings G1 and G2 in §9.

---

### 5.3 The control service runtime

An independent Express application: **69 TypeScript source files**, `pnpm`, `pg`, Zod, `@sentry/node`, `pino` structured logging.

#### Boot sequence ([`src/index.ts`](control-service/src/index.ts))

```
1. dotenv/config              → load environment
2. loadEnv()                  → validate, fail fast on missing config
3. initSentry()               → error/perf tracking
4. createApp()                → assemble Express
5. app.listen(PORT)           → /healthz live IMMEDIATELY
6. rehydrateState()           → BACKGROUND: load vehicle_states,
                                headway_states, route_policies into memory
7. /readyz flips to 200       → only after (6) resolves
8. sweepExpiredCommands()     → periodic TTL sweep
```

The split between liveness and readiness is deliberate and correct: the process reports alive as soon as it can accept connections, but reports *ready* only once its in-memory state is warm, so a load balancer never routes traffic to a cold instance.

#### App assembly ([`src/app.ts`](control-service/src/app.ts))

```typescript
app.set('trust proxy', true);          // Render's proxy → correct req.ip
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '1mb' }));

app.use(healthRouter);                 // UNAUTHENTICATED by design
app.use(requireServiceToken);          // ← everything below is gated
app.use(commandsRouter);
app.use(vehicleStatesRouter);
app.use(mpcRouter);
app.use(headwayRouter);
app.use(pilotRouter);
```

Health endpoints sit *above* the auth middleware because Render's health checker calls them without a token. Everything else is gated.

#### The 22 endpoints

| Group | Endpoints |
|---|---|
| Health | `GET /healthz`, `GET /readyz` |
| Commands | `POST /v1/commands`, `GET /v1/commands/:id`, `GET /v1/commands/active`, `GET /v1/commands/:id/audit`, `POST /v1/commands/:id/deliver`, `POST /v1/commands/:id/ack`, `POST /v1/commands/:id/supersede` |
| State | `GET /v1/vehicle-states` |
| Decision | `POST /v1/mpc/solve` |
| Headway | `GET /v1/route-directions`, `POST /v1/route-directions/:id/headway/compute`, `GET /v1/incidents`, `GET /v1/incidents/:id` |
| Pilot | `GET /v1/rollout-stages`, `PUT /v1/route-directions/:id/rollout-stage`, `GET /v1/route-directions/:id/rollout-stage/audit`, `GET /v1/kpi/daily`, `GET /v1/guardrail-breaches`, `GET /v1/war-room/incidents`, `PUT /v1/war-room/incidents/:incidentId/review` |

#### Service-token authentication ([`src/auth/serviceToken.ts`](control-service/src/auth/serviceToken.ts))

```typescript
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length differs -> definitely not equal, but still do a same-length
  // dummy compare so this branch doesn't return in measurably different
  // time than the equal-length path (basic timing-attack hygiene, A07).
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
```

The dummy same-length compare on the mismatched-length path is a detail most implementations miss.

#### The web-side client ([`src/lib/controlService/client.ts`](src/lib/controlService/client.ts))

Server-only, with two failure-isolation behaviours the integration contract requires:

- **Fixed 8s timeout** — chosen to fit inside the existing 15s poll / 10s upstream budget the ops dashboards already assume.
- **Circuit breaker** — 3 consecutive failures opens the circuit for 30s. Module-scoped per warm process, reset on redeploy.

Deliberately hand-rolled rather than pulled from a library, with the reasoning stated inline: this client issues only idempotent reads plus one detect-and-persist compute call, none of which need anything more sophisticated.

#### Container image ([`control-service/Dockerfile`](control-service/Dockerfile))

Four-stage build — `base` → `deps` → `build` → `prod-deps` → `runtime`. Ships only compiled `dist/` plus production `node_modules`. Runs as a non-root `control-service` user. Carries a `HEALTHCHECK` that hits `/healthz` (liveness only, no DB call, so it succeeds independent of readiness).

#### Hosting ([`control-service/render.yaml`](control-service/render.yaml))

Two environments, each with its own Postgres 16 instance:

| | `control-service-staging` | `control-service-pilot` |
|---|---|---|
| Tracks branch | `dev` | `main` |
| Plan | starter | standard |
| Instances | 1 | **2** |
| Database | `basic-256mb` | `basic-1gb` |
| Region | singapore | singapore |

All secrets marked `sync: false` — set out of band via `render env set`, never committed. **Not connected to a live Render account.** The blueprint's own header says so.

---

### 5.4 State estimation

[`control-service/src/state-estimation/`](control-service/src/state-estimation/) — a self-contained library with no HTTP dependency of its own. Given a raw position event it produces distance-along-route, a matched route-direction with a scored confidence, a smoothed speed, a stop-state classification, and a leader-follower ordering.

#### Map matching and confidence ([`confidence.ts`](control-service/src/state-estimation/confidence.ts))

```typescript
export const LOW_CONFIDENCE_THRESHOLD = 0.4;

const OFF_ROUTE_PERPENDICULAR_METERS = 75;
const HIGH_CONFIDENCE_PERPENDICULAR_METERS = 20;
const AMBIGUITY_MARGIN_METERS = 10;
const CONTINUITY_BONUS = 0.15;
```

Two responsibilities, cleanly separated:

- `selectChosenCandidate()` — **hysteresis**. When two candidates are within 10 m of each other (the classic out-and-back route where both directions run the same road), and the runner-up is the direction previously matched, it *sticks with the previous direction* rather than flapping on GPS noise.
- `scoreDirectionConfidence()` — how much to trust the choice. Below 0.4, the estimate is flagged `isLowConfidence`.

The flag is not decorative: [`ordering.ts`](control-service/src/state-estimation/ordering.ts) **excludes flagged vehicles from the leader/follower chain entirely** (rank `-1`) rather than silently including them. A low-confidence match cannot poison a headway computation.

#### Kalman smoothing ([`kalmanFilter.ts`](control-service/src/state-estimation/kalmanFilter.ts))

A constant-velocity filter over state `[s, v]` (distance-along-route, speed) with a white-noise-acceleration process model — the standard choice for smoothing noisy road-vehicle GPS.

```typescript
const DEFAULT_ACCEL_VARIANCE = 0.015;                 // (m/s²)²
const DEFAULT_MEASUREMENT_VARIANCE_METERS2 = 225;     // ~15 m σ, consumer GPS
const INITIAL_POSITION_VARIANCE_METERS2 = 400;
const INITIAL_VELOCITY_VARIANCE = 100;
```

The initial variances are deliberately *wider* than the steady state the filter converges to, so a cold start is genuinely less confident than a warm one. `serialize()`/`deserialize()` round-trip the full filter state to the database, so a service restart resumes from the persisted covariance instead of re-converging from a cold prior. `kalmanFilter.test.ts` asserts exactly this.

#### Ordering

Handles three non-trivial cases beyond simple sorting: **terminal wrap-around for loop routes**, **shared-trunk/corridor ordering** where multiple route-directions overlap a common segment, and exclusion of low-confidence vehicles.

#### The critical caveat

From the module's own README section:

> wiring the state-estimation library's `processPositionEvent()` into a live GPS ingestion endpoint is a further, separate piece of work — `src/index.ts` re-exports `StateEstimationService` for that purpose, **but the runtime does not call it yet**.

This is finding G4 in §9.

---

### 5.5 Headway metrics and bunching detection

[`control-service/src/headway/`](control-service/src/headway/) — four files with a clean separation between pure math and I/O:

| File | Role |
|---|---|
| `metrics.ts` | Pure math: gap → hFwd/hBwd → CV/EWT. No I/O. |
| `bunching.ts` | Pure k-consecutive-samples reactive rule. No I/O. |
| `repository.ts` | Postgres access (429 lines) |
| `service.ts` | Orchestrates one compute cycle |

#### The metric definitions

The source schema has no per-stop actual-arrival event log, so headway cannot be derived from crossing timestamps directly. The module documents the substitute definitions explicitly:

```
gapMeters   = distance-along-route between leader and follower, measured
              along the direction of travel, wrapping at
              totalDistanceMeters for a loop route-direction.

hFwdSeconds = gapMeters / follower's current speed
              — the "closing" headway a reactive rule watches.

hBwdSeconds = gapMeters / leader's current speed
              — symmetric backward headway.
```

Two numerical guards that matter in production:

```typescript
export const MIN_SPEED_KMPH = 1;
export const MAX_HEADWAY_SECONDS = 24 * 60 * 60;
```

A stationary vehicle is floored to 1 km/h rather than producing a division by zero, and every headway is capped at 24 hours so a genuinely stalled vehicle reports a **large-but-finite, JSON-safe** number instead of `Infinity`. This is exactly the kind of thing that produces a mystifying 500 at 3 a.m. if you skip it.

The loop wrap-around is handled without a special case at the call site:

```typescript
export function computeGapMeters(leader, follower, total): number {
  if (follower <= leader) return leader - follower;
  return Math.max(0, total - (follower - leader));
}
```

> On a linear route-direction the leader always has the larger raw distance; on a loop the wrap pair has the follower's raw distance ahead of the leader's, which is exactly the signal used here to fold the wrap in.

#### The reactive bunching rule ([`bunching.ts`](control-service/src/headway/bunching.ts))

```typescript
const window = ratiosMostRecentFirst.slice(0, requiredSamples);
const allBunched   = window.every((r) => r <= bunchedThresholdRatio);
const allWarning   = window.every((r) => r <= warningThresholdRatio);
const allRecovered = window.every((r) => r >  warningThresholdRatio);
```

All three thresholds are **read from `route_policies`, never hard-coded**. `requiredSamples` exists specifically to avoid flagging on one noisy GPS fix. Typical values: `bunched` at ≤25 % of target headway, `warning` at ≤50 %.

#### The hard boundary

Stated three separate times across the codebase, and true:

> The compute endpoint is **detection-and-display only**: it never creates a `commands` row or calls the MPC solver.

`service.ts` orchestrates: load live state → order leader/follower (reusing `state-estimation/ordering.ts`) → compute and persist one `headway_states` row per pair → open/escalate/close `bunching_incidents`. Nothing more.

#### A documented workaround worth knowing about

`repository.ts` queries `vehicle_states` / `route_policies` **directly on every call** rather than reading the in-memory store that `/v1/vehicle-states` and `/v1/mpc/solve` use. The reason, from the file's own comment: nothing currently refreshes that store between boot and the not-yet-built GPS ingestion endpoint. This is a symptom of G4, handled honestly.

---

### 5.6 The decision engine

[`control-service/src/mpc/`](control-service/src/mpc/) implements a four-tier control hierarchy. [`solver.ts`](control-service/src/mpc/solver.ts) orchestrates in strict priority order.

#### Tier 1 — Terminal dispatch (Algorithm A)

The default first line of control. A vehicle dwelling at the route-direction's origin terminal (`route_direction_stops` sequence 0) is regulated here.

The solver contains a subtlety worth highlighting:

```typescript
const terminalVehicleIds = new Set(terminalCandidates.map((c) => c.vehicleId));
for (const h of headwayStates) {
  if (isAtTerminal(vehicleStatesByVehicleId.get(h.followerVehicleId), terminalStopId)) {
    terminalVehicleIds.add(h.followerVehicleId);
  }
}
```

Vehicles at the terminal are added to the exclusion set **even when they produced no candidate** — e.g. already correctly spaced, so no hold is needed right now. Without this, tiers 2 and 3 would try to act on a vehicle that terminal dispatch owns. This is the kind of bug that only shows up under load.

#### Tier 2 — Two-way holding (Algorithm B)

```
hold(i) = clamp[ Kf × (H* − h_fwd(i)) − Kb × (H* − h_bwd(i)), 0, hold_max ]
```

The forward term holds a bus that is too close to its leader; the backward term reduces or cancels that hold when the follower behind is already too close — **so the controller does not export the problem downstream**. `Kf` and `Kb` come from `route_policies`.

#### Tier 3 — Self-equalizing (Algorithm C)

Explicitly a **fallback, not a second opinion**:

> Self-equalizing only fires for a pair two-way couldn't cover (missing `Kf`/`Kb` or backward headway).

#### Tier 4 — The hard safety filter ([`safety.ts`](control-service/src/mpc/safety.ts))

Rejects any candidate that:

1. was computed from **stale state** (`DEFAULT_STATE_STALE_SECONDS`),
2. breaches the policy's **max-hold cap**, or
3. targets a vehicle that already has a **conflicting active command**.

Two design choices here are notably good:

```typescript
if (rejected.length > 0) {
  // Never silent: a hard-safety rejection is exactly the signal an
  // operator needs to see (blueprint 9.1 step 5 guardrail)
  logger.warn({ routeDirectionId, rejected: … }, 'mpc.solve: hard safety filter rejected candidate action(s)');
}
```

Rejections are **returned to the caller** on `rejectedCandidates` *and* logged at warn level. Nothing is silently dropped — a rejection is treated as signal, not noise.

#### Tier 5 — Occupancy MPC (Algorithm E), advisory only

```typescript
/** Occupancy-weighted MPC re-scoring of the safety-filtered candidates.
 *  Always present, always `label: 'PREDICTIVE'` — advisory only, never
 *  the source of `selectedActionType`. */
predictiveAdvisory: PredictiveAdvisory;
```

The MPC re-scores the safety-filtered candidates against wait/onboard cost terms and returns its opinion — but it is **structurally incapable** of setting `selectedActionType`. That field is assigned from `safeTerminal[0] ?? safeMidRoute[0] ?? null`, which never consults the advisory. This matches the blueprint's stated phasing: the MPC follows the deterministic controllers, it does not replace them.

#### Transit signal priority ([`src/tsp/eligibility.ts`](control-service/src/tsp/eligibility.ts))

A pure function deciding whether a gapped bus with an authorised signal interface and fresh state qualifies for signal priority, and if so what request payload it would carry. **It never makes a network call.** `test/tspEligibility.test.ts` is its regression suite and is documented as a gate that must stay green before any future ticket connects it to a live interface.

---

### 5.7 Command lifecycle

This is the strongest engineering in the branch. The core insight is that **safety invariants are enforced by Postgres, not by application code**.

#### Invariant 1 — no command without an unconsumed approval

```sql
dispatcher_action_id uuid not null unique
  references dispatcher_actions (id) on delete restrict,
```

`NOT NULL` means no command without an approval. `UNIQUE` means one approval can never authorize a second command. And a `BEFORE INSERT` trigger closes the remaining gap:

```sql
create or replace function control_service_consume_dispatcher_action()
returns trigger language plpgsql as $$
declare v_consumed_at timestamptz;
begin
  select consumed_at into v_consumed_at
    from dispatcher_actions where id = new.dispatcher_action_id
    for update;                              -- ← row lock, no TOCTOU race

  if not found then
    raise exception 'dispatcher_action % does not exist', new.dispatcher_action_id;
  end if;
  if v_consumed_at is not null then
    raise exception 'dispatcher_action % is already consumed', new.dispatcher_action_id;
  end if;

  update dispatcher_actions set consumed_at = now() where id = new.dispatcher_action_id;
  return new;
end; $$;
```

The `FOR UPDATE` lock means the check-and-consume is atomic. There is **no window** in which two concurrent inserts could both observe the approval as unconsumed.

#### Invariant 2 — at most one active command per vehicle

```sql
drop index if exists commands_active_idx;
create unique index if not exists commands_one_active_per_vehicle_idx
  on commands (vehicle_id)
  where status in ('proposed', 'awaiting_approval', 'authorized',
                   'delivered', 'acknowledged', 'executing');
```

The command lifecycle migration **replaced a non-unique index with a unique partial one**. Its own comment explains why:

> At most one non-terminal command per vehicle, enforced by Postgres itself (not just the advisory `listActiveVehicleIds()` pre-check in `src/mpc/safety.ts`). A second INSERT while one is already active fails with `23505`, which `src/db/commands.ts` maps to a `409 vehicle_has_active_command`. **Insert-time enforcement closes the race the advisory check alone leaves open.**

The MPC's safety filter still does its advisory pre-check — but it is understood to be advisory, and the database is the real guarantee.

#### Invariant 3 — TTL is enforced on every path

```sql
create or replace function control_service_expire_commands()
returns setof commands language plpgsql as $$
begin
  return query
    update commands set status = 'expired'
     where status in ('proposed','awaiting_approval','authorized','delivered','acknowledged')
       and expires_at <= now()
    returning *;
end; $$;
```

Called **lazily before every deliver/ack** *and* on a **periodic sweep** from `src/index.ts`, "so an expired command can never be delivered or acknowledged/executed no matter which path notices first."

`'executing'` is deliberately excluded — a command already being carried out is not retroactively expired mid-execution; it runs to `completed` or `failed`.

#### Invariant 4 — the audit log cannot drift from reality

`command_audit_log` is written **by a trigger on `commands`**, not by application code:

> one row per state transition, written automatically by a trigger on commands so the audit trail **can never drift from reality by a forgotten application-level write**.

Actor context that isn't a `commands` column (who authorized, why a driver marked something unsafe) rides in via **transaction-local settings**:

```
control_service.audit_actor_type
control_service.audit_actor_id
control_service.audit_reason
```

The application `SET LOCAL`s these immediately before the status-changing statement; the trigger reads them with `current_setting(…, true)` (missing → null, never an error). The consequence:

> This makes "full lifecycle reconstructable from audit log alone" true **even for a direct SQL fix-up**, not just for writes that went through the application.

That is a genuinely thoughtful design. A DBA hotfixing a row at 3 a.m. still produces a correct audit trail.

#### Versioning and supersession

`commands.version` (monotonic, starts at 1) and `commands.supersedes_command_id` form a chain. `POST /v1/commands/:id/supersede` cancels the prior row and inserts `version + 1` **in the same transaction**, which is required to stay inside the one-active-per-vehicle unique index.

#### The nine-state status machine

```
proposed → awaiting_approval → authorized → delivered
         → acknowledged → executing → completed
                                    ↘ expired | cancelled | failed
```

`ack_outcome` is constrained to `('accept','unable','unsafe')`. The migration comment is explicit about the human factor:

> `unable`/`unsafe` are recorded exactly like `accept` — timestamp + reason — and **never trigger a penalty**; there is no scoring/penalty subsystem in this service for this path to invoke.

A driver refusing an unsafe instruction is recorded neutrally. Whether by design or accident, that is the right call for a system that expects drivers to exercise judgment.

---

### 5.8 The mesoscopic simulator

[`control-service/src/simulation/`](control-service/src/simulation/) — an event-based simulator for offline evaluation.

#### Isolation, enforced structurally

> It has no dependency on `../db`, `../state`, `../routes`, `../webhooks`, or `../mpc`, so it never writes production data and never touches the live command path.

And it is **deliberately not re-exported** from `src/index.ts` — because importing that file starts the live HTTP server. Consumers import `src/simulation/index.ts` directly.

#### Components

| File | Role |
|---|---|
| `engine.ts` | Core event loop: stop sequence, link travel times, boarding/alighting demand |
| `replay.ts` | Historical-day replay against recorded values |
| `controllers.ts` | Pluggable `Controller` interface — no-control vs. controlled comparison |
| `rng.ts` | Seeded RNG for reproducibility |
| `kpi.ts` / `referenceKpi.ts` | KPI computation and reference baselines |
| `regressionRunner.ts` | Guardrail assertions across the scenario matrix |
| `scenarios/` | `demandBurst`, `missedTrip`, `gpsDropout`, `nonCompliance` |

#### Documented simplifications (not hidden)

- Vehicles are processed in terminal-dispatch order and keep that relative order for the whole trip — a single-lane/no-overtake assumption generalised to the full route-direction rather than modelled per segment.
- One route-direction per run; corridor/shared-trunk interaction is out of scope for this engine.
- Headway is measured stop-arrival-to-stop-arrival at control points.

#### The regression gate

`checkUniversalGuardrails()` asserts, for **every (scenario, controller) pair**:

1. **No NaN/Infinity** anywhere in the KPI summary or per-visit records — "a modeling bug … must fail loudly rather than silently produce garbage KPIs".
2. Every applied hold stays within `[0, maxHoldSeconds]`.
3. **No hold is ever applied to a visit whose state was stale** (`gps_dropout` scenario) — and critically, this is *"checked directly against the visit records rather than trusted from the controller's own logic."*
4. Counts (boardings, denied boardings) are never negative.

Guardrail 3 is the important one. A controller that acts on missing state is unsafe by construction, and the test verifies the *outcome* rather than asking the controller whether it behaved.

The gate runs as part of `pnpm test`, which means it runs on every PR touching `control-service/**`. No separate gating mechanism was introduced — a guardrail violation blocks merge exactly like any other failing test.

---

### 5.9 Pilot rollout gates and KPIs

[`control-service/src/pilot/`](control-service/src/pilot/) — the staged-rollout safety layer, added in the final commit (#28).

#### Rollout stages

Per-route-direction, changeable **without a deploy**. Default is `observation`. The stages that forbid command creation are `observation` and `shadow`.

[`gate.ts`](control-service/src/pilot/gate.ts) is called from `createCommand()` **inside its own transaction, on the same `PoolClient`**:

> so a rejection and its guardrail-breach log entry are atomic with (and precede) the insert they block.

The gate's scope note is worth reading, because it reasons carefully about what the gate actually adds:

> every command already requires a valid, unconsumed `dispatcherActionId` … unconditionally, regardless of rollout stage — which is itself a human approval. That means `'advisory'` and beyond are already at the posture this ticket asks for by construction; the only stages that change `createCommand`'s behaviour are the two pre-command stages.

Rejection produces a `403 rollout_stage_forbids_commands` **and** records a guardrail breach. Failures are counted, not just refused.

`rolloutStages.ts` is documented as the **sole write path** to the stage column; `gate.ts` only ever reads it. Every change writes `rollout_stage_audit_log` in the same transaction.

#### Daily KPIs ([`dailyKpi.ts`](control-service/src/pilot/dailyKpi.ts))

Per route-direction per day: `meanHeadwaySeconds`, `ewtSeconds`, `cv`, `incidentCount`, `recoveredIncidentCount`, `recoveryRate`, `guardrailBreachCount`, `complianceSampleCount`, `compliancePct`.

The caching strategy is neat:

> Computed on demand from that day's raw rows and upserted into `daily_kpi_snapshots` so **a past day's numbers stop moving once the day is over**, while today's row keeps refreshing on every read.

#### War room

`war_room_incident_reviews` plus `PUT /v1/war-room/incidents/:incidentId/review` — a structured post-incident review workflow, surfaced in the web app at `/ops/control-room/incidents/[id]`.

---

### 5.10 The ops web consoles

**23 new page routes** under `src/app/(ops)/`, **42 components**, **31 API endpoints**.

#### Page surface

| Route | Role | Content |
|---|---|---|
| `/ops/login`, `/ops/accept-invite`, `/ops/forbidden` | — | Auth surface |
| `/ops/driver` | `driver` | Schedule lookup, breakdown reporting |
| `/ops/pilot-driver` | `pilot_driver` | Single-instruction command console (PWA) |
| `/ops/dispatcher` | `dispatcher` | Action form, approval submission |
| `/ops/depot` | `depot` | Depot dashboard |
| `/ops/planner` | `planner` | Planner dashboard |
| `/ops/control-room` | `control_room` | Command form, approval queue, kill switches |
| `/ops/control-room/observability` | `control_room` | Live headway/incident dashboard |
| `/ops/control-room/pilot` | `control_room` | Rollout stages, daily KPIs, guardrail breaches |
| `/ops/control-room/copilot` | `control_room` | NL query, shift-report drafting |
| `/ops/control-room/incidents/[id]` | `control_room` | Incident review / war room |
| `/ops/admin/invites` | `admin` | Invite management |
| `/ops/admin/rollout-stages` | `admin` | Stage management |

#### API surface (31 endpoints)

```
Auth (4)      POST /ops/auth/{login,logout,accept-invite}   GET /ops/auth/session
Admin (8)     POST/GET  /ops/admin/invites
              POST      /ops/admin/invites/[id]/resend
              GET       /ops/admin/users
              POST      /ops/admin/users/[id]/{disable,vehicle}
              GET       /ops/admin/rollout-stages
              PUT       /ops/admin/rollout-stages/[id]
              GET       /ops/admin/rollout-stages/[id]/audit
Dispatcher(1) POST/GET  /ops/dispatcher/approvals
Control (13)  POST      /ops/control-room/commands
              GET       /ops/control-room/commands/[id]
              POST      /ops/control-room/approvals/[id]/reject
              GET/POST  /ops/control-room/kill-switches
              POST      /ops/control-room/kill-switches/[id]/disengage
              POST      /ops/control-room/copilot/{explain,query}
              POST/GET  /ops/control-room/copilot/shift-reports[/id][/finalize]
              GET       /ops/control-room/pilot/{kpi,guardrail-breaches,war-room}
              PUT       /ops/control-room/pilot/war-room/[incidentId]
Driver (3)    POST      /ops/driver/breakdown-reports
              GET       /ops/pilot-driver/commands
              POST      /ops/pilot-driver/commands/[id]/ack
Shared (1)    GET       /ops/fleet/schedule
```

#### The two-phase approval workflow

```
1. Dispatcher   POST /api/ops/dispatcher/approvals
                → creates ops_dispatcher_actions row (the "approval")
                → writes ops_audit_log

2. Control room POST /api/ops/control-room/commands
                → requires a valid dispatcherActionId
                → checks active kill switches
                → writes ops_audit_log
```

Separation of duties is real here: the dispatcher who approves and the control-room operator who issues are different roles with different sessions. Rejection is a first-class path (`POST /ops/control-room/approvals/[id]/reject`), with `decisionStateOf()` deriving `pending | approved | rejected` from `consumedAt`/`rejectedAt`.

#### Kill switches

`GET` is readable by `dispatcher`, `depot`, **and** `control_room` — the reasoning is stated inline:

> a dispatcher needs to know automation is halted on their route before proposing an action into a queue that will just sit there.

`POST` (engage) is `control_room` only. Scope is a Zod discriminated union: `network` (reason only) or `route` (reason + `routeDirectionId`). Enforcement happens at `POST /api/ops/control-room/commands`.

#### Where the dashboard data actually comes from

[`src/lib/ops/fleetData.ts`](src/lib/ops/fleetData.ts) does **not** call the control service. It reuses the existing UPSRTC upstream integration in-process:

> This intentionally does not call the `/api/upsrtc/*` route handlers over HTTP — those are gated by the separate PIN-session auth (`requireUpsrtcAccess`), which an ops RBAC user never holds. Instead this module calls the same underlying fetch/normalize/cache building blocks directly, in-process, guarded by the caller's own ops RBAC session.

Real data, correctly authorised — but not sourced from the control service. See finding G5.

#### Graceful degradation

[`DataSourceNotice`](src/components/ops/DataSourceNotice.tsx) renders inline inside `OpsShell`, never replacing the page or throwing. It distinguishes four states and only surfaces the two that represent genuine degradation:

```typescript
if (source === 'live') return null;                  // healthy
if (source === 'cache' && !stale) return null;       // healthy fast path
// stale cache → warning tone;  fixture → error tone
```

---

### 5.11 The LLM copilot

[`src/lib/copilot/`](src/lib/copilot/) — six modules providing incident explanation, shift-report drafting, and natural-language query over operational records.

#### The Anthropic adapter ([`anthropic.ts`](src/lib/copilot/anthropic.ts))

Plain `fetch`, no vendor SDK, matching the repo's existing rule for single-endpoint HTTP integrations.

```typescript
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_TOKENS = 1200;
```

> **Never throws:** every failure mode (missing key, network error, timeout, non-2xx, empty response) is reported back as `{ ok: false, error }` so callers can log it to `ops_copilot_interactions` and surface a clean error instead of a 500.

Missing `ANTHROPIC_API_KEY` yields `503 COPILOT_UNAVAILABLE` rather than a fabricated response.

#### Citations are constructed, not parsed

This is the single best idea in the copilot module:

> the `citations` array returned to the client is **never parsed out of the model's free-text answer**. It is built directly, in this file, from the same evidence records handed to the model — the model can only ever be shown a fixed, enumerated set of facts (each tagged with a stable record id), and **whatever the model writes, the citation list attached to the response is exactly that evidence set**.

The model cannot fabricate a citation, because it never produces one. Evidence lines are pre-formatted with bracketed stable ids:

```
[incident:abc-123] route-direction=… severity=… status=… cause=… started=… members=…
[audit:def-456]    action=… role=… resource=…:… at=… metadata=…
```

#### The system prompt

```
Rules, non-negotiable:
1. Use ONLY the evidence listed under "Evidence" below. Never invent a
   vehicle id, timestamp, incident id, or event that is not listed there.
2. Every factual claim must be traceable to one of the evidence records
   by its bracketed id.
3. If the evidence does not support an answer, say so plainly instead
   of guessing.
4. You never recommend, approve, or imply the execution of an operational
   command (holding a vehicle, short-turning, etc.) — that is a separate,
   human-authorized workflow you have no part in.
5. Be concise and factual. This text may be read by a dispatcher during
   a live shift.
```

#### The command boundary — triple-enforced

The requirement "no code path in the copilot module can call the command-creation/approval service" is enforced three independent ways:

**1. Documentation** — [`grounding.ts`](src/lib/copilot/grounding.ts) states the invariant and names the forbidden module.

**2. ESLint** — [`eslint.config.mjs`](eslint.config.mjs) gains a scoped `no-restricted-imports` block:

```javascript
files: ["src/lib/copilot/**/*.{ts,tsx}", "src/app/api/ops/**/copilot/**/*.{ts,tsx}"],
rules: {
  "no-restricted-imports": ["error", {
    paths: [{ name: "@/lib/auth/rbac/repo", message: "…" }],
    patterns: [{ group: ["**/control-room/commands/route*",
                         "**/dispatcher/approvals/route*",
                         "**/webhooks/dispatch*"], message: "…" }],
  }],
}
```

**3. A source-scanning test** — [`copilotBoundary.test.ts`](src/tests/unit/copilotBoundary.test.ts) reads the module's own source files and asserts the forbidden imports are absent.

The config's own comment explains the redundancy: *"belt and suspenders — either one alone could in principle be disabled by an editor deleting a line, the other would still fail CI."*

#### Rate limiting ([`rateLimit.ts`](src/lib/copilot/rateLimit.ts))

```typescript
const MAX_CALLS_PER_WINDOW = 20;
const WINDOW_MS = 5 * 60 * 1000;
```

> OWASP A06 — "missing rate limits" is otherwise a real gap here: every copilot call spends real Anthropic API budget, so an unbounded loop from one compromised or careless ops session could run up real cost with no guard.

In-memory and per-process, with the limitation acknowledged. Deliberately a separate module from the login limiter because the semantics differ: "failures within a window" vs "calls within a window regardless of outcome".

#### Audit

Every interaction — success or failure — is logged to `ops_copilot_interactions`, which is append-only by trigger, exactly like `ops_audit_log`.

---

### 5.12 The driver PWA

The `/ops/pilot-driver` surface is a full offline-capable Progressive Web App.

#### Assets

```
public/pilot-driver-sw.js                    183 lines, root-served
public/pilot-driver/manifest.webmanifest
public/pilot-driver/icon-192.png
public/pilot-driver/icon-512.png
public/pilot-driver/icon-512-maskable.png
```

The service worker is served from the **origin root**, not from `/pilot-driver/`, and the file explains exactly why:

> a service worker's registrable scope defaults to its own script's directory, and only a root-served script can claim a scope elsewhere on the origin without a `Service-Worker-Allowed` response header.

It registers with `scope: '/ops/pilot-driver/'` from [`PwaRegister.tsx`](src/components/ops/pilot-driver/PwaRegister.tsx).

#### Two responsibilities

1. **Shell caching** — network-first with cached fallback, over `SHELL_CACHE` and `RUNTIME_CACHE`. Install is best-effort: an unauthenticated install (before first login) cannot cache the driver page, and the code handles that rather than failing.

2. **Ack outbox flush** — a `sync` event handler reads the same IndexedDB database as the client module, so a queued ack is retried **even if no tab is open** when connectivity returns.

#### The offline ack queue ([`src/lib/pilotDriver/ackQueue.ts`](src/lib/pilotDriver/ackQueue.ts))

```typescript
export const ACK_QUEUE_DB_NAME = 'pilot-driver-command-queue';
export const ACK_QUEUE_STORE = 'ack-outbox';
```

A tap on ACK/UNABLE/UNSAFE writes to IndexedDB **before** attempting the network call, so the ack is durable across a page reload or dropped connection even if the fetch never completes.

#### The security detail worth highlighting

```typescript
export interface QueuedAck {
  commandId: string;
  // No `vehicleId` here (and none is sent to the ack endpoint) — the server
  // derives the vehicle from the caller's own session/ops_users row,
  // never from client-supplied data. Keeping it out of the queued/sent
  // payload means there is no client-controlled field left that could
  // affect which vehicle's command gets acked.
  outcome: 'accept' | 'unable' | 'unsafe';
  reason: string | null;
  queuedAt: string;
}
```

This is the fix for the **A01 vulnerability** (OWASP Broken Access Control). Prior to commit #23, `GET /api/ops/pilot-driver/commands` and the ack endpoint trusted a client-supplied `vehicleId` with no check that the calling driver was assigned that vehicle — **any `pilot_driver` account could pass an arbitrary `?vehicleId=` and observe or acknowledge another vehicle's commands.**

The fix, in [`src/app/api/ops/pilot-driver/commands/route.ts`](src/app/api/ops/pilot-driver/commands/route.ts):

```typescript
const user = await getOpsRepo().findUserById(guard.claims.sub);
if (!user || !user.vehicleId) {
  return errorResponse('VEHICLE_NOT_ASSIGNED',
    'No vehicle is assigned to your account yet. Contact your admin.', 409);
}
const command = await fetchActiveCommandForVehicle(user.vehicleId);
```

The vehicle is read from the caller's **own** `ops_users` row, set only by an admin. A client-supplied `vehicleId` is no longer accepted at all. The distinct `409` (rather than an empty `200`) lets the client show "contact your admin" instead of polling forever.

**Note:** commit #26's title says "A01 gap still open" — that referred to the `CommandConsole` UI still reading a locally-remembered registration at the time. The server-side hole is closed.

---

## 6. Cross-cutting security posture

### Enforcement mechanisms, ranked by strength

| Mechanism | Where used | Bypassable by app bug? |
|---|---|---|
| **Database constraint** | `dispatcher_action_id` NOT NULL + UNIQUE | **No** |
| **Database trigger** | `consume_dispatcher_action`, audit-log immutability, auto-audit | **No** |
| **Unique partial index** | one active command per vehicle | **No** |
| **Lint rule** | copilot import boundary | Only by editing config (CI catches) |
| **Source-scanning test** | copilot import boundary | Only by editing test (review catches) |
| **Route handler guard** | `requireOpsRole()` on all 31 endpoints | Yes, if omitted |
| **Edge middleware** | role-by-segment gate | Yes, matcher mistakes |

The pattern is consistent and correct: **the deeper the consequence, the closer to the database the enforcement sits.**

### Append-only logs

Three tables are immutable at the database level, via `BEFORE UPDATE` and `BEFORE DELETE` triggers that unconditionally `raise exception`:

- `ops_audit_log`
- `ops_copilot_interactions`
- `command_audit_log`

The rationale is stated in the migration: *"this app has a single connection role (no per-role Postgres grants are wired up yet), so UPDATE/DELETE are blocked with a trigger rather than relying solely on application code never issuing them."*

### Secrets handling

| Secret | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | **browser** | Public by design; RLS is the control |
| `SUPABASE_SERVICE_ROLE_KEY` | server, script-only | Never imported by a request-serving route handler |
| `OPS_SESSION_SECRET` | server | ≥32 chars enforced at read time |
| `CONTROL_SERVICE_SERVICE_TOKEN` | server | Never reaches the browser |
| `ANTHROPIC_API_KEY` | server | Never logged; documented in the adapter's doc comment |
| `SERVICE_TOKEN_SECRET` (CS) | control-service | Timing-safe compared |
| `WEBHOOK_HMAC_SECRET` (CS) | control-service | HMAC-SHA256 over `timestamp.body` |

### Fail-closed behaviour

Every optional dependency degrades to a refusal rather than a silent fallback:

| Missing | Result |
|---|---|
| `NEXT_PUBLIC_SUPABASE_*` | `503 Authentication is not configured.` — without naming which var |
| `OPS_DATABASE_URL` | `503` on every ops route; **no in-memory fallback** |
| `CONTROL_SERVICE_BASE_URL` | Dashboard renders "control service unavailable" state |
| `ANTHROPIC_API_KEY` | `503 COPILOT_UNAVAILABLE` |
| `WEB_APP_WEBHOOK_URL` | Deliveries logged and skipped (**not thrown**) — see G3 |

### Attack surfaces closed relative to `main`

1. **Shared credential eliminated.** One PIN for the whole project → per-person accounts with attribution.
2. **A01 vehicle-scoping hole closed.** Client-supplied `vehicleId` no longer accepted (§5.12).
3. **Open deep-link fallback fixed.** `sanitizeNext()` allowlist widened.
4. **dotenv `$`-expansion footgun eliminated** along with `PROJECT_PIN_HASH`.
5. **Invite token exposure minimised.** Digest-only storage, opt-in URL reveal, rotation on resend.

---

## 7. Testing and CI

### Coverage growth

| | `main` | `dev` |
|---|---:|---:|
| Test files | 8 | **60** |
| Test cases | ~237 | **~590** |
| Web unit tests (`src/tests/`) | ~224 | ~370 |
| E2E specs (`tests/e2e/`) | 25 | ~30 |
| control-service tests | 0 | **~199** |

### New web unit suites (22 files)

`control.test.ts` (414 lines — the shared Zod contract), `opsDashboards.test.tsx` (543 lines), `rbac.test.ts`, `copilotBoundary.test.ts`, `copilotPrompts.test.ts`, `copilotAnthropic.test.ts`, `copilotRateLimit.test.ts`, `controlServiceClient.test.ts`, `controlServiceFreshness.test.ts`, `fleetData.test.ts`, `fleetView.test.ts`, `headwayCountdown.test.ts`, `inviteEmail.test.ts`, `observabilityData.test.ts`, `pilotData.test.ts`, `pilotDriverCommandCopy.test.ts`, `pilotDriverCommandsClient.test.ts`, `pilotDriverVehicleAssignment.test.ts`, `opsApprovalQueueAndKillSwitches.test.tsx`, `opsApprovalQueueHelpers.test.ts`.

### New control-service suites (32 files)

Split across `test/` (integration-flavoured: `commandLifecycleDb`, `commandLifecycleRoutes`, `mpcSolver` at 302 lines, `pilotRolloutGate`, `dispatcherActionEnforcement`, `rehydrate`, `serviceToken`, `webhookSign`, `webhookDispatch`, `tspEligibility`, `simulation/*`) and `tests/` (unit: `estimator` at 216 lines, `kalmanFilter`, `mapMatching`, `ordering`, `confidence`, `geometry`, `stopStateClassifier`, `headway/metrics`, `headway/bunching`, `service`, `repository`).

The two-directory split (`test/` vs `tests/`) appears to be accidental — an artifact of different tickets creating different conventions.

### Test infrastructure changes

**`vitest.config.ts`** gains a `server-only` stub alias:

```typescript
// Next.js resolves 'server-only' via its own build-time alias with no
// npm package needed; vitest runs on plain Vite, which has no such
// alias, so point it at a no-op stub instead.
'server-only': path.resolve(__dirname, './src/tests/stubs/server-only.ts'),
```

Plus `setupFiles: ['src/tests/setup.ts']` for `@testing-library/jest-dom` matchers and per-test `cleanup()`.

**New devDependencies:** `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@types/pg`, `@types/three`.

### The live E2E spec

[`tests/e2e/pilot-driver-command.spec.ts`](tests/e2e/pilot-driver-command.spec.ts) (407 lines) is the most ambitious test in the branch — a full authenticated loop covering command creation, delivery, polling, driver response, ack landing in *both* audit logs, the offline queue, and TTL expiry via both the client countdown and the server sweep.

It requires six environment variables and **skips (does not fail) when any is unset**, mirroring the existing `E2E_PROJECT_PIN` convention. It is therefore **never exercised in CI**.

Its setup comment contains the branch's most important admission — see finding G3:

> There is **no REST endpoint anywhere in this repo that creates a `dispatcher_actions` approval or a `vehicles` row** … so seeding one directly is the only way to exercise "create a command via control-service" at all, exactly as a human verifying this by hand would have to.

### CI workflows

**`.github/workflows/ci-web.yml`** — triggers on PR to `main`/`dev` (ignoring `control-service/**`, `docs/**`, `**/*.md`) and on push. Steps: checkout → pnpm 10.29.3 → Node 20 → `install --frozen-lockfile` → lint → typecheck → test → build. Build receives `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `SENTRY_DSN` from repo secrets so a CI build hits the same failures a real deploy would.

**`.github/workflows/ci-control-service.yml`** — path-scoped to `control-service/**`. Contains a "Detect application scaffold" step that gates all subsequent steps on the existence of `control-service/package.json`. That guard was written when the directory held only SQL; it is now always true. The workflow header comment describing that state is stale (finding G6).

Neither workflow runs Playwright.

---

## 8. Build and tooling changes

### Package manager: npm → pnpm

```diff
+ "packageManager": "pnpm@10.29.3",
- package-lock.json          (deleted, −11,549 lines)
+ pnpm-lock.yaml             (added,   +8,089 lines)
+ control-service/pnpm-lock.yaml (added, +3,722 lines)
```

Commit #6 was dedicated to reconciling the conflicting lockfiles. Every documentation reference to `npm run …` was rewritten to `pnpm run …` across the README.

### New runtime dependencies

| Package | Purpose |
|---|---|
| `@supabase/ssr` ^0.12.4 | Cookie-adapter Supabase client for Next.js |
| `@supabase/supabase-js` ^2.112.2 | Supabase Auth |
| `pg` ^8.22.0 | Postgres driver for the ops datastore |

### Script changes

```diff
- "generate-pin-hash": "node scripts/generate-pin-hash.mjs"
+ "create-project-user": "node scripts/create-project-user.mjs"
+ "seed-ops-admin": "node scripts/seed-ops-admin.mjs"
```

### An unexplained change

```diff
- "build": "next build",
+ "build": "sh -c 'next build'",
```

This wrapping is not documented anywhere in the branch. It is almost certainly a workaround for a shell/environment quirk in the agent's execution sandbox rather than a deliberate project decision. It is harmless but should be reverted before merge unless someone can name the problem it solves.

### `tsconfig.json`

```diff
  "exclude": ["node_modules", "tests/e2e", ".next",
+   "control-service"
  ]
```

Enforces the boundary at the typechecker level — the Next.js build cannot see control-service source at all.

### `.env.example`

New at the repo root (41 lines), sectioned to match README sections, covering Supabase, Google Maps, site config, control-service integration, ops RBAC, and the copilot. `control-service/.env.example` is separate (31 lines).

---

## 9. Gap analysis — critical findings

These are ordered by consequence.

### G1 — Duplicate migration with contradictory security semantics 🔴

**Files:**
- [`db/migrations/20260806180000__ops_users_vehicle_assignment.sql`](db/migrations/20260806180000__ops_users_vehicle_assignment.sql) — added by commit #23 (`dc907e1`)
- [`db/migrations/20260806200000__ops_users_vehicle_assignment.sql`](db/migrations/20260806200000__ops_users_vehicle_assignment.sql) — added by commit #29 (`13f8a95`, the branch tip)

Both add `ops_users.vehicle_id`. Because both use `add column if not exists`, nothing crashes. But they were written from **opposite premises**, and the later file's `comment on column` overwrites the earlier one's.

**The 180000 migration (security fix for A01):**

> Nullable and admin-set only: a driver never sets their own `vehicle_id` … callers must treat null as "no vehicle assigned yet", **not fall back to trusting client input**.

**The 200000 migration:**

> Nullable: most rows will have no assignment until an admin sets one. **Every read site must keep falling back to the pre-existing self-report convention when this is null**, so a not-yet-assigned driver is never blocked from using their dashboard.

Migration `200000` sorts **after** `180000`, so after a full migration run the surviving column comment is the permissive one. Anyone reading the schema will be told the opposite of what the security-critical code path actually does.

The code reflects both premises, split by surface:

| Surface | Behaviour |
|---|---|
| `GET /api/ops/pilot-driver/commands` | **Fail closed** — `409 VEHICLE_NOT_ASSIGNED` |
| `POST /api/ops/pilot-driver/commands/[id]/ack` | **Fail closed** |
| `DriverDashboard` schedule lookup | **Falls back** to self-reported registration |
| `BreakdownReportPanel` | **Falls back** to self-reported registration |

That split may be defensible — a schedule lookup is a read with far lower stakes than acknowledging a hold command. But it is *not* the result of a documented decision; it is the result of two agents solving the same problem independently. Additionally, `200000` **does not re-add `ops_invites.vehicle_id`**, which only `180000` creates — so the invite-time assignment path depends entirely on the earlier file being applied.

**Recommended fix:** delete `20260806200000`, port its one genuinely new artifact (`ops_users_vehicle_id_idx`) into a new correctly-timestamped migration, and make an explicit, documented decision about the fallback policy per surface.

---

### G2 — Migration timestamp collision 🟠

Two files share the timestamp `20260806160000`:

- `db/migrations/20260806160000__ops_approval_queue_and_kill_switches.sql` (commit #27)
- `db/migrations/20260806160000__ops_pilot_driver_role.sql` (commit #21)

With a stated "apply in filename order" convention and **no migration runner**, ordering falls to a lexicographic tiebreak on the description suffix (`ops_approval…` < `ops_pilot…`). It happens to be deterministic and it happens to work — the two files touch disjoint objects. It is not something to rely on, and it will silently break the day two colliding migrations do touch the same object.

---

### G3 — The command-creation path is architecturally disconnected 🔴

**This is the most consequential gap in the branch.**

The dispatcher-authorization invariant requires that every control-service command reference a valid, unconsumed row in **`control-service`'s `dispatcher_actions` table**.

The web app's approval workflow writes to **`ops_dispatcher_actions` in the web app's own, entirely separate database.**

There is **no code anywhere on the branch that replicates a web-side approval into the control-service datastore.** The two id-spaces are unrelated. `POST /api/ops/control-room/commands` writes an audit row and stops — it never calls the control service. Its own doc comment says so:

> Actually dispatching the command to the control service is out of scope — no control-service REST client exists yet.

And `src/lib/controlService/client.ts` confirms:

> POST `.../ack`, which never carries a `dispatcherActionId` (only `POST /v1/commands` does, and **no route in this app calls that yet**).

The control-service side names the problem without solving it, in [`gate.ts`](control-service/src/pilot/gate.ts):

> `dispatcher_actions.route_direction_id` is populated by the web app when the approval is created (`ops_dispatcher_actions.route_direction_id` on the web side, **correlated only across the REST boundary per the Crewban-4/Crewban-9 handoffs, never a shared foreign key**).

That correlation mechanism does not exist. The E2E test works around it by seeding `dispatcher_actions` with raw SQL against the control-service database, and says so explicitly (§7).

**Net effect:** the web app can record approvals and the control service can enforce them, but a real approval cannot authorize a real command. **A complete, human-authorised, end-to-end command cannot be issued through the product.**

**Related sub-gap:** the **webhook return leg does not exist either.** `control-service/src/webhooks/dispatch.ts` HMAC-signs, retries with exponential backoff (3 attempts, 250 ms base, retryable on 408/429/5xx), and POSTs to `WEB_APP_WEBHOOK_URL` — documented as `https://<web-app>/api/control-service/webhook`. **No such route exists in `src/app/api/`, and the header `x-control-service-signature` appears nowhere in `src/`.** When the URL is unset, deliveries are *logged and skipped, not thrown* — so this fails silently rather than loudly.

---

### G4 — No GPS ingestion endpoint 🔴

The state-estimation library is real, tested, and writes `vehicle_states` via [`repository.ts`](control-service/src/state-estimation/repository.ts). But **no HTTP route calls `processPositionEvent()`**. The 22 registered endpoints cover health, commands, vehicle-state *reads*, MPC, headway, and pilot — none ingests position data.

Consequences:

- The in-memory `stateStore` is populated **only** by boot-time `rehydrate()` and never refreshed.
- `GET /v1/vehicle-states` and `POST /v1/mpc/solve` operate on a snapshot frozen at process start.
- The headway module works around this by bypassing the store and querying Postgres on every call — but *nothing writes fresh rows to Postgres either*.

The system has a complete decision-making brain and no sensory input. The README is honest about this; it is nonetheless the second thing that must be built.

---

### G5 — Ops dashboards do not consume the control service 🟡

[`fleetData.ts`](src/lib/ops/fleetData.ts) sources dashboard data from the pre-existing UPSRTC upstream, not from the control service. This is a reasonable interim decision (documented, and correctly re-authorised under the ops session rather than the project session), but it means the control service's headway metrics, incidents, and KPIs reach the UI only through the narrower `/ops/control-room/observability` and `/ops/control-room/pilot` surfaces — and even those depend on data that G4 prevents from being fresh.

---

### G6 — Stale documentation and comments 🟡

Several documents describe a state of the world that later commits invalidated:

| Location | Claims | Reality |
|---|---|---|
| [`docs/CONTROL_SERVICE_DEPLOYMENT.md`](docs/CONTROL_SERVICE_DEPLOYMENT.md) "Blocker (read this first)" | *"no server entrypoint, no `Dockerfile`, no `/healthz` or `/readyz` handler, no MPC solver, no REST ingestion endpoint or webhook layer"* | All except ingestion and webhook-receipt shipped in commit #10. Doc last touched at #14. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | *"If an always-on control service … is introduced … **Nothing described there is implemented yet.**"* | 69 source files, 26 tables, 22 endpoints. |
| `.github/workflows/ci-control-service.yml` header | *"control-service currently ships only SQL migrations … there is no application scaffold"* | Scaffold has existed since #10; the detection step is now always true. |
| [`src/lib/auth/rbac/config.ts`](src/lib/auth/rbac/config.ts) | *"SEPARATE cookie name and SEPARATE secret from the pitch-demo PIN session (`src/lib/auth/config.ts`, `SESSION_COOKIE`/`SESSION_SECRET`) … The PIN system's own config file is untouched by this ticket."* | That file was **deleted** in commit #24. |
| [`src/lib/auth/rbac/roles.ts`](src/lib/auth/rbac/roles.ts) | *"same rule as `src/lib/auth/config.ts` for the PIN system"* | Same. |
| [`src/lib/ops/fleetData.ts`](src/lib/ops/fleetData.ts) | *"gated by the separate PIN-session auth (`requireUpsrtcAccess`)"* | Now Supabase-gated. |
| [`src/lib/pilotDriver/ackQueue.ts`](src/lib/pilotDriver/ackQueue.ts) | references `public/pilot-driver/sw.js` | File is at `public/pilot-driver-sw.js` (root-served, for the scope reason the SW itself documents) |
| [`docs/olympuss/RBAC.md`](docs/olympuss/RBAC.md) | *"shorter than the PIN session's 8h"* | PIN session no longer exists |

None of these break anything. Collectively they will mislead the next person to open the repo, and the deployment "Blocker" section is actively misleading about what remains to be done.

---

### G7 — Nothing is deployed 🟡

`render.yaml` is complete but not connected to a Render account or team. All `sync: false` secrets are unset. No migration runner is wired for either datastore. `docs/PRODUCTION_ROADMAP.md`'s Phase 0 gate — no production or pilot traffic without UPSRTC authorization — remains in force regardless.

---

### G8 — Minor items 🟢

- **`test/` and `tests/` coexist** in `control-service/` with no distinction beyond which ticket created them.
- **`"build": "sh -c 'next build'"`** is undocumented (§8).
- **The E2E suite never runs in CI** — it skips silently when its six env vars are unset, so the branch's most valuable integration test provides zero automated signal.
- **In-memory rate limiters** (login, copilot) are per-process and will not hold on multi-instance serverless deployment. Both files acknowledge this.
- **Circuit-breaker state is per-process** with the same caveat.

---

## 10. Risk register

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | End-to-end command flow cannot execute (G3) | **Critical** | Certain | Build the approval-replication bridge + webhook receiver before any pilot |
| R2 | No live data input (G4) | **Critical** | Certain | Build the GPS ingestion endpoint; wire `processPositionEvent()` |
| R3 | Migration duplication corrupts the documented security contract (G1) | **High** | Certain | Delete `20260806200000`; document the per-surface fallback decision |
| R4 | Migration ordering breaks on the next collision (G2) | Medium | Likely | Adopt a migration runner (dbmate / node-pg-migrate) |
| R5 | Stale docs mislead the next engineer (G6) | Medium | Certain | Doc sweep before merge — especially the DEPLOYMENT "Blocker" section |
| R6 | Rate limiters ineffective on multi-instance hosting (G8) | Medium | Likely at scale | Move to Redis or an edge rate limiter before pilot |
| R7 | E2E suite silently skips, giving false confidence (G8) | Medium | Certain | Provision CI service containers, or fail loudly on missing env in a dedicated job |
| R8 | Two auth systems double the surface to maintain | Low–Medium | — | Documented and deliberate; revisit if Supabase gains adequate RBAC |
| R9 | Agent-generated code volume exceeds human review capacity | **High** | — | 30 k lines across 26 tickets — budget real review time, especially on the SQL |

---

## 11. Merge readiness assessment

### What is genuinely production-grade

- **Database-enforced safety invariants.** Approval consumption, one-active-command-per-vehicle, TTL expiry, and audit immutability are all enforced by Postgres. Application bugs cannot bypass them.
- **The trigger-written audit log.** Reconstructable even from direct SQL fix-ups.
- **The copilot boundary.** Triple-enforced (docs + lint + source-scanning test), with citations constructed rather than parsed.
- **The safety filter's transparency.** Rejections returned *and* logged, never dropped.
- **The simulator's regression gate.** Guardrails checked against outcomes, not against controller self-reports.
- **The A01 fix.** Server-derived vehicle scoping with no client-controlled field remaining.
- **Documentation density.** Nearly every non-obvious decision carries an inline rationale referencing the blueprint section it implements, and rejected alternatives are recorded.

### What blocks a merge to `main`

Nothing, strictly — it is a clean fast-forward and `main` is not a deployed production branch. But merging as-is would put `main` in a state where:

1. The advertised end-to-end capability does not work (G3, G4).
2. The schema's own documentation contradicts the code's security behaviour (G1).
3. Three core documents describe a system state that is two weeks out of date (G6).

### Recommended sequence before merge

| Priority | Action |
|---|---|
| 1 | **Resolve G1** — delete the duplicate migration, port the index, decide and document the fallback policy per surface |
| 2 | **Doc sweep (G6)** — rewrite the DEPLOYMENT "Blocker", update ARCHITECTURE, purge PIN-system references from comments |
| 3 | **Fix G2** — re-timestamp one of the colliding migrations |
| 4 | **Revert** `"build": "sh -c 'next build'"` unless someone can justify it |
| 5 | **Human review of all SQL** — 34 tables of agent-generated schema warrants a careful read, particularly the trigger logic |

### Recommended sequence before any pilot

| Priority | Action |
|---|---|
| 1 | **Build the GPS ingestion endpoint** (G4) — the system has no input without it |
| 2 | **Build the approval-replication bridge** (G3) — web `ops_dispatcher_actions` → control-service `dispatcher_actions` |
| 3 | **Build the webhook receiver** (`POST /api/control-service/webhook`) with HMAC verification and replay protection |
| 4 | **Adopt a migration runner** for both datastores |
| 5 | **Connect `render.yaml`** to a real account; set the `sync: false` secrets |
| 6 | **Make the E2E suite run** in CI with service containers |
| 7 | **Move rate limiting** off in-process memory |
| 8 | **Security review sign-off** — required by the integration contract's own §5 pre-merge gate |

---

## Appendix A — Local environment note

The working tree's `node_modules` is **npm-installed from `main`'s `package-lock.json`**, which `dev` deletes in favour of `pnpm-lock.yaml`. As a result, on `dev` right now:

- `npx vitest run` → **all 27 test files fail to load** (`Failed to resolve import "@testing-library/jest-dom/vitest"`)
- `npx tsc --noEmit` → **20 errors**, all `Property 'toHaveValue'/'toBeInTheDocument'/'toHaveTextContent' does not exist on type 'Assertion<any>'`

Both are **environment artifacts, not branch defects** — they trace entirely to `@testing-library/jest-dom` being absent from a `main`-era install. Before evaluating test health:

```sh
pnpm install                        # repo root
cd control-service && pnpm install  # has no node_modules at all
```

The suites were **not verified as passing** in this analysis; only their existence, size, and content were examined.

## Appendix B — Reproducing this analysis

```sh
git merge-base main dev                        # → f2f240b (tip of main)
git rev-list --count main..dev                 # → 26
git rev-list --count dev..main                 # → 0
git diff --stat main..dev | tail -1            # → 328 files, +42406/-12105
git diff --numstat main..dev | grep -v lock \
  | awk '{a+=$1; d+=$2} END {print a, d}'      # → 30595 556
git diff --name-status main..dev | awk '{print $1}' | sort | uniq -c
```
