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
live upstream  →  fresh cache  →  last-known-good (flagged stale)  →  sanitized fixture
```

Every stage is labelled distinctly in the UI. There is no state in which the
operator sees a blank screen or an unhandled error.

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

## Security posture

- Secrets stay server-side; only `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` reaches the
  browser, and only to render the basemap.
- Registration numbers are validated by regex + Zod before reaching upstream.
- The diagnostics drawer reports configuration *presence*, never values.
- The inspector redacts device identifiers and personal fields before writing
  fixtures.
- No raw upstream payload is persisted client-side.

## Depot Management module

The depot module (`/project/depots`, `src/lib/depot/`) is a second consumer of
the same upstream fetch as the command centre. Full reference:
[`DEPOT_MANAGEMENT.md`](DEPOT_MANAGEMENT.md).

```
UPSRTC getGpsLiveData.php
   │  single-flight fetch, 15s TTL, last-known-good, fixture
   ▼
src/lib/upsrtc/liveSnapshot.ts ── map projection ──► /api/upsrtc/live
   │
   └── depot projection (depotNormalizer.ts, models/depotLive.ts)
          ▼
   repositories/ (fleet: live; history, crew, fuel, revenue: modelled)
          ▼
   live/analysis.ts — states, locations, yards, scores, exceptions,
                      once per snapshot rows array
          ▼
   live/*View.ts — one body per route, memoised per snapshot;
                   feed envelope built per request
          ▼
   /api/upsrtc/depot/* (17 GET + copilot POST)  ◄── browser polls every 60s
```

| Layer | Location | Responsibility |
| --- | --- | --- |
| Shared snapshot | `src/lib/upsrtc/liveSnapshot.ts` | One upstream fetch, two projections; fallback ladder as above |
| Depot schema | `src/models/depotLive.ts`, `src/lib/upsrtc/depotNormalizer.ts` | The depot projection of each feed row |
| Repositories | `src/lib/depot/repositories/` | The seam to data; composition root in `index.ts` |
| Analysis and views | `src/lib/depot/live/` | Per-snapshot analysis; one view builder per route |
| Inference, scoring, optimisers, models | `infer/`, `score/`, `exceptions/`, `optimise/`, `sim/`, `forecast/` | Pure TypeScript, no clock but the feed's |
| Routes | `src/app/api/upsrtc/depot/` | Session check, validation, fixed errors, `no-store` |
| Pages | `src/app/(protected)/project/depots/`, `src/components/depot/` | Network and depot scopes |
| Copilot | `src/lib/depot/copilot/` | Facts, closed-vocabulary checks, providers |

**Feed clock.** Every age, window and operating date is measured against the
snapshot's own `feedNow`, so a stale or fixture snapshot is internally
consistent.

**In-process state.** The rolling 20-minute score window, the yard memory
(holds of up to 12 hours), memoised analyses, the route-profile cache, the
allocation plan, rate limiters and the copilot's caches, allowances and
breaker all live in server memory. A restart or cold start clears them; with
several instances each has its own copy, so scores can be summed over
different windows and every limit and budget multiplies. A shared store is
not built.

**Copilot provider seam.** `CopilotProvider` (`src/lib/depot/copilot/types.ts`)
has two implementations: `scripted` and `claude-cli` (the local `claude`
command, usable only where Claude Code is signed in). An API-key provider for a
staff-facing deployment would be a third implementation behind the same
interface; it is not built. See
[`DEPOT_COPILOT_OPERATIONS.md`](DEPOT_COPILOT_OPERATIONS.md).

**Next step: the database phase (not built).** A history store of daily
per-depot snapshots, filled by an ingestion worker, behind the existing
`HistoryRepository` interface; real feeds for crew, fuel and revenue as new
adapters in the composition root; and a shared store for the state listed
above. Pages and algorithms stay as they are.
