# Production Roadmap

This prototype demonstrates an interface and a workflow. Turning it into an
operational system requires the work below. Nothing here is implemented.

## Phase 0 — Authorization (prerequisite)

- Formal UPSRTC approval to operate against production telemetry.
- Data-sharing and retention agreement.
- Security review and penetration test.
- Named operational owner within UPSRTC.

**No production deployment should proceed without this phase complete.**

## Phase 1 — Pilot (90 days, one depot, one corridor)

Scope deliberately narrow: bunching detection and driver communication only.

| Workstream | Work |
| --- | --- |
| Data | Stable upstream contract; agreed SLA; historical archive for training |
| Bunching | Replace the template with a real headway model using actual AVL history |
| Communication | Integrate an approved messaging channel; consent and audit requirements |
| Evaluation | Advisory mode only — log every recommendation and every dispatcher decision |
| Success criteria | Measured change in bunching frequency and dispatcher response time |

The pilot's purpose is to replace the illustrative figures in this prototype
with measured ones.

## Phase 2 — Traffic and incident intelligence

- Licensed traffic data source, or UPSRTC's own corridor speed history.
- Real routing engine for alternatives (with approved-corridor constraints).
- Breakdown detection from vehicle telematics rather than a demo button.
- Rescue ranking against real vehicle availability, capacity and duty rosters.

## Phase 3 — Demand and fleet optimization

- Ridership data ingestion (ticketing, APC, or both).
- Demand forecasting validated against historical loading.
- Redistribution recommendations constrained by crew rostering and duty limits.
- Depot-level reserve management.

## Phase 4 — Platform hardening

| Area | Requirement |
| --- | --- |
| Backend | Move from in-memory cache to Redis; horizontal scaling |
| Storage | Time-series store for telemetry history |
| Auth | SSO, role-based access, dispatcher identity on every action |
| Audit | Server-side immutable audit trail (the prototype's is browser-local) |
| Realtime | WebSocket/SSE push instead of 15s polling |
| Observability | Metrics, tracing, alerting, upstream health SLOs |
| Resilience | Multi-region failover; graceful degradation drills |
| Compliance | Data retention policy; driver privacy protections |

## Depot Management — road to production

The depot module (`/project/depots`) is built on the live GPS feed, with every
missing data set modelled behind a repository interface
(`src/lib/depot/repositories/`). Its reference is
[`DEPOT_MANAGEMENT.md`](DEPOT_MANAGEMENT.md); the schema each feed must provide
is on the module's Data sources page (`src/lib/depot/sources/registry.ts`).
None of the work below is done.

### Data the corporation must supply

| Data | Replaces | Minimum content |
| --- | --- | --- |
| Depot master | Inferred yards; modelled parking capacity, bays and lanes | Depot id matching the feed, name, kind, region, coordinates, parking capacity, bays |
| Timetable or vehicle blocks | Modelled requirement, duties and trip frequency | Route, trip, operating depot, block, direction, departure and arrival times, days of operation |
| Route and stop master | Per-route lookups through one running bus | Stops with ids, sequence and coordinates; route length |
| Fleet master | Modelled bus class, seats and age | Registration, home depot, bus type, seats, year of manufacture, status |
| Maintenance | Modelled odometer and service schedule | Work orders: bus, category, opened, expected return, closed |
| Crew | Modelled anonymous slots and availability | Per depot and date: anonymous slot, role, availability, hours this week |
| Fuel | Modelled consumption | Per bus and day: distance, litres issued, class, route |
| Ticketing | Modelled load, boardings, revenue and economics | Per route and day: trips, seat-kilometres, boardings, revenue, route length |
| Field meanings | — | The unit of the feed's `distance` field, what `delayMinutes` measures, and the meaning of tamper codes other than `C` |

### Platform work

| Area | Requirement |
| --- | --- |
| Accounts | Real user accounts in place of the shared PIN, and per-depot permissions (a depot manager sees their depot); today any PIN holder opens every depot |
| History | A database of daily per-depot snapshots and an ingestion worker that writes them, behind the existing `HistoryRepository`; trends and forecasts then stop being modelled |
| Copilot | An API-key provider behind `CopilotProvider` (`src/lib/depot/copilot/types.ts`); the current Claude provider is the local `claude` command, for the owner's own machine only. Before any staff-facing provider is switched on, the wording rules recorded as open for the owner-only path must be enforced on every draft: a later sentence denying an earlier one, obligation words, and a true figure given a false meaning, scope or window (rulings S59, S61; see [`DEPOT_COPILOT_OPERATIONS.md`](DEPOT_COPILOT_OPERATIONS.md#what-a-claude-draft-can-still-say)) |
| Shared state | A shared store for the rolling score window, yard memory, route-profile cache, rate limiters and copilot caches and budget, so several instances agree and a restart does not reset them |
| Route details | An agreed policy with the owner of the schedule API on lookup volume, or the route and stop master above, before any bulk fetching. Today details are fetched one route at a time on a person's action, at most 40 routes a press of the Routes page's loader |
| Timetable-fixed day | With a real timetable the modelled day becomes fixed; today it is recomputed from each snapshot and worded "as of the feed time" |
| Decision trail | Transfer approvals and rejections stored server-side with the user's identity (today they are kept in the browser) |

---

## Explicit non-goals for any near-term phase

- Autonomous execution of operational instructions. The dispatcher-authorization
  model is a permanent design constraint, not a transitional one.
- Passenger-facing deployment.
- Driver performance scoring or disciplinary use of telemetry.

## Known gaps in the current prototype

| Gap | Impact |
| --- | --- |
| Audit trail is browser-local | Not suitable as an operational record |
| Cache is per-process in-memory | Will not survive restart or scale horizontally |
| No authentication | Anyone with the URL sees the fleet |
| No rate limiting on proxy routes | Upstream could be overloaded by request volume |
| Schedule polylines skip unsurveyed stops | Route geometry is partial where upstream lacks coordinates |
| No historical data | All analysis is instantaneous; no trend detection |
