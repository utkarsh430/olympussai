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
