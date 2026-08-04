# Olympuss AI — Unified Application

One Next.js application serving three surfaces from a single deployment and a
single auth system on one domain (**olympuss.us**):

| Route | Access | What it is |
| --- | --- | --- |
| `/` | Public | Cinematic Olympuss AI landing experience — WebGL golden globe, six narrative scenes, static CSS fallback |
| `/login` | Public | Project authentication (project name + PIN) |
| `/project/upsrtc` | **Protected** | The UPSRTC AI Copilot — a predictive fleet command centre over live UPSRTC telemetry |
| `/api/auth/{login,logout,session}` | Mixed | Authentication endpoints |
| `/api/upsrtc/{live,schedule}` | **Protected** | Server-side proxies to the UPSRTC upstream |
| `/robots.txt`, `/sitemap.xml` | Public | Crawler policy — homepage only |

This repository is independent of the original prototype repository and uses its
own GitHub remote.

---

## Contents

1. [Read this first — data provenance](#1-read-this-first--data-provenance)
2. [Quick start](#2-quick-start)
3. [Environment variables](#3-environment-variables)
4. [Repository layout](#4-repository-layout)
5. [Application architecture](#5-application-architecture)
6. [Authentication — full implementation](#6-authentication--full-implementation)
7. [UPSRTC data pipeline — full implementation](#7-upsrtc-data-pipeline--full-implementation)
8. [Canonical data model](#8-canonical-data-model)
9. [The command centre — surface by surface](#9-the-command-centre--surface-by-surface)
10. [The predictive engine](#10-the-predictive-engine)
11. [The alert stream](#11-the-alert-stream)
12. [Driver communication workflow](#12-driver-communication-workflow)
13. [Audit trail](#13-audit-trail)
14. [Pitch Mode](#14-pitch-mode)
15. [The public landing experience](#15-the-public-landing-experience)
16. [The WebGL globe](#16-the-webgl-globe)
17. [Design system and style isolation](#17-design-system-and-style-isolation)
18. [Security](#18-security)
19. [Performance decisions](#19-performance-decisions)
20. [Testing](#20-testing)
21. [Build and deployment](#21-build-and-deployment)
22. [Scripts reference](#22-scripts-reference)
23. [Troubleshooting](#23-troubleshooting)
24. [Data-labelling rules](#24-data-labelling-rules)
25. [Safety disclaimer](#25-safety-disclaimer)
26. [Further documentation](#26-further-documentation)

---

## 1. Read this first — data provenance

> **Vehicle positions and schedules are live UPSRTC data.**
>
> Alerts, forecasts, recommendations, traffic conditions, breakdowns and
> communication events are **model projections** — not confirmed operational
> events.
>
> - **No driver is contacted.**
> - **No operational instruction is executed automatically.**
> - **Production deployment requires formal authorization and backend integration.**

Live data carries a green `LIVE UPSRTC GPS` badge. Model-derived surfaces carry
a `PREDICTIVE` marker. The distinction is enforced in code, not left to
discipline — see [Data-labelling rules](#24-data-labelling-rules).

| LIVE (green badge) | PREDICTIVE (teal marker) |
| --- | --- |
| Vehicle positions, speed, heading | Headway projections and bunching risk |
| Ignition, GPS timestamp, status | Traffic congestion, severity, alternative routes |
| Depot, route name and description | Breakdowns, rescue candidates, response times |
| Registration numbers | Passenger counts and demand forecasts |
| Origin, destination, stop sequence | Fleet redistribution plans |
| Scheduled departure and arrival | AI confidence, observations, recommendations |
| Data-quality classification | Driver messages, acknowledgements, voice calls |
| Fleet counts | All before/after and projected-impact figures |

**Not used at runtime, even where credentials exist:** Google Routes API,
Google `TrafficLayer`, any live traffic source, any LLM API, any SMS / push /
VoIP provider. Every "AI" line in the interface is a local template string; the
scenario numbers come from a seeded PRNG, not a model server.

The definitive field-by-field breakdown is in
[`docs/LIVE_VS_PREDICTED.md`](docs/LIVE_VS_PREDICTED.md).

---

## 2. Quick start

**Prerequisites:** Node.js 20+ and npm.

```bash
npm install

# 1. Generate a bcrypt hash for the project PIN (prints the hash to stdout).
npm run generate-pin-hash -- <pin>

# 2. Create the local environment file and fill in the values.
cp .env.example .env.local

# 3. Run.
npm run dev            # http://localhost:3000
```

**If `.env.local` already exists, do not overwrite it.**

When pasting `PROJECT_PIN_HASH` into `.env.local`, escape every `$` in the hash
as `\$` — dotenv treats `$` as variable expansion and will silently corrupt the
value. Host environment UIs (Vercel etc.) store it literally, so paste it
unescaped there. `generate-pin-hash` prints this reminder to stderr so stdout
stays a clean, pipeable hash.

Optional, only when the source logo art changes:

```bash
npm run process-logo   # regenerate every brand asset from the source logo
```

Production:

```bash
npm run build
npm run start
```

---

## 3. Environment variables

`.env.example` documents the shape with no real values. No private variable is
exposed to the browser and no key is ever printed.

| Variable | Required | Scope | Purpose |
| --- | --- | --- | --- |
| `PROJECT_NAME` | yes | server | The project name accepted at `/login`. Also the single source of truth for "is this session authorized" — matched case-insensitively and trimmed. |
| `PROJECT_PIN_HASH` | yes | server | bcrypt hash (cost 12) of the project PIN. The plaintext PIN appears nowhere in source. |
| `SESSION_SECRET` | yes | server | HS256 signing secret for session tokens. Must be ≥ 32 characters (`openssl rand -base64 48`). |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | yes | **browser** | Renders the Google basemap. Public by design — restrict it by HTTP referrer and to the Maps JavaScript API. |
| `SITE_URL` | no | server | Canonical origin for metadata, canonical URL, sitemap. Defaults to `https://olympuss.us`. |
| `UPSRTC_LIVE_URL` | no | server | Overrides the live GPS endpoint. |
| `UPSRTC_SCHEDULE_URL` | no | server | Overrides the schedule endpoint. |
| `NEXT_PUBLIC_DEMO_MODE` | no | browser/server | Set to `1` to force offline fixture mode for presentations without connectivity. |

Present in some environments but **intentionally unused**:
`GOOGLE_ROUTES_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.

Missing auth configuration fails closed: `getConfiguredProjectName()`,
`getProjectPinHash()` and `getSessionSecret()` throw `AuthConfigError`, the
login route answers `503 Authentication is not configured.` without naming
which variable is missing, and `isAuthorizedProject()` returns `false` rather
than throwing so every guard denies uniformly.

---

## 4. Repository layout

```
src/
├── app/
│   ├── layout.tsx                    # root: dashboard font vars, site metadata, OG/Twitter
│   ├── globals.css                   # dashboard HUD primitives (@layer components)
│   ├── icon.png / apple-icon.png     # favicons, generated by scripts/process-logo.mjs
│   ├── robots.ts / sitemap.ts        # crawler policy — public homepage only
│   ├── (public)/
│   │   ├── layout.tsx                # Olympuss fonts + .ol-scope tokens (landing/login only)
│   │   ├── olympuss.css              # landing design system (scoped)
│   │   ├── page.tsx                  # landing composition (6 sections)
│   │   └── login/page.tsx            # split-screen auth surface
│   ├── (protected)/
│   │   └── project/upsrtc/
│   │       ├── layout.tsx            # server session gate + scoped dashboard shell
│   │       └── page.tsx              # <CommandCenter/>
│   └── api/
│       ├── auth/{login,logout,session}/route.ts
│       └── upsrtc/{live,schedule}/route.ts
├── middleware.ts                     # edge auth: redirect pages / 401 APIs
├── models/canonical.ts               # Zod schemas + types for LIVE data only
├── lib/
│   ├── auth/                         # config, session, server, authorize, password,
│   │                                 #   origin, rate-limit, redirect
│   ├── upsrtc/                       # client, normalizer, cache, respond
│   ├── simulation/                   # scenarioEngine, seededRandom
│   ├── demo-scenarios/               # bunching, traffic, breakdown, demand,
│   │                                 #   communication, impact, types
│   ├── alerts/alertEngine.ts         # predictive alert feed
│   ├── audit/auditLog.ts             # localStorage audit trail + exports
│   ├── constants/, formatters/, utils.ts
├── stores/copilotStore.ts            # single Zustand store for the dashboard
├── hooks/                            # useLiveFleet, useSchedule, useAlertStream,
│                                     #   useFleetDistribution, useIndiaClock,
│                                     #   useDebounced, useReducedMotion
├── components/
│   ├── landing/                      # public landing sections + backdrop + reveal
│   ├── auth/, upsrtc/                # login form, authenticated actions, sign out
│   ├── command-center/               # shell, top bar, intelligence strip, error banner
│   ├── live-fleet/, map/             # fleet list, Google map + canvas layer + overlays
│   ├── alerts/, ai-core/             # alert centre + toasts, copilot panel + core
│   ├── bus-details/, scenarios/      # vehicle drawer, scenario stage + 4 analyses, lab
│   ├── communication/                # driver message modal, VoIP overlay
│   ├── audit/, diagnostics/, impact-dashboard/, pitch-mode/
│   └── shared/                       # hud.tsx primitives, footer disclaimer, brand marks
├── three/                            # WebGL: ExperienceCanvas, Scene, quality, sceneState
│   └── globe/                        # Globe, geo, arcs, orbits, landData, data/land-110m.json
├── fixtures/                         # sanitized captured upstream payloads
└── tests/unit/                       # Vitest suites

tests/e2e/                            # Playwright command-centre spec
scripts/                              # generate-pin-hash, process-logo, inspect-upsrtc-api
docs/                                 # architecture, API discovery, demo, roadmap, olympuss/
```

---

## 5. Application architecture

### Route groups

Two Next.js route groups do the heavy lifting, and the split is deliberate:

- **`(public)`** loads the Olympuss editorial fonts (Manrope, Cormorant
  Garamond) and applies the `.ol-scope` token wrapper. Because the fonts and
  tokens live in that layout — not the root layout — the protected dashboard
  never downloads them and never inherits the landing palette.
- **`(protected)`** re-establishes the command-centre visual environment (dark
  void, Orbitron display font, cyan text, tabular numerals, no page scroll)
  *scoped to that route only*, so the public landing page keeps scrolling
  natively with its own typography.

The root layout stays neutral: it declares both font families as CSS variables
on `<html>` and lets each group opt in.

### Request flow

```
Browser
  │
  ├─ GET /api/upsrtc/live      every 15s   ─┐
  ├─ GET /api/upsrtc/schedule  on selection ┤ session-gated Route Handlers
  │                                         │ (Node runtime, server-only)
  │                                         ▼
  │                         timeout · tolerant parse · normalize ·
  │                         TTL cache · last-known-good · gzip
  │                                         │
  │                                         ▼
  │                         UPSRTC upstream (margdarshi.upsrtcvlt.com)
  │
  └─ POST /api/auth/login ─▶ bcrypt compare ─▶ signed HttpOnly session cookie
```

The browser **never** contacts the UPSRTC PHP endpoints directly. That keeps
upstream behaviour (misleading content types, ~11.6 MiB payloads, bare-string
error responses) contained on the server, and lets one server fetch serve many
clients from cache.

### Layer responsibilities

| Layer | Location | Responsibility |
| --- | --- | --- |
| Edge auth | `src/middleware.ts` | First-line gate for `/project/*` and `/api/upsrtc/*` |
| Auth core | `src/lib/auth/` | Config, JWT sign/verify, cookie, bcrypt, rate limit, CSRF, redirect sanitization |
| Upstream client | `src/lib/upsrtc/client.ts` | Fetch, timeout, tolerant parse, HTML-error guard |
| Normalizer | `src/lib/upsrtc/normalizer.ts` | Alias resolution, coordinate validation, dedup, trip selection, quality |
| Cache | `src/lib/upsrtc/cache.ts` | TTL + last-known-good retention |
| Response | `src/lib/upsrtc/respond.ts` | JSON + opportunistic gzip |
| Routes | `src/app/api/upsrtc/*` | Orchestration, Zod validation, fallback ladder, diagnostics |
| Models | `src/models/canonical.ts` | Zod schemas and types — **live data only** |
| Predictive engine | `src/lib/simulation/`, `src/lib/demo-scenarios/` | Deterministic scenario templates |
| State | `src/stores/copilotStore.ts` | Single Zustand store |
| Hooks | `src/hooks/` | Polling, schedule fetch, alert stream, clock, debounce |
| UI | `src/components/` | Landing and command-centre surfaces |
| WebGL | `src/three/` | Canvas, scene graph, globe, quality tiers, scene state |

### Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 3 ·
Zustand · Zod · jose · bcryptjs · Framer Motion · Recharts · Radix UI
primitives · Lucide icons · Google Maps JavaScript API · three.js /
@react-three/fiber / drei · GSAP ScrollTrigger · sharp (build-time) · Vitest ·
Playwright · ESLint · Prettier.

---

## 6. Authentication — full implementation

A single project credential (name + PIN) unlocks the protected project area.
There are no user accounts, no database, and no password reset flow.

### Login sequence

1. **Client** — [`LoginForm`](src/components/auth/LoginForm.tsx) POSTs
   `{ projectName, pin }` as JSON to `/api/auth/login`.
2. **Origin check** — `isSameOrigin()` compares the `Origin` header (falling
   back to `Referer`) against the request host. No `Origin` **and** no
   `Referer` on a state change → `403`. This complements the `SameSite=Lax`
   cookie as a best-effort CSRF defence.
3. **Content type** — anything that is not `application/json` → `415`.
4. **Schema** — Zod: `projectName` 1–64 chars, `pin` 1–32 chars. Failure →
   `400` with the same generic message as a bad credential.
5. **Rate limit** — keyed on `clientIp:normalizedProjectName`. 5 failed
   attempts per 15-minute sliding window → `429` with `Retry-After`. Checked
   *before* the bcrypt compare and recorded *after* a failure.
6. **Compare** — the bcrypt comparison **always runs**, even when the project
   name is already known to be wrong, so response timing cannot distinguish
   "wrong name" from "wrong PIN".
7. **Success** — failures are cleared, `establishSession()` signs an HS256 JWT
   (`{ project, role: 'project-access', iat, exp }`) and writes it to the
   `olympuss_session` cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in
   production, `Path=/`, `Max-Age` 8 hours. The response body carries only
   `{ ok: true, project }` — never the token, hash or secret.

Every failure path returns the identical string `Invalid project name or PIN.`

### Defence in depth

Three independent checks guard the protected surface. None trusts the others:

| Check | Where | Behaviour when unauthorized |
| --- | --- | --- |
| Edge middleware | [`src/middleware.ts`](src/middleware.ts) | `/project/*` → redirect to `/login?next=…`; `/api/upsrtc/*` → `401` JSON |
| Server layout | [`(protected)/project/upsrtc/layout.tsx`](<src/app/(protected)/project/upsrtc/layout.tsx>) | `redirect('/login?next=/project/upsrtc')` before any dashboard markup renders |
| API guard | `requireUpsrtcAccess()` in [`src/lib/auth/authorize.ts`](src/lib/auth/authorize.ts) | Every UPSRTC route calls it first and returns `401` on null |

Middleware is **edge-safe by construction**: it imports only `jose` and the
config module. `bcryptjs`, `next/headers` and `server-only` are never pulled
into the Edge bundle. Middleware reads the request cookie directly; Route
Handlers and Server Components use `cookies()` via
[`src/lib/auth/server.ts`](src/lib/auth/server.ts).

`isAuthorizedProject(claims.project)` is the single authorization predicate,
comparing against the normalized `PROJECT_NAME`. It returns `false` rather than
throwing on misconfiguration.

### Open-redirect protection

`sanitizeNext()` accepts a `next` parameter only when it is a root-relative
path under `/project/upsrtc`. Protocol-relative (`//evil.com`), backslash
tricks (`/\evil.com`) and any other target fall back to `/project/upsrtc`.

### Session status and sign-out

- `GET /api/auth/session` returns `{ authenticated }` and, when true,
  `{ project, expiresAt }`. Never the token or any credential configuration.
- `POST /api/auth/logout` re-checks same-origin, clears the cookie
  (`Max-Age=0`), and [`ProjectSignOut`](src/components/upsrtc/ProjectSignOut.tsx)
  hard-navigates to `/login` so the now-unauthenticated client cannot keep
  rendering protected state.

### Known limitation

The rate limiter is in-memory and per-process. On serverless or multi-instance
infrastructure each instance keeps its own counters and cold starts reset them.
It raises the cost of brute force but is **not** a hard guarantee — replace it
with a shared store (Redis / Upstash) before treating it as a real control.
This is stated in the module's own header comment so it cannot quietly be
mistaken for more than it is.

---

## 7. UPSRTC data pipeline — full implementation

Both endpoints are undocumented and were probed empirically — no schema was
assumed. Reproduce the probe yourself:

```bash
npm run inspect:api
```

Observed (full report in [`docs/API_DISCOVERY.md`](docs/API_DISCOVERY.md)):

| | Live GPS | Schedule |
| --- | --- | --- |
| Records | 9,588 buses | 52 stops per trip (145 observed on long routes) |
| Fields | 51 per record | 18 per stop |
| Body size | ~11.6 MiB | small |
| Depots / routes | 143 / 1,194 | — |
| Content type | `text/html` (JSON body) | `text/html` (JSON body) |
| Statuses | `Offline`, `Live`, `Towing`, `Stationary` | — |

### Upstream quirks handled explicitly

1. **`Content-Type` lies.** The body is parsed as JSON regardless of the
   advertised type, guarded by a check that rejects a body starting with `<`
   (a genuine HTML error page) and a `try/catch` that reports malformed JSON
   rather than throwing.
2. **"Bus Not Assigned" is a bare JSON string** returned with HTTP 200 — not an
   error status. `extractArray` yields `[]` for that shape, and the route
   surfaces it as *"No UPSRTC schedule assigned to this vehicle"* rather than a
   crash or a blank panel.
3. **Stop coordinates are often `0.0, 0.0`.** These are normalized to `null`
   and excluded from route polylines — drawing through them would send the
   route into the Atlantic.
4. **The schedule endpoint returns every journey the bus runs that day**, not
   the one it is on, and each trip restarts `stop_sequence` at 1. Nine trips in
   one response is normal. Merging them yields a fictitious journey whose
   origin and destination come from two unrelated services, often reversed — so
   exactly one trip is kept (see below).
5. **Schedules are keyed on the trip's departure date**, not today's calendar
   date. A long-distance service that left at 22:00 is invisible to a "today"
   query for the whole of its second day on the road.
6. **Duplicate `(atco_code, stop_sequence)` pairs** occur inside a single
   journey. Since those ids become React keys, collisions are broken by
   suffixing `#2`, `#3`, …
7. **Ignition frequently reads 0 while the bus is plainly moving.** A vehicle
   reporting road speed is treated as running. Speed can only force ignition
   **on**, never off — a bus idling at a stand still reports honestly.

### `GET /api/upsrtc/live`

Node runtime, `force-dynamic`.

1. `requireUpsrtcAccess()` — independent authorization check.
2. If `NEXT_PUBLIC_DEMO_MODE=1`, serve the normalized fixture immediately.
3. Module-scoped `TtlCache` with a **15-second TTL** — a warm server process
   serves many clients from one upstream fetch.
4. On miss: `fetchUpstream()` with a **10-second timeout** (`AbortController`),
   `cache: 'no-store'`, `Accept: application/json, text/plain, */*`.
5. `normalizeLivePayload()` (below).
6. Cache and return `{ buses, fetchedAt, source, stale, recordCount, rejectedRecordCount }`.
7. **Degrade gracefully, never blank:** last-known-good (flagged `stale`) →
   sanitized fixture. A `liveDiagnostics` object tracks last attempt, last
   success, last error, last status and consecutive failures for the
   Diagnostics drawer.

### `normalizeLivePayload()`

- **`extractArray`** unwraps whatever shape arrives: a bare array, a wrapper
  object under `data` / `result` / `results` / `vehicles` / `buses` / `records`
  / `rows` / `items`, a JSON string nested inside JSON (recursion capped at
  depth 4), or a single record object.
- **Alias-tolerant field resolution.** Every canonical field accepts a list of
  observed upstream names — 12 aliases for registration number alone — so an
  upstream rename does not black out the control room. Empty strings and the
  literals `None` / `null` / `NULL` are treated as absent.
- **Coordinate gate.** Rejects non-finite values, out-of-range latitude or
  longitude, and the exact `(0, 0)` "null island" GPS no-fix sentinel. A valid
  non-zero latitude paired with longitude 0 is accepted.
- **Heading** normalized into `[0, 360)`; **speed** clamped at ≥ 0 and rounded
  to one decimal.
- **Duplicate registrations merged**, keeping the record with the newest GPS
  timestamp.
- **Trip date** extracted textually from `scheduled_start_time`. Upstream
  stamps a `Z` suffix on a value that is already IST, so parsing it through
  `Date` would slide an early-morning departure onto the previous day.
- **Data quality by GPS age:** `good` ≤ 5 min, `degraded` ≤ 30 min, `stale`
  beyond that (or no timestamp).
- Returns `recordCount` and `rejectedRecordCount` alongside the buses so the
  Diagnostics drawer can show raw vs normalized vs rejected.

### `GET /api/upsrtc/schedule?regNum=…&date=…&tripId=…`

Node runtime, `force-dynamic`, Zod-validated query.

- `regNum` must match the UPSRTC registration pattern
  (`^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$`, e.g. `UP77AN2509`).
- `date` optional `YYYY-MM-DD`; `tripId` optional, the live feed's
  `vehicle_journey_id`.
- **15-second timeout**, deliberately longer than the live feed's: a measured
  `" Bus Not Assigned!!! "` comes back in ~0.7 s while a real 145-stop schedule
  takes ~8 s to assemble. A shorter timeout preferentially aborts exactly the
  responses that carry data.
- **Cache TTL 120 s**, keyed `regNum:date:tripId`. The cached value is a
  *wrapper* (`{ schedule, resolvedDate }`) rather than a bare schedule so that
  "this vehicle has no assignment" is itself cacheable — otherwise every
  unassigned bus re-runs the full date fan-out on each selection.
- **Date fan-out.** Candidates are `[requested, today, today−1, today−2]`,
  deduplicated. The requested date is probed first; the remaining candidates
  are probed **concurrently** (sequential probes would stack four timeouts onto
  one click), but the winner is still chosen by candidate priority.
- **Trip selection.** `groupByTrip` buckets rows by journey id; `selectTrip`
  prefers the live `tripId` and otherwise falls back to the earliest-departing
  trip — stable, rather than dependent on upstream row order.
- **Origin/destination.** Taken from the first and last stop, but overridden by
  a `route_description` of the form `A TO B VIA C`, which gives better labels.
- **Direction** is read from the `_IN` / `_OUT` suffix on the route name.
- Fallback ladder mirrors the live route: last-known-good → fixture.

### `TtlCache`

A deliberately small class holding two maps:

- **`fresh`** — within TTL, safe to serve directly.
- **`lastGood`** — the most recent successful value, served flagged `stale`
  when upstream is unavailable, so the control room never goes blank.

It also exposes `ageMs()` for the Diagnostics drawer.

### `jsonResponse()` — opportunistic gzip

Next's `compress: true` does not apply to Route Handlers, and the live fleet
payload is ~3.8 MB of JSON on a 15-second poll. Responses ≥ 32,768 bytes are
gzipped when the client sent `Accept-Encoding: gzip`, with
`Vary: Accept-Encoding` so a shared cache never hands gzip to a client that did
not ask for it. Every response carries `Cache-Control: no-store`.

---

## 8. Canonical data model

[`src/models/canonical.ts`](src/models/canonical.ts) defines Zod schemas and
types for **live UPSRTC data only**. Predictive scenario output uses entirely
separate types under `src/lib/demo-scenarios/`, so the two can never be
confused at the type level.

```ts
CanonicalLiveBus {
  id, registrationNumber
  latitude, longitude                    // validated, never (0,0)
  speedKmph | null, headingDegrees | null
  depotName | null, routeId | null, routeName | null
  serviceNumber | null, tripId | null, vehicleType | null
  gpsTimestamp | null, lastUpdatedAt
  ignitionOn | null, rawStatus | null
  tripDate | null                        // operating date of the assignment
  dataQuality: 'good' | 'degraded' | 'stale'
}

CanonicalSchedule {
  registrationNumber, date
  routeId, routeName, originName, destinationName, tripId
  scheduledDeparture, scheduledArrival, direction
  tripCount                              // journeys upstream listed for the day
  stops: CanonicalStop[]                 // id, name, sequence, lat/lng | null, times
}
```

Both API responses share an envelope: `{ fetchedAt, source: 'live' | 'cache' |
'fixture', stale }`.

---

## 9. The command centre — surface by surface

[`CommandCenter`](src/components/command-center/CommandCenter.tsx) mounts three
hooks — `useLiveFleet()`, `useSchedule()`, `useAlertStream()` — hydrates the
audit trail from `localStorage`, and lays out a fixed-viewport shell.

The protected layout applies **CSS `zoom: 1.18`** with the box sized at
`calc(100vw / 1.18)` so it fills the viewport exactly. `zoom` is used
deliberately rather than `transform: scale`: `transform` leaves layout size
unchanged, which desyncs the Google Maps canvas overlay (it projects positions
in *layout* pixels) and shifts every bus marker off the road.

### Top command bar

Olympuss project context and Sign Out · connection state (`CONNECTED` /
`STALE CACHE` / `FIXTURE` / `DEGRADED`) with an animated pulse · India time ·
last GPS update age · live bus count · visible count · the `LIVE UPSRTC GPS`
badge and `PREDICTIVE ENGINE ACTIVE` marker side by side · buttons for Audit,
Diagnostics, Scenario Lab, Fleet Distribution and fullscreen.

### Fleet panel (left, 272 px)

- Debounced registration search (220 ms), depot and route selects, and a GPS
  data-status filter (`all` / `good` / `degraded` / `stale`).
- Depot and route option lists are memoized hard over ~9.5k records; routes are
  capped at 400 options.
- **Ordering matters more than it looks.** Roughly a quarter of the fleet
  carries a route assignment at any time and most of the rest are parked, so an
  unordered list opens on a wall of stationary unassigned buses. Rows are
  ranked: on-route and moving → on-route → moving → neither, with ties broken
  on registration so the list does not reshuffle under itself on each poll. A
  stale record's speed is whatever it read when the GPS last reported, possibly
  days ago, so stale vehicles never count as "moving".
- Only the first **160** rows are painted, with an explicit "refine filters"
  footer.

### Fleet map

Google Maps JS API with a custom dark style, `disableDefaultUI`, greedy gesture
handling, and **`TrafficLayer` explicitly not enabled**.

Vehicles are drawn by a single **canvas overlay**
([`fleetCanvasLayer.ts`](src/components/map/fleetCanvasLayer.ts)), not by
`google.maps.Marker`:

- One `Marker` per bus means ~9.5k overlay objects, and `MarkerClusterer` then
  re-clusters and re-creates cluster markers on every zoom/pan — measured at
  **5.1 seconds** of main-thread blocking across a handful of zoom steps.
- The canvas layer redraws in O(visible) with no DOM churn, so pan and zoom
  stay on the compositor.
- **No clustering** — every vehicle is drawn at its own position, so a dense
  corridor reads as dense. Two things keep that affordable: chevrons are
  accumulated into one `Path2D` per colour and filled in a single call, and
  positions are projected with local Mercator maths instead of ~9.5k round
  trips through the Maps projection API.
- Marker scale tapers with zoom (0.55 → 1.0) so statewide views stay legible.
- Colour encodes data quality: green `good`, amber `degraded`, red `stale`;
  cyan for the selection.

Camera behaviour: selecting a vehicle pans and zooms to it (zoom 13), keyed on
the vehicle **id alone** so 15-second polling never yanks the camera back.
Entering Pitch Mode returns the camera to the statewide view and hides the zoom
control (it shows through the caption letterbox as a bright artefact).

`useScenarioOverlays` draws the live schedule geometry (stops plus a polyline,
only when at least two stops have genuinely surveyed coordinates) and all
projected scenario geometry — corridors, congestion polygons, assistance links,
demand heatmap — as separate overlay sets so each can be cleared independently.

A `RadarSweep` renders over the selected vehicle.

### Bus detail drawer

Opens on selection with live readouts (position, speed, heading, ignition, GPS
age, depot, route, data quality) and the retrieved schedule (origin,
destination, departure, arrival, stop sequence, trip count). Five actions
launch analyses: **Bunching**, **Traffic**, **Incident Response**,
**Demand–Supply**, and **Contact Driver**. Escape closes it.

### Copilot panel (right, 344 px)

- An `IntelligenceCore` visual, a state readout (`Listening` / `Analysing` /
  `Recommendation Ready` / `Awaiting Authorization` / `Monitoring`), a waveform
  and a typewriter line. Idle chatter rotates through local template strings
  every 6.5 s — no LLM is called.
- Idle state shows a **Monitoring Channels** readout that distinguishes live
  ingest (telemetry, schedule) from model-derived capability (bunching,
  corridor traffic, vehicle health, demand, communications), plus a standing
  "Operating Principle" note: *the copilot observes, predicts and recommends;
  it never executes.*
- With a scenario active: severity-coloured headline, confidence ring, AI
  observation, recommended action, expected outcome, affected buses (the real
  vehicle tagged `· LIVE`, modelled companions in amber), the suggested driver
  message in English and Hindi, dispatcher controls
  (Accept / Modify / Reject / Monitor / Message / Voice call) and a projected
  impact preview.
- Severity is communicated as **text as well as colour**.

### Scenario stage

The four analysis bodies are `lazy()`-loaded — they pull in Recharts, so they
are only fetched when an analysis is actually opened. `AnimatePresence
mode="wait"` fully retires an outgoing panel before the next mounts, otherwise
the two stack in the same slot.

### Intelligence strip (bottom, 132 px)

Rolling GPS stream activity sampled from real counts each poll (last 40
points), data-quality breakdown, a modelled ambient demand curve, active
incident count, recent audit events, and entry points to Pitch Mode and the
Impact dashboard. The stream clock is held back until mount so the server
render and hydration cannot disagree.

### Drawers and overlays

**Scenario Lab** (presenter controls; every override rebuilds the active
scenario immediately) · **Diagnostics** · **Audit** · **Driver message modal**
· **VoIP call overlay** · **Impact dashboard** · **Pitch Mode**. All are
Escape-dismissible.

---

## 10. The predictive engine

`buildScenario(kind, { bus, schedule, overrides })` in
[`scenarioEngine.ts`](src/lib/simulation/scenarioEngine.ts) is the single entry
point. It is **deterministic**: the same bus with the same overrides always
yields the same output, so a re-run of the pitch shows identical figures.

### Seeding

[`seededRandom.ts`](src/lib/simulation/seededRandom.ts) provides an FNV-1a
string hash into a Mulberry32 PRNG, wrapped in a `SeededRandom` class
(`float`, `int`, `fixed`, `pick`, `bool`). Each scenario seeds from
`"<kind>:<registrationNumber>"`. Also here: `offsetCoordinate()` (great-circle
offset by distance and bearing, used to place modelled markers) and
`haversineKm()`.

### The four analyses

| Kind | Panel label | What it models |
| --- | --- | --- |
| `bunching` | `BUNCHING ANALYSIS` | Forward/rear headway gaps, bunching risk %, minutes to clustering, a hold recommendation, projected gaps after the hold, three markers (ahead / selected / behind) and a corridor polyline |
| `traffic` | `CORRIDOR ANALYSIS` | Congestion level, distance to congestion, delay, corridor speed, normal vs congested vs alternative ETA, an incident description, a congestion corridor, route options and a density curve |
| `breakdown` | `INCIDENT RESPONSE` | Fault type, passengers onboard, location safety status, ranked assistance candidates (distance, response time, seats, route compatibility, suitability score) and a response timeline |
| `demand` | `DEMAND ANALYSIS` | Per-window demand intensity, route deficits/surpluses, hotspots, depot availability, reallocation arrows and a demand curve |

Every template returns the same envelope (`ScenarioBase`): headline, severity
and severity **text**, confidence %, observation, recommendation, expected
outcome, affected buses, suggested driver message in English and Hindi,
dispatcher actions, markers, before/after impact metrics, a timeline, and — the
important one — a **non-optional `simulationLabel`**. The type system makes it
impossible to add a scenario that renders without a provenance label.

Only the projected condition is model output. The vehicle identity, position,
depot, route and schedule attached to it are live.

### Demand's reference window

The 08:00 morning peak is the reference: at that setting the scenario
reproduces the documented baseline figures exactly (Route A 7→11 at 164%,
Route B 9→6 at 72%, Route C 8→9 at 118%). Every other window is expressed
relative to it, so the deficit/surplus story stays legible as the presenter
moves the time slider.

### Scenario Lab overrides

Bunching risk, gap ahead/behind, hold duration, congestion severity, traffic
delay, congestion distance, alternative saving, breakdown type, passenger
count, rescue candidate count, response time, demand multiplier, peak window,
festival surge, reserve buses, message language, acknowledgement delay and call
duration. Changing any control rebuilds the active scenario in place.

### Projected impact

[`impactScenario.ts`](src/lib/demo-scenarios/impactScenario.ts) holds eight
fixed KPIs (bunching incidents −85%, passenger wait −73%, breakdown response
−58%, fleet utilization +15%, on-time performance +31%, dispatcher response
−44%, empty kilometres −19%, passenger experience +26%) with explicit baseline
and projected values, a `PROJECTED` label, and the standing disclaimer:
*modelled estimates; actual impact must be validated through an authorized
UPSRTC pilot.*

---

## 11. The alert stream

[`alertEngine.ts`](src/lib/alerts/alertEngine.ts) +
[`useAlertStream`](src/hooks/useAlertStream.ts).

- The board is **seeded with five alerts** as soon as live vehicles arrive, with
  timestamps staggered 74 s apart so the feed reads as already established.
  Seeded alerts populate silently; only live arrivals raise toasts.
- A new alert is raised **every 30 seconds**, alternating **headway** and
  **corridor** conditions (`ALERT_ROTATION = ['bunching', 'traffic']`).
- **Exactly one vehicle-fault alert** is seeded (placed mid-board so it does not
  read as the newest event) and **none are raised afterwards**, so a critical
  incident stays exceptional rather than becoming background noise. The
  incident slot is counted separately from the rotation index, otherwise it
  would eat a turn and the remaining kinds would stop alternating evenly.
- **Demand is not streamed** — it is a corridor-level question, reviewed from
  the **Fleet Distribution** view in the command bar.
- Pitch Mode suppresses new alerts; it drives its own narrative.

**Candidate selection** prefers vehicles that make an information-rich alert — a
recent GPS fix plus a known route and depot — and falls back progressively
(route only → any unused → any) so the stream never stalls on a sparse feed.
Vehicles already on the board (the newest 8) are excluded.

Every alert is anchored to a **real vehicle**: real registration, real depot,
real route, real position. Only the projected condition is model output — which
is why the panel carries a single `PREDICTIVE` marker in its header rather than
a badge on every card.

Opening an alert selects that vehicle, flies the map to it, acknowledges the
alert, rebuilds the full analysis for the same vehicle, and logs an audit
event. The list is ordered critical-first then most-recent. History is capped at
40 alerts and the toast queue at 3; critical toasts persist until dealt with.

---

## 12. Driver communication workflow

[`communicationScenario.ts`](src/lib/demo-scenarios/communicationScenario.ts)
models a seven-state workflow with **guarded forward-only transitions**
(`canTransition` rejects any jump that is not exactly one step):

```
suggestion-generated → awaiting-review → approved → message-prepared
   → message-sent → driver-acknowledged → monitoring-outcome
```

The message draft carries the registration, scenario label, suggested action,
English and Hindi text, the vehicle's location, a 15-minute expiry, an approval
warning, and the banner **"NO DRIVER IS CONTACTED FROM THIS PROTOTYPE"**.

The call plan carries a driver placeholder (never a real name or number), an
incident summary, four structured speaking points, a duration, an
acknowledgement delay, a summary template, and the banner **"NO EXTERNAL CALL
IS PLACED FROM THIS PROTOTYPE"**.

No SMS, push or VoIP provider is integrated. The acknowledgement and the call
audio are entirely local, and nothing autoplays sound.

---

## 13. Audit trail

[`auditLog.ts`](src/lib/audit/auditLog.ts) keeps a browser-local trail in
`localStorage` under `upsrtc-copilot-audit-v1`, capped at 250 events. Raw
upstream GPS payloads are never persisted — only compact event records.

Thirteen event types are tracked: bus selected, schedule fetched, scenario
launched, alert displayed, suggestion approved / modified / rejected, message
sent, acknowledgement received, call started / ended, scenario completed, and
session reset.

Every event is stamped `simulated: true | false` and rendered `MODEL` / `LIVE`.
Events sourced from live UPSRTC data (bus selection, schedule retrieval) are
stamped `false`; everything model-driven is stamped `true`. **Both exports
preserve the distinction:**

- **JSON export** — includes an explicit provenance notice alongside the events.
- **Text summary** — event breakdown plus a chronology tagged `[MODEL]` /
  `[LIVE]`, closing with the standing notice that no driver was contacted and
  no instruction was executed.

Storage failures (quota, private mode) are swallowed — the session continues
without persistence rather than breaking.

---

## 14. Pitch Mode

Click **PITCH MODE** in the intelligence strip for a hands-free cinematic
walkthrough with on-screen presenter captions: **12 steps, 96.5 seconds**
(`TOTAL_PITCH_MS`).

Fleet visibility → network scale → vehicle selection → live schedule retrieval →
bunching projection → dispatcher authority → driver message → corridor traffic →
breakdown coordination → demand redistribution → voice contact → projected
impact.

| Control | Key |
| --- | --- |
| Pause / resume | `Space` or **Pause** |
| Next / previous step | `→` / `←` |
| Exit | `Esc` or **Exit** |

Entering Pitch Mode resets the stage: any scenario, drawer or modal left open
from manual exploration would otherwise sit under the opening caption, which is
meant to show the bare fleet map. The runner picks a well-populated anchor
vehicle once and keeps it for the whole sequence. No audio is played and
nothing autoplays sound.

For the manual 8–10 minute presentation, see
[`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

---

## 15. The public landing experience

[`(public)/page.tsx`](<src/app/(public)/page.tsx>) composes six narrative
sections over three layers:

1. **`LandingBackdrop`** — a fixed, pure-CSS dark field with a gold core glow,
   midnight depth and inline SVG grain. Renders instantly with no JS and no
   WebGL, and is the guaranteed base layer.
2. **`CanvasMount`** — the WebGL canvas, `next/dynamic` with `ssr: false`, so
   the heavy three.js bundle loads lazily on the client and never ships to
   dashboard routes.
3. **Accessible HTML content** above both.

| Scene | Section | Content |
| --- | --- | --- |
| 01 | Arrival | Hero: eyebrow, H1 "Intelligence Elevated", body, two actions, scroll cue |
| 02 | The Ascent | Six progressive terms (Perceive, Reason, Adapt, Create, Coordinate, Evolve) laid out as real text at varied scale and opacity — depth, not a list |
| 03 | Fields of Exploration | Five concepts (Machine Intelligence, Agentic Systems, Real-Time Intelligence, Adaptive Automation, Human–AI Interaction), selectable by hover, focus **or** tap, writing the active index into the scene so the matching orbit node reacts |
| 03.5 | AI Research Projects | Eight applied-AI research projects with real descriptions, capability labels and decorative abstract diagrams |
| 04 | From Signals to Understanding | Incoming signals → the resolving word → outgoing understanding |
| 05 | Project Portal | The quiet call to enter the protected environment |

**Accessibility and motion.** Sections are tall (120–220 vh) so the fixed canvas
produces a "pinned" effect **without scroll-jacking** — scroll stays native and
reversible. `Reveal` uses `IntersectionObserver` and, under
`prefers-reduced-motion`, simply shows content immediately with no transform —
never hidden. In-page navigation respects the same preference. Every diagram is
`aria-hidden`; no animation is the sole carrier of meaning; the entire page is
understandable with WebGL disabled.

The research section presents research explorations only — no client,
deployment, location, publication, funding or performance claims.

---

## 16. The WebGL globe

`ExperienceCanvas` chooses a quality tier from **device capability, never
viewport width alone**, combining device-pixel ratio, WebGL support, mobile
heuristics, hardware concurrency and the reduced-motion preference.

| Tier | DPR cap | Background / signal particles | Land dots | Ocean lattice | Orbits · satellites · arcs |
| --- | --- | --- | --- | --- | --- |
| `high` | 1.5 | 1100 / 900 | ~12,000 | ~7,200 | 4 · 6 · 9 |
| `medium` | 1.4 | 650 / 520 | ~6,100 | ~4,600 | 3 · 4 · 5 |
| `low` | 1.25 | 280 / 220 | ~3,000 | ~2,300 | 2 · 2 · 2 |
| `reduced` | — | — | — | — | canvas renders **nothing** |

At the `reduced` tier the canvas returns `null` and the static CSS backdrop
remains as a deliberate static edition.

**Scene state is a plain module singleton**, not React state: scroll progress
and pointer position are read every frame inside `useFrame`, so the animation
loop never triggers a React re-render — the tree stays stable while GPU work is
driven imperatively. GSAP `ScrollTrigger` and the pointer listener write to it;
the R3F scene reads from it. The loop pauses (`frameloop: 'never'`) when the
tab is hidden.

**Scroll choreography.** Narrative sections map onto normalized progress bands
(`arrival` 0–0.11, `ascent` 0.11–0.26, `exploration` 0.26–0.43, `research`
0.43–0.76, `intelligence` 0.76–0.96, `portal` 0.96–1.0), recomputed against the
measured page height when the research section was added. The globe reads only
arrival/ascent/exploration/intelligence/portal — `phase()` clamps `exploration`
to 1 and `intelligence` stays 0 across the research band, so the globe holds a
calm, receded pose there with no extra timeline and no jump on entry or exit.

**Globe geometry.** Radius 1.5 world units, one revolution per 20 s, with an
initial π spin offset so the hero loads with Asia facing the viewer (far more
visible land than the Americas). Fixed axial tilt (≈ −19° roll, +7° forward
tip), a subtle vertical bob and scale breathe, and gentle pointer parallax.
Golden continent dots, a warm-gold ocean data lattice kept below land
brightness, a graticule, a thin atmospheric rim, inclined orbital paths with
satellites and markers, and geographic great-circle arcs whose altitude scales
with route length.

**Land data.** Natural Earth 1:110m physical land (`ne_110m_land`), **public
domain, no attribution required**, reduced at development time to 127 polygons /
128 rings / ~5,129 coordinates (~84 KB raw, ~27 KB gzipped) using only Node's
built-in JSON tooling — no npm dependency was added. It is imported at build
time and **never fetched at runtime**, so it does not depend on any network
request or relax the production CSP. Full provenance in
[`src/three/globe/data/README.md`](src/three/globe/data/README.md).

Point sprites are generated in-canvas rather than loaded as assets.

---

## 17. Design system and style isolation

Two palettes coexist without collision, namespaced in
[`tailwind.config.ts`](tailwind.config.ts):

- **Dashboard (HUD):** `void`, `navy`, `holo` (glow `#3ff0ff`, bright, core,
  deep, teal), `alert` (amber `#ffb020`, crimson `#ff4d5e`, green `#2bff88`),
  plus `hud` / `hud-strong` / `critical` / `warn` shadows, a `hud-grid`
  background and nine keyframe animations (scan, radar sweep, pulse ring, core
  breathe, data stream, orbit, flicker, rise, drift).
- **Landing (`ol-*`):** `bg #050507`, `surface`, `elevated`, `midnight`,
  `gold #d6a13a`, `gold-light`, `gold-muted`, `ivory #f2eee7`, secondary text
  and muted.

Fonts follow the same split: **Orbitron** (display) and **JetBrains Mono** for
the dashboard, declared as CSS variables in the root layout; **Manrope** and
**Cormorant Garamond** for the landing, loaded only in the public layout.

The visual concept is an original holographic command-centre identity: deep
black and dark navy layers, electric cyan and teal highlights, amber warnings,
crimson incidents, green for connected systems; frosted glass panels with fine
neon borders, corner instrument ticks, radar sweeps, orbital rings, animated
scanning lines, floating particles, grid and digital-noise textures, typewriter
AI text, animated waveforms and number counters.

**No Marvel, Iron Man, Jarvis or any third-party character, logo, sound or
interface asset is used or referenced.** The word "Jarvis" appears nowhere in
the application.

Shared HUD primitives live in
[`src/components/shared/hud.tsx`](src/components/shared/hud.tsx): `HudPanel`,
`Badge`, `CountUp`, `Typewriter`, `ConfidenceRing`, `Waveform`,
`AmbientBackdrop`, `Readout`, `SimulationBanner`.

### Brand assets

`npm run process-logo` reads an untouched source logo and produces every derived
asset. White-background removal is **luminance-keyed**: pixels become
transparent in proportion to how close to neutral-white they are (high minimum
channel, low saturation), so the saturated gold artwork stays fully opaque while
the white field drops out — without the bright halo naive thresholding leaves on
thin anti-aliased rays. Outputs: transparent emblem (PNG + WebP), full logo with
wordmark, the favicon set (`src/app/icon.png`, `src/app/apple-icon.png`, a
public touch icon) and a 1200×630 Open Graph image. The source is never
modified; crop constants at the top of the script are the only thing to tune.

---

## 18. Security

**Response headers** (all routes, from [`next.config.ts`](next.config.ts)):
`X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
`X-DNS-Prefetch-Control: on`, `Permissions-Policy: camera=(), microphone=(),
geolocation=(), browsing-topics=()`, `Cross-Origin-Opener-Policy: same-origin`.
In production only: HSTS (`max-age=63072000; includeSubDomains; preload`) and a
Content-Security-Policy.

**CSP** is production-only because dev needs `eval` and websockets for HMR. It
is scoped to what the app genuinely needs — Next's inline bootstrap, the Google
Maps SDK, Next's self-hosted fonts, and WebGL from self/blob/data — with
`frame-ancestors 'none'` (no clickjacking, no iframe reuse of the dashboard),
`base-uri 'self'`, `form-action 'self'` and `object-src 'none'`.
`'unsafe-inline'`/`'unsafe-eval'` on scripts is a known trade-off to tighten
later with per-request nonces.

**Crawlers.** `robots.ts` allows only `/` and disallows `/login`, `/project/`
and `/api/`. `sitemap.ts` lists the homepage alone. The login page and the
protected layout both set `robots: { index: false, follow: false }`.

**Secrets.** No private environment variable reaches the browser. The
Diagnostics drawer reports only whether the Maps key is *present*, never its
value. Auth error messages never reveal which field was wrong or which variable
is missing. The session token lives only in an `HttpOnly` cookie and is never
handed to client JavaScript.

Run a review of pending changes on the current branch with `/security-review`.

---

## 19. Performance decisions

Each of these was made against a measured problem, not on principle:

| Decision | Why |
| --- | --- |
| Canvas fleet layer instead of `Marker` + `MarkerClusterer` | 5.1 s of main-thread blocking across a handful of zoom steps with ~9.5k markers |
| Local Mercator projection, batched `Path2D` per colour | Avoids ~9.5k round trips through the Maps projection API per redraw |
| 15 s server cache on the live feed | One upstream fetch serves every connected client |
| Opportunistic gzip ≥ 32 KB | ~3.8 MB JSON per poll → a few hundred KB on conference-room wifi |
| Concurrent schedule date fan-out | Sequential probes would stack four 15 s timeouts onto one click |
| Cache the "no assignment" result | Otherwise every unassigned bus re-runs the fan-out on each selection |
| 160-row render cap + memoized filter option lists | Filtering and rendering ~9.5k records on every keystroke |
| 220 ms search debounce | Same |
| `lazy()` scenario bodies | Recharts only loads when an analysis is actually opened |
| `next/dynamic` `ssr: false` for the WebGL canvas | three.js never ships to dashboard routes; HTML renders immediately |
| Mutable scene singleton for scroll/pointer | The 60 fps loop never triggers a React re-render |
| `frameloop: 'never'` when the tab is hidden | No GPU work in a background tab |
| Abort in-flight requests before the next poll / on re-selection | No pile-up, no out-of-order writes |

---

## 20. Testing

```bash
npm run lint         # ESLint (next lint)
npm run typecheck    # tsc --noEmit, strict
npm run test         # Vitest — 156 unit tests, no network required
npm run test:watch   # Vitest in watch mode
npm run test:e2e     # Playwright — 24 specs (starts the app via npm run start)
npm run format       # Prettier over src/**/*.{ts,tsx,css} and docs/**/*.md
```

### Unit tests (Vitest, jsdom) — 156 tests across 6 files

| File | Tests | Covers |
| --- | --- | --- |
| `normalizer.test.ts` | 41 | Coordinate validation, numeric coercion, payload unwrapping, alias resolution, duplicate merging, data-quality labels, trip grouping and selection, schedule normalization |
| `scenarios.test.ts` | 43 | All four scenario templates, determinism, override plumbing, impact metrics |
| `geo.test.ts` | 23 | Lat/lng → vec3, poles, equator, longitude periodicity, point-in-polygon with holes, land/sphere grid sampling, graticule packing, real Natural Earth data |
| `audit.test.ts` | 21 | Audit append/cap/round-trip/clear/export, TTL cache semantics, upstream client helpers, formatters |
| `alerts.test.ts` | 19 | Alert anchoring to real vehicles, seeding (exactly five, exactly one fault), even rotation, candidate selection tiers, graceful degradation |
| `globeExtras.test.ts` | 9 | Orbit radii and inclination, great-circle arc packing and lift, deterministic route picking |

### End-to-end (Playwright) — 24 specs

Run at **2259×1271**, which is the effective CSS viewport of a 1920-wide
display at the ~85% browser zoom the dashboard is actually used at.

Coverage: command-centre load and identity · fleet rendering and counters ·
vehicle selection and detail panel · schedule requested **only** after selection
· all four analyses (bunching companions, corridor route comparison, assistance
candidates, demand time slider) · driver message send and acknowledgement ·
voice call connect and clean teardown · Pitch Mode start/advance/exit · live and
predictive markers remaining visible together · footer disclaimer always
accessible and expandable · console cleanliness through a full walkthrough ·
diagnostics, audit and scenario-lab drawers · impact dashboard figures · audit
trail recording the walkthrough · alert seeding with real vehicles · alert
click-through · the 30 s stream interval · **exactly one vehicle-fault alert** ·
fleet distribution opening without a prior selection · Escape closing the detail
drawer · and an assertion that the words **"simulated"** and **"demonstrate"**
appear nowhere in the interface.

---

## 21. Build and deployment

Deploys as a standard Next.js application (Vercel, or Node behind a reverse
proxy). Requirements:

- All server-side environment variables configured on the host — including
  `PROJECT_NAME`, `PROJECT_PIN_HASH` and a ≥ 32-character `SESSION_SECRET`.
- Outbound network access to `margdarshi.upsrtcvlt.com`.
- The Google Maps key restricted to the deployment domain and to the Maps
  JavaScript API.
- `SITE_URL` set to the canonical origin so metadata, the canonical link and the
  sitemap resolve correctly.

`outputFileTracingRoot` is pinned to this project because a stray lockfile in
the parent directory makes Next infer the wrong workspace root.

**Before any operational use**, note that the response cache is in-memory
(per-process) and the audit trail is browser-local. Both need replacing — see
[`docs/PRODUCTION_ROADMAP.md`](docs/PRODUCTION_ROADMAP.md). The same applies to
the login rate limiter.

### Known advisories

`npm audit` reports 2 moderate advisories against a `postcss` copy vendored
inside Next.js itself. They are not fixable without downgrading to `next@9`,
affect the build toolchain only, and do not reach runtime.

---

## 22. Scripts reference

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server on :3000 |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run test` / `test:watch` | Vitest |
| `npm run test:e2e` | Playwright |
| `npm run format` | Prettier over source and docs |
| `npm run inspect:api` | Probe both UPSRTC endpoints and print an empirical report |
| `npm run generate-pin-hash -- <pin>` | bcrypt hash (cost 12) for `PROJECT_PIN_HASH`; hash to stdout, guidance to stderr |
| `npm run process-logo` | Regenerate every brand asset from the source logo |

---

## 23. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Basemap Unavailable" | Maps key missing, restricted or unbilled | Check `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`; allow the `localhost` referrer. Everything except the basemap still works. |
| Amber "fixture fallback" banner | Upstream unreachable | Real captured data is being served. Check network access to `margdarshi.upsrtcvlt.com`. |
| Bus count is zero | Upstream returned no usable records | Open **Diagnostics** for raw vs normalized vs rejected counts. |
| "No schedule assigned" | Genuine upstream response for that vehicle on every candidate date | Pick a bus showing a route name in the fleet list. |
| Login always fails | `PROJECT_PIN_HASH` corrupted by dotenv `$` expansion | Escape every `$` as `\$` in `.env.local`; paste unescaped in host env UIs. |
| `503 Authentication is not configured` | `PROJECT_NAME`, `PROJECT_PIN_HASH` or `SESSION_SECRET` missing/short | Set all three; the secret must be ≥ 32 characters. |
| Redirected to `/login` immediately after signing in | Cookie rejected — usually `Secure` over plain HTTP in a production build | Serve over HTTPS, or run `npm run dev` locally. |
| Fleet list feels slow | Very broad filter over ~9.5k records | Narrow by depot or route; the list caps at 160 rendered rows by design. |
| Stale timestamps everywhere | Most vehicles are `Offline` upstream | Expected — filter to **GOOD** to see currently-reporting vehicles. |
| Landing page shows no globe | Reduced-motion preference, or no WebGL | Intentional. The static CSS backdrop is the designed fallback. |

The **Diagnostics** drawer reports endpoint health, cache age, record pipeline
counts, map configuration and simulation status. It never displays secrets —
only whether configuration is present.

---

## 24. Data-labelling rules

These are enforced in code, not left to discipline:

1. Every scenario template **must** return a panel label — the type system makes
   `simulationLabel` non-optional.
2. The Alert Centre and every analysis panel carry a `PREDICTIVE` marker.
3. The top command bar shows the live-data badge and `PREDICTIVE ENGINE ACTIVE`
   together.
4. Audit events are stamped `simulated: true | false`, rendered `MODEL` /
   `LIVE`; both export formats preserve the distinction and carry the notice.
5. The footer notice is present on every dashboard screen and expandable for
   detail.
6. Canonical models cover live data only; scenario output uses separate types,
   so the two cannot be confused at the type level.
7. Playwright asserts the live and predictive markers stay visible together
   while an analysis is open, and that no "simulated" / "demonstrate" wording
   remains in the interface.

---

## 25. Safety disclaimer

This is a prototype. Vehicle positions and schedules are live UPSRTC data.
Alerts, recommendations, traffic conditions, demand forecasts, breakdowns and
communication events are model projections pending dispatcher review — not
confirmed operational events.

No driver is contacted. No operational instruction is executed automatically.
No vehicle is dispatched, held, diverted or reassigned. No depot is notified.
No passenger data is collected or displayed.

Production deployment requires formal UPSRTC authorization, security review and
backend integration.

---

## 26. Further documentation

| Document | Contents |
| --- | --- |
| [`docs/olympuss/OVERVIEW.md`](docs/olympuss/OVERVIEW.md) | Unified-app routes, source layout, surface responsibilities |
| [`docs/olympuss/AUTH.md`](docs/olympuss/AUTH.md) | Authentication design and threat model |
| [`docs/olympuss/DEPLOYMENT.md`](docs/olympuss/DEPLOYMENT.md) | Host configuration, secrets, domain setup |
| [`docs/olympuss/BASELINE.md`](docs/olympuss/BASELINE.md) | Migration baseline from the original repository |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Dashboard system design, data flow, performance, security |
| [`docs/API_DISCOVERY.md`](docs/API_DISCOVERY.md) | Empirical findings from both UPSRTC endpoints |
| [`docs/LIVE_VS_PREDICTED.md`](docs/LIVE_VS_PREDICTED.md) | Definitive field-by-field live-vs-predicted reference |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | Full 8–10 minute presentation script |
| [`docs/PRESENTATION_GUIDE.md`](docs/PRESENTATION_GUIDE.md) | Setup, fallbacks, expected questions |
| [`docs/PRODUCTION_ROADMAP.md`](docs/PRODUCTION_ROADMAP.md) | Path from prototype to production |
| [`src/three/globe/data/README.md`](src/three/globe/data/README.md) | Globe land-data source, licence and preprocessing |
