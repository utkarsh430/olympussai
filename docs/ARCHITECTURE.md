# Architecture

## Overview

```
Browser (React 19 / Next 15 App Router)
   │
   │  GET /api/upsrtc/live      every 15s      (never upstream directly)
   │  GET /api/upsrtc/schedule  on selection only
   ▼
Next.js Route Handlers (Node runtime, server-only)
   │  timeout 10s · normalize · validate · TTL cache · last-known-good · gzip
   ▼
UPSRTC upstream (margdarshi.upsrtcvlt.com)
```

The browser never contacts the UPSRTC PHP endpoints. This keeps upstream
behaviour (misleading content types, 11.6 MiB payloads, bare-string error
responses) contained on the server, and lets one server fetch serve many
clients from cache.

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Upstream client | `src/lib/upsrtc/client.ts` | Fetch, timeout, tolerant parse, HTML-error guard |
| Normalizer | `src/lib/upsrtc/normalizer.ts` | Alias resolution, coordinate validation, dedup, quality |
| Cache | `src/lib/upsrtc/cache.ts` | TTL + last-known-good retention |
| Response | `src/lib/upsrtc/respond.ts` | JSON + opportunistic gzip |
| Routes | `src/app/api/upsrtc/*` | Orchestration, validation, fallback ladder |
| Models | `src/models/canonical.ts` | Zod schemas + canonical types (live data only) |
| Simulation | `src/lib/simulation/`, `src/lib/demo-scenarios/` | Deterministic scenario templates |
| State | `src/stores/copilotStore.ts` | Single Zustand store |
| Hooks | `src/hooks/` | Polling, schedule fetch, motion, clock, debounce |
| UI | `src/components/` | Command centre surfaces |

## Data flow

1. `useLiveFleet` polls `/api/upsrtc/live` every 15s, aborting any in-flight
   request first.
2. The route checks its 15s cache; on miss it fetches upstream with a 10s
   timeout.
3. `normalizeLivePayload` resolves field aliases, rejects invalid coordinates,
   merges duplicate registrations by newest timestamp, and classifies data
   quality from GPS age.
4. The response is cached, gzipped and returned with counts for diagnostics.
5. The store receives it; the map diffs markers incrementally rather than
   rebuilding.
6. Selecting a bus triggers `useSchedule` for **that vehicle only**.

## Fallback ladder

```
live upstream  →  fresh cache  →  last-known-good (flagged stale)  →  explicit "unavailable"
                                                                     └─ sanitized fixture,
                                                                        only if opted in
```

Every stage is labelled distinctly in the UI. There is no state in which the
operator sees a blank screen or an unhandled error.

The last step is deliberate. Serving a recently-cached **real** response is
legitimate degradation — the data was really observed, it is only older than it
looks. Substituting **bundled sample vehicles that do not exist** is not, so it
happens only when explicitly requested (`ALLOW_FIXTURE_FALLBACK`, or the
deliberate `NEXT_PUBLIC_DEMO_MODE=1` offline demo); otherwise a failed call
returns `source: 'unavailable'` with zero rows and a loud error notice. See
`src/lib/upsrtc/fixtureFallback.ts`.

An upstream that *answers* and reports zero vehicles stays `source: 'live'`:
"a quiet night" and "we could not reach the feed" both show an empty table, and
conflating them turns an incident into a shrug.

## Simulation design

The core constraint: **no operational algorithm is implemented**. Scenarios are
templates that consume the selected bus's real position, route, depot and
schedule as anchors, then generate plausible surrounding detail.

Determinism comes from seeding a Mulberry32 PRNG with an FNV-1a hash of
`"<scenario>:<registrationNumber>"`, so the same bus always yields the same
demonstration — essential for a repeatable pitch.

Presenter overrides from the Scenario Lab are applied on top and rebuild the
scenario synchronously.

## Performance

| Concern | Mitigation |
| --- | --- |
| 11.6 MiB upstream payload | Server-side fetch + 15s shared cache |
| 3.85 MB response to browser | gzip → ~416 KB (9.3× reduction) |
| 9,588 markers | `MarkerClusterer` + compact cluster rendering |
| Marker churn every poll | Incremental diff: update moved, add new, remove gone |
| Camera fighting the poll | Fly-to keyed on selection id only, never position |
| Large option lists | Memoized depot/route derivation |
| Search re-renders | 220 ms debounce |
| Long fleet lists | Render cap of 160 rows with an explicit overflow notice |
| Heavy scenario charts | `React.lazy` per scenario body |

## Accessibility

Keyboard navigation throughout, visible focus rings, ARIA labels on dialogs and
controls, `Escape` closes every overlay, severity conveyed in text as well as
colour, screen-reader descriptions on data-quality and KPI elements, and full
`prefers-reduced-motion` support (global CSS override plus per-component
guards).

## Persistent control service

The always-on control service (AVL/dispatch) is built and lives in
`control-service/` — 87 TypeScript source files, 28 tables, 27 route handlers
over 26 `/v1` paths plus `/healthz` and `/readyz`, 437 tests. It is a separate
deployable with its own Postgres/PostGIS datastore; the boundary between it
and this app — REST/webhook contract, service-to-service auth, per-direction
failure isolation, dispatcher-authorization enforcement — is specified in
[`docs/CONTROL_SERVICE_INTEGRATION.md`](./CONTROL_SERVICE_INTEGRATION.md) and
implemented on both sides. Hosting/CI/observability status is in
[`docs/CONTROL_SERVICE_DEPLOYMENT.md`](./CONTROL_SERVICE_DEPLOYMENT.md) — the
one thing still outstanding there is a Render account to deploy it to.

```
UPSRTC live feed ──► GPS poller (GPS_POLL_ENABLED, one instance only)
                     └─► POST /v1/positions ──► ingestion pipeline
                                                 │
                            map matching · direction confidence · Kalman
                            smoothing · stop-state classification ·
                            leader-follower ordering  (src/state-estimation/)
                                                 │
                                                 ▼
                       vehicle_states · headway_states · bunching_incidents
                                                 │
                      scheduler (src/scheduler/): TTL sweep · headway compute
                                 · geometry refresh · GPS poll
                                                 │
                                                 ▼
                                     MPC (src/mpc/) ──► POST /v1/mpc/solve
                                                 │
                       dispatcher approval (required) ──► commands lifecycle
                                                 │
                    ┌────────────────────────────┴────────────────────────┐
        signed webhook (HMAC-SHA256)                        service-token REST
        control-service ──► this app                        this app ──► control-service
        POST /api/control-service/webhook                   GET /v1/... · POST .../ack
```

| Piece | Location | Responsibility |
| --- | --- | --- |
| Process entrypoint | `control-service/src/index.ts` | Env load, Sentry, listener, background rehydration, scheduler, graceful shutdown |
| HTTP surface | `control-service/src/routes/` | commands, vehicle-states, mpc, headway, pilot rollout/KPI/war-room, positions, health |
| State estimation | `control-service/src/state-estimation/` | Map matching, direction confidence, Kalman filter, stop-state classification, ordering |
| MPC | `control-service/src/mpc/` | Solver + safety envelope + self-equalizing / two-way-hold / terminal-dispatch / occupancy controllers |
| Scheduler | `control-service/src/scheduler/` | GPS poll, headway compute sweep, geometry refresh, command TTL sweep |
| Webhooks | `control-service/src/webhooks/` | HMAC-SHA256 signing and delivery of command-lifecycle events |
| Datastore | `control-service/db/migrations/` | Its own Postgres/PostGIS instance — never this app's |

On this app's side: `src/lib/controlService/` is the outbound REST client
(service-token bearer, fixed timeout, circuit breaker),
`src/app/api/control-service/webhook/` verifies and ingests inbound signed
deliveries, and `/ops/*` renders the result. The two datastores are never
joined; correlation happens across the REST boundary only.

Two operational commands worth knowing: `pnpm migrate:ops` applies this app's
own `db/migrations/`, and `pnpm migrate` inside `control-service/` applies
that service's. They are separate runners against separate databases on
purpose.

## Security posture

- Secrets stay server-side; only `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` reaches the
  browser, and only to render the basemap.
- Registration numbers are validated by regex + Zod before reaching upstream.
- The diagnostics drawer reports configuration *presence*, never values.
- The inspector redacts device identifiers and personal fields before writing
  fixtures.
- No raw upstream payload is persisted client-side.
