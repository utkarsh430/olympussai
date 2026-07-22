# Olympuss AI — Unified Application

One Next.js app: the public **Olympuss AI** landing experience, project
authentication, and the protected **UPSRTC AI Copilot** dashboard — one
deployment, one domain (**olympuss.us**), one auth system.

- **`/`** — cinematic Olympuss AI landing (WebGL, 5 scenes; static fallback for
  reduced-motion / no-WebGL)
- **`/login`** — project authentication
- **`/project/upsrtc`** — the UPSRTC dashboard below (session-protected)

**Docs:** [Overview](docs/olympuss/OVERVIEW.md) ·
[Authentication](docs/olympuss/AUTH.md) ·
[Deployment](docs/olympuss/DEPLOYMENT.md) ·
[Migration baseline](docs/olympuss/BASELINE.md)

**Quick start**

```bash
npm install
npm run generate-pin-hash -- <pin>   # PROJECT_PIN_HASH (escape $ as \$ in .env.local)
npm run process-logo                 # regenerate brand assets from the source logo
cp .env.example .env.local           # then fill in the values
npm run dev
```

Credentials, secrets, and the Google Maps key are configured via environment
variables only — see [Deployment](docs/olympuss/DEPLOYMENT.md). This repository
is independent of the original TitanX repository and must use its own GitHub
remote.

---

The remainder of this document describes the UPSRTC dashboard itself, which is
preserved unchanged beneath `/project/upsrtc`.

# TitanX AI

**Predictive Fleet Command Intelligence** — a cinematic control-centre
prototype showing how an AI operations copilot could assist UPSRTC control-room
dispatchers.

Built for presentation to the Director, UPSRTC.

---

## ⚠️ Read this first

> **Vehicle positions and schedules are live UPSRTC data.**
>
> Alerts, forecasts, recommendations, traffic conditions, breakdowns and
> communication events are **model projections** — not confirmed operational
> events.
>
> - **No driver is contacted.**
> - **No operational instruction is executed automatically.**
> - **Production deployment requires formal authorization and backend integration.**

Model-derived surfaces carry a `PREDICTIVE` marker; live data carries a green
`LIVE UPSRTC` badge. See [`docs/LIVE_VS_PREDICTED.md`](docs/LIVE_VS_PREDICTED.md) for the
definitive field-by-field breakdown.

---

## Product purpose

UPSRTC control rooms can answer *where is the bus?* They cannot answer *what is
about to go wrong, and what should I do about it?*

This prototype demonstrates that second capability — bunching prediction,
traffic intelligence, breakdown coordination, demand-led redistribution and
driver communication — layered on top of genuinely live fleet telemetry, with
the dispatcher retaining authority over every action.

## Visual concept

An original holographic command-centre identity: deep black and dark navy
layers, electric cyan and teal highlights, amber warnings, crimson incidents,
green for connected systems. Frosted glass panels with fine neon borders,
corner instrument ticks, radar sweeps, orbital rings, animated scanning lines,
floating particles, grid and digital-noise textures, typewriter AI text,
animated waveforms and number counters.

No Marvel, Iron Man, Jarvis or any third-party character, logo, sound or
interface asset is used or referenced. The word "Jarvis" appears nowhere in the
application.

---

## Architecture

```
Browser  ──▶  /api/upsrtc/live      (15s poll)   ──▶  UPSRTC GPS endpoint
         ──▶  /api/upsrtc/schedule  (on select)  ──▶  UPSRTC schedule endpoint
```

The browser **never** contacts the UPSRTC PHP endpoints directly. Server-side
route handlers apply a 10-second timeout, normalize the response, cache it,
retain a last-known-good copy and fall back to sanitized fixtures.

Full detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS ·
Framer Motion · Google Maps JavaScript API · Recharts · Zustand · Zod ·
Radix UI primitives · Lucide icons · Vitest · Playwright · ESLint · Prettier

---

## Real UPSRTC integration

Both endpoints were probed empirically — no schema was assumed. Run the
inspector yourself:

```bash
npm run inspect:api
```

Observed (see [`docs/API_DISCOVERY.md`](docs/API_DISCOVERY.md) for the full report):

| | Live GPS | Schedule |
| --- | --- | --- |
| Records | 9,588 buses | 52 stops (per trip) |
| Fields | 51 per record | 18 per stop |
| Depots / routes | 143 / 1,194 | — |
| Content type | `text/html` (but JSON body) | `text/html` (but JSON body) |

Three quirks the implementation handles explicitly:

1. **`Content-Type` lies** — the body is parsed as JSON regardless, with a guard
   that rejects genuine HTML error pages.
2. **"Bus Not Assigned" is a bare JSON string**, returned with HTTP 200 — not an
   error status. Surfaced as "no schedule assigned", never a crash.
3. **Stop coordinates are often `0.0, 0.0`** — normalized to `null` and excluded
   from route polylines, since drawing through them would send the route into
   the Atlantic.

---

## Alert Centre

The command centre opens with **five active alerts** already on the board and
raises a new one every **30 seconds**, alternating headway and corridor
conditions. Exactly **one vehicle-fault alert** is seeded at startup and none
are raised afterwards, so a critical incident stays exceptional rather than
becoming background noise.

Demand is not streamed as an alert — it is a corridor-level question, reviewed
from the **Fleet Distribution** view in the command bar.

Every alert is anchored to a **real vehicle**: real registration number, real
depot, real route and its real position on the map. Only the projected
condition is model output — which is why the panel carries a single
`PREDICTIVE` marker in its header rather than a badge on every card.

Opening an alert selects that vehicle, flies the map to it, and opens the full
analysis. New alerts also surface as transient popups over the map; critical
ones persist until the operator deals with them.

## Live vs predicted at a glance

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
Google TrafficLayer, any live traffic source, any LLM API, any SMS/push/VoIP
provider.

---

## Setup

### Prerequisites

Node.js 20+ and npm.

### Environment variables

**`.env.local` is expected to already exist. Setup must not overwrite it.**

The application reads:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | yes | Renders the Google basemap (browser) |
| `UPSRTC_LIVE_URL` | no | Overrides the live endpoint (server) |
| `UPSRTC_SCHEDULE_URL` | no | Overrides the schedule endpoint (server) |
| `NEXT_PUBLIC_DEMO_MODE` | no | Set to `1` to force offline fixture mode |

Present in some environments but **intentionally unused**:
`GOOGLE_ROUTES_API_KEY`, `ANTHROPIC_API_KEY`.

`.env.example` documents the shape without any real credentials. No private
environment variable is exposed to the browser, and no key is ever printed.

### Install and run

```bash
npm install
npm run dev          # http://localhost:3000
```

Production:

```bash
npm run build
npm run start
```

---

## Testing

```bash
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit, strict
npm run test         # Vitest unit tests (no network required)
npm run test:e2e     # Playwright at 1920x1080 (needs the app running)
```

Unit tests cover payload normalization, alias resolution, coordinate
validation, duplicate merging, data-quality labels, scenario generation,
deterministic seeding, communication state transitions and audit operations.

Playwright covers command-centre load, fleet rendering, vehicle selection,
schedule-fetch timing, all four analyses, the alert stream (seeding, the 30s
interval, click-through), messaging, voice calls, Pitch Mode, marker
persistence, footer accessibility and console cleanliness. One test asserts the
words "simulated" and "demonstrate" appear nowhere in the interface.

---

## Pitch Mode

Click **PITCH MODE** in the top command bar for a hands-free ~105-second
cinematic walkthrough with on-screen presenter captions.

| Control | Key |
| --- | --- |
| Pause / resume | `Space` or **Pause** |
| Next / previous step | `→` / `←` |
| Exit | `Esc` or **Exit** |

No audio is played and nothing autoplays sound.

For the manual 8–10 minute presentation, see
[`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Basemap Unavailable" | Maps key missing, restricted or unbilled | Check `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`; allow `localhost` referrer. Everything except the basemap still works. |
| Amber "fixture fallback" banner | Upstream unreachable | Real captured data is being served. Check network access to `margdarshi.upsrtcvlt.com`. |
| Bus count is zero | Upstream returned no usable records | Open **Diagnostics** to see raw vs normalized vs rejected counts. |
| "No schedule assigned" | Genuine upstream response for that vehicle | Pick a bus showing a route name in the fleet list. |
| Fleet list feels slow | Very broad filter over ~9.5k records | Narrow by depot or route; the list caps at 160 rendered rows by design. |
| Stale timestamps everywhere | Most vehicles are `Offline` upstream | Expected — filter to **GOOD** to see currently-reporting vehicles. |

The **Diagnostics** drawer (top bar) reports endpoint health, cache age, record
pipeline counts, map configuration and simulation status. It never displays
secrets — only whether configuration is present.

---

## Deployment

Deploys as a standard Next.js application (Vercel, or Node behind a reverse
proxy). Requirements:

- Server-side environment variables configured on the host.
- Outbound network access to `margdarshi.upsrtcvlt.com`.
- Google Maps key restricted to the deployment domain.

**Note:** the cache and audit trail are in-memory / browser-local respectively.
Both need replacing before any operational use — see
[`docs/PRODUCTION_ROADMAP.md`](docs/PRODUCTION_ROADMAP.md).

### Known advisories

`npm audit` reports 2 moderate advisories against a `postcss` copy vendored
inside Next.js itself. They are not fixable without downgrading to `next@9`,
affect the build toolchain only, and do not reach runtime.

---

## Data-labelling rules

These are enforced in code, not left to discipline:

1. Every scenario template must return a panel label — the type system makes it
   non-optional.
2. The Alert Centre and every analysis panel carry a `PREDICTIVE` marker.
3. The top command bar shows the live-data badge and `PREDICTIVE ENGINE ACTIVE`
   together.
4. Audit events are stamped `simulated: true | false`, rendered `MODEL` /
   `LIVE`; exports preserve the distinction.
5. The footer notice is present on every screen and expandable for detail.
6. Playwright asserts the markers stay visible together while an analysis is
   open, and that no "simulated"/"demonstrate" wording remains.

---

## Safety disclaimer

This is a prototype. Vehicle positions and schedules are live UPSRTC data.
Alerts, recommendations, traffic conditions, demand forecasts, breakdowns and
communication events are model projections pending dispatcher review — not
confirmed operational events.

No driver is contacted. No operational instruction is executed
automatically. No vehicle is dispatched, held, diverted or reassigned. No depot
is notified. No passenger data is collected or displayed.

Production deployment requires formal UPSRTC authorization, security review and
backend integration.

---

## Documentation

| Document | Contents |
| --- | --- |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, data flow, performance, security |
| [`API_DISCOVERY.md`](docs/API_DISCOVERY.md) | Empirical findings from both UPSRTC endpoints |
| [`DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | Full 8–10 minute presentation script |
| [`LIVE_VS_PREDICTED.md`](docs/LIVE_VS_PREDICTED.md) | Definitive live-vs-predicted reference |
| [`PRESENTATION_GUIDE.md`](docs/PRESENTATION_GUIDE.md) | Setup, fallbacks, expected questions |
| [`PRODUCTION_ROADMAP.md`](docs/PRODUCTION_ROADMAP.md) | Path from prototype to production |
