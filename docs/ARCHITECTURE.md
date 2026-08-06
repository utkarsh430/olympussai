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

## Persistent control service (future)

If an always-on control service (AVL/dispatch) is introduced, its boundary
with this app — REST/webhook contract, service-to-service auth, per-direction
failure isolation, dispatcher-authorization enforcement — is decided in
[`docs/CONTROL_SERVICE_INTEGRATION.md`](./CONTROL_SERVICE_INTEGRATION.md).
Nothing described there is implemented yet.

## Security posture

- Secrets stay server-side; only `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` reaches the
  browser, and only to render the basemap.
- Registration numbers are validated by regex + Zod before reaching upstream.
- The diagnostics drawer reports configuration *presence*, never values.
- The inspector redacts device identifiers and personal fields before writing
  fixtures.
- No raw upstream payload is persisted client-side.
