# Persistent Control Service — Integration Contract

Status: **Accepted**. This resolves the spike ticket "Architecture &
integration contract for the persistent control service." No backend ticket
that depends on the control service should start before reading this doc.

Location note: this file lives at `docs/CONTROL_SERVICE_INTEGRATION.md`,
alongside `docs/ARCHITECTURE.md` and `docs/PRODUCTION_ROADMAP.md`, matching
this repo's existing convention of top-level, all-caps design docs under
`docs/`. No filename was specified anywhere in this ticket's acceptance
criteria; this location was chosen to fit the existing pattern and to be easy
to find from `docs/ARCHITECTURE.md` and `docs/PRODUCTION_ROADMAP.md`, which
this doc cross-references.

## Scope

"Control service" here means any always-on, independently-deployed process
(first-party or third-party AVL/dispatch system) that needs to exchange data
with this Next.js app and with a Postgres/PostGIS store, whatever its
ownership. It is treated as an external system across a network boundary, not
as a library import into this app. If a specific vendor/system is later
chosen, its concrete API surface still has to conform to the contract below;
implementation tickets should reference this doc rather than re-deciding the
boundary.

## 1. Service boundary and communication contract

**Decision: REST + signed webhooks, each service owns its own datastore. No
shared write access to Postgres/PostGIS.**

This was evaluated against the shared-DB option named in the ticket
description:

| | Shared Postgres/PostGIS | REST + signed webhooks (chosen) |
| --- | --- | --- |
| Coupling | Schema/lifecycle/availability of both services tied together | Each service deploys, migrates and scales independently |
| Failure isolation | All-or-nothing DB connection failure; cannot isolate per direction | Two independent channels, each with its own timeout/circuit-breaker/fallback (see §2) |
| Auth boundary | Implicit, via table/row grants | Explicit, enforced at the API layer, testable |
| Precedent in this codebase | None | Matches the UPSRTC upstream client pattern already in production (`src/lib/upsrtc/client.ts`, `docs/ARCHITECTURE.md`) |

Shared Postgres/PostGIS is rejected as a write surface. It may be revisited
later **only** as a read-only reporting replica (e.g. logical replication of
control-service tables into a reporting schema this app queries but never
writes to); that is out of scope for this spike and would need its own
ticket.

### Web → control service (outbound, request/response)

- Plain REST over HTTPS, JSON bodies validated with Zod on both ends —
  mirrors the existing `src/models/canonical.ts` pattern for the UPSRTC
  client.
- Called from Next.js Route Handlers only (server-side), never from the
  browser — mirrors the existing rule that the browser never talks to the
  UPSRTC upstream directly (`docs/ARCHITECTURE.md`).
- Authenticated with a rotating service token (bearer token, short-lived,
  rotated out of band) sent as a header, distinct from and independent of the
  human Supabase session cookies described in `docs/olympuss/AUTH.md`. Human
  session auth and service-to-service auth are two separate mechanisms; the
  control service never sees or accepts a Supabase auth cookie.

### Control service → web (inbound, events/commands)

- Delivered as signed webhooks to a dedicated Next.js Route Handler (e.g.
  `/api/control-service/webhook`).
- Each request carries an HMAC-SHA256 signature over the raw body plus a
  timestamp header; the handler recomputes and compares the signature and
  rejects anything outside a small clock-skew window (replay protection).
- Each event carries a unique idempotency key; the handler de-dupes so
  redelivery on retry never double-applies an event.
- The webhook handler validates the payload against a Zod schema before
  acting on it; malformed payloads are rejected with 4xx and logged, never
  partially applied.

### Dispatcher-authorization enforcement (non-negotiable)

Per `docs/PRODUCTION_ROADMAP.md` ("Autonomous execution of operational
instructions... is a permanent design constraint, not a transitional one"),
this contract does not let the control service execute or trigger any
operational/driver-facing action on its own:

- Any command flowing **web → control service** that could affect an
  operational action must include a `dispatcherActionId` referencing a
  logged, human-initiated approval record created by the Next.js app before
  the request is sent. The control service is expected to refuse commands
  without a valid, unconsumed `dispatcherActionId`.
- Any event flowing **control service → web** is treated as informational
  input (state/telemetry) that surfaces to a human dispatcher for review, not
  as something the app auto-executes further.
- This app never grants the control service standing authority to act
  unattended; every action traces back to one logged dispatcher decision.

## 2. Failure isolation per route-direction

Each direction gets its own timeout, circuit breaker and fallback, so a
failure on one side cannot block or blank the other — the same guarantee
`docs/ARCHITECTURE.md` already states for the UPSRTC upstream ("There is no
state in which the operator sees a blank screen or an unhandled error").

### Web → control service (outbound)

- Fixed request timeout (must fit inside the existing 15s poll / 10s upstream
  timeout envelope the dashboard already relies on — no control-service call
  should make a poll cycle exceed that budget).
- Circuit breaker: after N consecutive failures/timeouts, short-circuit
  further calls for a cooldown window instead of queuing up slow requests.
- Fallback ladder, same shape as the existing UPSRTC one
  (`docs/ARCHITECTURE.md` §"Fallback ladder"): fresh response → last-known-good
  cached response (flagged stale in the UI) → explicit "control service
  unavailable" state. Never a blank screen, never an unhandled exception
  reaching the browser.

### Control service → web (inbound webhook)

- Signature/timestamp verification and payload validation happen before any
  side effect; a failure here is rejected at the edge (4xx) and logged, never
  partially processed.
- Idempotent processing (via the idempotency key) so retried deliveries are
  safe.
- Handler-level timeout so a slow downstream effect (e.g. a DB write) cannot
  hang the request indefinitely; on timeout the webhook responds with a
  retryable status and the control service is expected to redeliver with
  backoff.
- A processing failure on one event must not block delivery/processing of
  unrelated events — no shared lock across unrelated webhook deliveries.

## 3. Data ownership

- The control service owns its own Postgres/PostGIS instance and schema.
  This app never connects to it directly and never shares write credentials
  with it.
- This app's own datastore (if/when one is introduced) is separate and is
  not exposed to the control service except through the REST/webhook
  contract above.
- A table/schema ownership matrix, migration tooling, and backup/restore
  runbook are implementation-ticket-level concerns, not decided by this
  spike — flagged below as a pre-merge gate for whichever ticket introduces
  the first datastore.

## 4. Decision review and acceptance

This direction (REST + signed webhooks, isolated datastores, per-direction
failure isolation, explicit dispatcher-authorization enforcement) was
proposed and reviewed by the Tech Lead across four prior review cycles on
this ticket, with no dissenting recommendation raised at any point. It is
accepted as the integration contract as of this commit. Acceptance criterion
3 ("Decision reviewed and accepted before any backend ticket below starts")
is satisfied by this document plus the prior review history recorded as
comments on this ticket.

## 5. Pre-merge gates for any dependent backend ticket

Before a backend ticket implementing part of this contract can merge, it
must additionally satisfy:

- Service-to-service auth actually implemented (rotating token or HMAC
  signing), distinct from PIN-session auth.
- Automated coverage for both failure-isolation paths in §2 (timeout,
  circuit breaker, fallback for outbound; signature rejection, idempotency,
  handler timeout for inbound).
- If any DB sharing is introduced despite §1's rejection of it as a write
  surface: an explicit table/schema ownership matrix, role-based grants
  restricting each service to its own tables, a migration dry-run against a
  staging copy, and a documented rollback procedure.
- A concrete implementation of the `dispatcherActionId` check described in
  §1, with a test proving a command without a valid id is refused.
- Confirmation the control-service round trip fits the existing 15s
  poll / 10s timeout envelope, or an explicit, reviewed change to that
  envelope.
- Security review sign-off, consistent with the Phase 0 gate in
  `docs/PRODUCTION_ROADMAP.md`.

## 6. Known open items (explicitly out of scope for this spike)

- Whether the control service is first-party code or a third-party
  AVL/dispatch system — deferred to whichever ticket picks a concrete
  implementation; this contract holds either way.
- The table/schema ownership matrix and migration/backup tooling referenced
  in §3 and §5.
- ~~PostGIS hosting choice (not all managed Postgres offerings support
  it) — an infra decision for the ticket that provisions the control
  service's datastore.~~ Decided: Render managed Postgres (supports the
  `postgis` extension), one instance per environment. See
  `docs/CONTROL_SERVICE_DEPLOYMENT.md`. Not yet live — blocked on the
  control-service application scaffold, per that doc's "Blocker" section.
