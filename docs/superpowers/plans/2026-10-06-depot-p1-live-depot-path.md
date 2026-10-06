# Depot Management P1 — Live Depot Data Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real per-depot figures computed on the server from the live GPS snapshot, served by one new API, and shown on the Network overview and a Data Sources registry with measured field coverage — every figure tagged with its provenance.

**Architecture:** One upstream fetch feeds two projections: the existing `CanonicalLiveBus[]` for the command centre and a new `DepotBusRow[]` that keeps the depot-relevant raw fields the current normaliser drops. A shared `getLiveSnapshot()` owns the cache, single-flight dedupe and the live → cache → last-good → fixture chain. Depot aggregates are pure functions over `DepotBusRow[]`, reached through a `FleetRepository` so a database can replace the snapshot later without touching callers.

**Tech Stack:** Next.js 15 route handlers (Node runtime), zod, vitest, React 19 client components, Tailwind, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-depot-management-design.md`, `docs/superpowers/specs/2026-10-06-depot-ui-design-brief.md`.

## Global Constraints

- Reference is tracked code only. Never read, copy from, stage or modify `control-service/`, `.preview-simulator/`, `.claude/`. Never read `.env*`.
- Stage by explicit path; one commit per small logical change; conventional prefix; trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. No push.
- The response of `GET /api/upsrtc/live` must be byte-for-byte the same shape as before (`LiveFeedResponse`), and all 224 pre-existing unit tests plus the existing e2e spec stay green.
- The browser never calls the upstream. Depot rows are never shipped to the browser in bulk; only aggregates are.
- Every figure the UI shows carries a provenance: `live`, `derived`, `modelled` or `reference`, rendered LIVE / DERIVED / MODELLED / REFERENCE. The word "simulated" never appears in rendered UI.
- Every derived figure that is computed from a subset of the fleet carries `coverage: { n, of }` and the UI shows it.
- "Now" for any age or due-by calculation is `feedNow` (the newest `receivedTime` in the payload), never `Date.now()`. Upstream stamps wall-clock times with a `Z` suffix, so comparing them with the server clock is wrong; comparing them with each other is right.
- A bus with no valid GPS position still belongs to its depot's fleet strength. Position is nullable in the depot projection.
- TypeScript strict, no `any`, explicit types on exports, `readonly` inputs, no mutation, no `console.log`, files under about 200 lines, no new npm dependencies.
- Route handlers declare `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`, call `requireUpsrtcAccess()` first, and answer through `jsonResponse` from `src/lib/upsrtc/respond.ts`.
- UI follows the design brief: flat `depot-*` surfaces, no type below 11px in new components, every page ends in the shell's `FooterDisclaimer`.

## Deviations from the master design (ruled before execution)

- The per-depot detail API (`/api/upsrtc/depot/[depotId]`) moves to P3, where its first consumer (the depot cockpit) is built.
- The odometer calibration script moves to P7, where the first odometer feature is built.

## Review Focus

1. Upstream returns a wrapper object, a JSON string, `"None"`/`""` sentinels, or a malformed time such as `2026-07-19T1 day, 3:01:41Z`: the depot normaliser must yield nulls, never throw, never emit `Invalid Date`. Task 1.
2. Two requests arrive while the cache is cold: exactly one upstream fetch may happen. Task 2.
3. Upstream fails after a previous success: both projections must come from the same last-good snapshot, flagged stale; they must never mix a fresh one with a stale one. Task 2.
4. A depot with zero buses reporting, or a feed where `feedNow` is null: shares must be `0`/`null` with coverage, never `NaN` or `Infinity`. Task 3.
5. The network API is called without a session cookie: 401 with no data. Task 4 and e2e.
6. The overview is opened while the API is failing: an error panel with Retry, not a blank page or an endless loader. Task 6 and e2e.

---

### Task 1: Depot projection — schema and normaliser

**Files:**
- Modify: `src/lib/upsrtc/normalizer.ts` — add `export` to `pick`, `toStringOrNull`, `parseTimestamp`, `toBooleanOrNull` and to the `REG_ALIASES`, `LAT_ALIASES`, `LNG_ALIASES`, `SPEED_ALIASES`, `ROUTE_ID_ALIASES`, `ROUTE_NAME_ALIASES`, `TRIP_ALIASES` constants. No behaviour change.
- Create: `src/models/depotLive.ts`
- Create: `src/lib/upsrtc/depotNormalizer.ts`
- Test: `src/tests/unit/depot-normalizer.test.ts`

**Interfaces — produces:**

```ts
// src/models/depotLive.ts  (zod schema `depotBusRowSchema`, type inferred)
export type DepotVehicleStatus = 'live' | 'stationary' | 'no_signal' | 'under_maintenance' | 'unknown';

export interface DepotBusRow {
  registrationNumber: string;
  latitude: number | null;          // null when upstream has no valid fix
  longitude: number | null;
  speedKmph: number | null;         // >= 0, one decimal
  ignitionOn: boolean | null;       // the raw ignition line; NOT forced on by speed
  gpsTimestamp: string | null;      // ISO, from `timestamp`
  receivedAt: string | null;        // ISO, from `receivedTime`
  depotId: string | null;           // `home_depot`, digits only
  depotName: string | null;         // `depot_name`
  vehicleStatus: DepotVehicleStatus;// from `vehicle_status` only
  tripStatus: string | null;        // raw `status` (Offline/Live/Stationary/Towing)
  routeId: string | null;
  routeName: string | null;
  routeDescription: string | null;
  journeyId: string | null;         // `vehicle_journey_id`
  journeyCode: string | null;       // `vehicle_journey_code`
  scheduledStart: string | null;    // ISO, feed clock
  scheduledEnd: string | null;
  actualStart: string | null;
  delayMinutes: number | null;      // raw upstream `delay`, one decimal; plausibility is judged later
  odometerRaw: number | null;       // upstream `distance`; unit not yet confirmed
  mainPowerOn: boolean | null;      // `mainPowerStatus`
  mainVoltage: number | null;       // `mainInputVoltage`
  tamperCode: string | null;        // raw `tamperAlert` code (observed C / W / O)
  emergency: boolean | null;        // `emergencyStatus`
}

// src/lib/upsrtc/depotNormalizer.ts
export interface NormalizeDepotResult {
  rows: DepotBusRow[];
  recordCount: number;
  rejectedRecordCount: number;      // non-records and rows without a registration
}
export function normalizeDepotRows(payload: unknown): NormalizeDepotResult;
/** Newest `receivedAt` across the rows, or null when none carries one. */
export function deriveFeedNow(rows: readonly DepotBusRow[]): string | null;
```

Rules:
- Reuse `extractArray`, `isRecord`, `pick`, `toNumber`, `toStringOrNull`, `parseTimestamp`, `toBooleanOrNull`, `isValidCoordinate` from `normalizer.ts`. Do not re-implement them.
- A row is rejected only when it is not a record or has no registration. Invalid or `0,0` coordinates set `latitude` and `longitude` to null; the row is kept.
- `depotId`: `home_depot` as a trimmed string if it matches `^\d{1,6}$`, else null.
- `vehicleStatus`: `vehicle_status` lower-cased and trimmed; one of the four known values, else `'unknown'`. Never read `status` for it.
- `delayMinutes`: `toNumber`, rounded to one decimal, null when not finite.
- `speedKmph`: same rounding and clamp as the live normaliser (`Math.max(0, Math.round(v * 10) / 10)`).
- `ignitionOn`: `toBooleanOrNull(row.ignition)` with no speed override.
- Duplicate registrations: keep the row with the newest `gpsTimestamp` (same rule as `normalizeLivePayload`).
- The function builds new objects; it never mutates the payload.

- [ ] **Step 1: Failing tests** (`depot-normalizer.test.ts`). Use a `makeRaw(overrides)` factory based on this real record shape:

```ts
const BASE_RAW = {
  regNum: 'UP78JT4102', latitude: 28.36, longitude: 79.43, speed: 15.34, ignition: 1,
  timestamp: '2026-07-20T07:01:32Z', receivedTime: '2026-07-20T07:01:50Z',
  home_depot: '81', depot_name: 'BAREILLY(R)', vehicle_status: 'live', status: 'Live',
  route: 10869, routename: 'BLY_9509_ORD', route_description: 'BAREILLY OLD BUS STATION TO ANAND VIHAR',
  vehicle_journey_id: 57833, vehicle_journey_code: 'BLY0524',
  scheduled_start_time: '2026-07-20T07:05:00Z', actual_start_time: 'None',
  scheduled_end_time: '2026-07-20T15:05:00Z', delay: -5.433333333333334,
  distance: 83990, mainPowerStatus: 1, mainInputVoltage: 28.08, tamperAlert: 'C', emergencyStatus: 0,
};
```

  Cases (one `it` each):
  1. maps every field of `BASE_RAW` to the expected `DepotBusRow` (assert the whole object with `toEqual`; `actualStart` is null, `delayMinutes` is `-5.4`, `depotId` is `'81'`, `routeId` is `'10869'`, `journeyId` is `'57833'`).
  2. keeps a row whose coordinates are `0,0` or missing, with null position.
  3. rejects a row with no registration and counts it; counts a non-object entry as rejected.
  4. `vehicle_status` of `'UNDER_MAINTENANCE '` maps to `'under_maintenance'`; an unseen value maps to `'unknown'`; `status: 'Live'` with `vehicle_status: 'no_signal'` yields `vehicleStatus: 'no_signal'` and `tripStatus: 'Live'`.
  5. sentinels `''`, `'None'`, `'null'` become null for depot, route and times.
  6. the malformed time `'2026-07-19T1 day, 3:01:41Z'` becomes null (no throw, no `Invalid Date`).
  7. `home_depot` of `'81'`, `81` → `'81'`; `'DEPOT-81'`, `''` → null.
  8. a non-numeric `delay` becomes null; `Infinity` becomes null.
  9. duplicate registrations keep the newest `gpsTimestamp`.
  10. unwraps `{ data: [...] }` and a JSON string payload.
  11. a bare string payload (`' Bus Not Assigned!!! '`) yields zero rows without throwing.
  12. does not mutate its input (deep-freeze the input array and its records first).
  13. `deriveFeedNow` returns the newest `receivedAt`; null for an empty list or when none is set.
  14. every row produced from `src/fixtures/upsrtc-live-sample.json` parses against `depotBusRowSchema`, and the result has 400 rows and 113 distinct `depotId` values.

  Run `npx vitest run src/tests/unit/depot-normalizer.test.ts`; expect FAIL (module missing). Commit `test: specify the depot bus projection`.

- [ ] **Step 2:** export the helpers from `normalizer.ts`; run `npm run test` (224 still pass). Commit `refactor: export normaliser field helpers for reuse`.
- [ ] **Step 3:** create `src/models/depotLive.ts`. Commit `feat: add depot bus row schema`.
- [ ] **Step 4:** create `src/lib/upsrtc/depotNormalizer.ts`; run the focused test to GREEN, then `npm run test && npm run typecheck && npm run lint`. Commit `feat: normalise the live feed into depot bus rows`.

---

### Task 2: Shared live snapshot

**Files:**
- Create: `src/lib/upsrtc/liveSnapshot.ts`
- Modify: `src/app/api/upsrtc/live/route.ts` (becomes a thin caller)
- Test: `src/tests/unit/live-snapshot.test.ts`

**Interfaces — consumes** `fetchUpstream`, `UPSRTC_LIVE_URL`, `REQUEST_TIMEOUT_MS` (`client.ts`), `normalizeLivePayload` (`normalizer.ts`), `normalizeDepotRows`, `deriveFeedNow` (Task 1), `TtlCache` (`cache.ts`), `src/fixtures/upsrtc-live-sample.json`.

**Produces:**

```ts
export interface LiveSnapshot {
  readonly buses: CanonicalLiveBus[];
  readonly depotRows: DepotBusRow[];
  readonly recordCount: number;
  readonly rejectedRecordCount: number;
  readonly fetchedAt: string;        // server ISO time the snapshot was built
  readonly feedNow: string | null;   // deriveFeedNow(depotRows)
}
export interface LiveSnapshotResult {
  readonly snapshot: LiveSnapshot;
  readonly source: UpstreamSource;   // 'live' | 'cache' | 'fixture'
  readonly stale: boolean;
}
export const LIVE_CACHE_TTL_MS = 15_000;
export const liveDiagnostics: { lastAttemptAt: string | null; lastSuccessAt: string | null;
  lastError: string | null; lastStatus: number; consecutiveFailures: number };
export function getLiveSnapshot(now?: number): Promise<LiveSnapshotResult>;
/** Test seam: drop the cache, any in-flight fetch and the diagnostics. */
export function resetLiveSnapshotForTests(): void;
```

Behaviour (identical to today's route, now shared):
1. `NEXT_PUBLIC_DEMO_MODE === '1'` → fixture snapshot, `source: 'fixture'`, `stale: true`, no upstream call.
2. Fresh cache entry → `source: 'cache'`, `stale: false`.
3. Otherwise fetch upstream. **Single-flight:** keep the in-flight promise in a module variable; concurrent callers await the same promise; clear it in `finally`.
4. Success with at least one normalised bus → cache it, `source: 'live'`, `stale: false`.
5. Failure, or success with zero buses → last-good entry if any (`source: 'cache'`, `stale: true`), else fixture (`source: 'fixture'`, `stale: true`). Update `liveDiagnostics` exactly as the route does today.
6. Both projections in one snapshot always come from the same payload.

Move `liveDiagnostics` out of the route file into `liveSnapshot.ts`. First `grep -rn "liveDiagnostics" src` — if something imports it from the route, re-point that import.

The route becomes: authorise → `getLiveSnapshot(Date.now())` → build `LiveFeedResponse` `{ buses, fetchedAt, source, stale, recordCount, rejectedRecordCount }` → `jsonResponse`. One deliberate, documented nuance to preserve: for a fixture response `fetchedAt` is the current time, as today.

- [ ] **Step 1: Failing tests.** Mock `@/lib/upsrtc/client` (`fetchUpstream` as `vi.fn`), call `resetLiveSnapshotForTests()` and restore `process.env.NEXT_PUBLIC_DEMO_MODE` in `beforeEach`/`afterEach`. Cases:
  1. cold cache, upstream ok → `source 'live'`, `stale false`, `buses.length` and `depotRows.length` both > 0, `feedNow` set.
  2. second call within TTL (pass `now` explicitly) → `source 'cache'`, `fetchUpstream` called once in total.
  3. call after TTL → `fetchUpstream` called again.
  4. **single-flight:** two calls started before the first resolves (use a deferred promise in the mock) → `fetchUpstream` called exactly once and both callers receive the same snapshot object.
  5. upstream fails with no history → `source 'fixture'`, `stale true`, 400 depot rows.
  6. upstream succeeds then fails after TTL → `source 'cache'`, `stale true`, and `snapshot` is the same object as the first success (both projections from one payload).
  7. upstream ok but zero usable buses → treated as failure (falls to last-good or fixture) and `liveDiagnostics.lastError` is set.
  8. demo mode → fixture, `fetchUpstream` never called.
  9. a rejected upstream promise (the mock throws) does not leave the in-flight slot stuck: the next call fetches again.
  10. diagnostics: `consecutiveFailures` increments on failure and resets on success.

  Expect FAIL; commit `test: specify the shared live snapshot`.
- [ ] **Step 2:** implement `liveSnapshot.ts`; GREEN. Commit `feat: add shared live snapshot with single-flight fetch`.
- [ ] **Step 3:** refactor the route to call it; `npm run test && npm run typecheck && npm run lint && npm run build`. Commit `refactor: serve the live route from the shared snapshot`.

---

### Task 3: Depot domain types, aggregates and the repository seam

**Files:**
- Create: `src/lib/depot/types.ts`, `src/lib/depot/labels.ts`
- Create: `src/lib/depot/live/depotKind.ts`, `src/lib/depot/live/aggregate.ts`, `src/lib/depot/live/coverage.ts`
- Create: `src/lib/depot/repositories/types.ts`, `src/lib/depot/repositories/liveFleetRepository.ts`, `src/lib/depot/repositories/index.ts`
- Test: `src/tests/unit/depot-aggregate.test.ts`, `src/tests/unit/depot-coverage.test.ts`

**Produces:**

```ts
// types.ts
export type Provenance = 'live' | 'derived' | 'modelled' | 'reference';
export interface Coverage { readonly n: number; readonly of: number }
export interface Figure<T = number> {
  readonly value: T; readonly provenance: Provenance;
  readonly coverage?: Coverage; readonly note?: string;
}
export type DepotKind = 'depot' | 'hired' | 'electric' | 'enforcement' | 'unassigned';
export const UNASSIGNED_DEPOT_ID = 'unassigned';
export interface StatusMix {
  readonly live: number; readonly stationary: number; readonly noSignal: number;
  readonly underMaintenance: number; readonly unknown: number;
}
export interface DepotSummary {
  readonly id: string; readonly name: string; readonly kind: DepotKind;
  readonly fleet: number;                 // every registration homed here
  readonly status: StatusMix;             // counts by upstream vehicle_status
  readonly reporting: number;             // GPS fix within REPORTING_WINDOW_MIN of feedNow
  readonly positioned: number;            // rows with a valid position
  readonly assigned: number;              // rows carrying a route name
  readonly powerCut: number;              // mainPowerOn === false
  readonly tamperFlagged: number;         // tamperCode present and not 'C'
  readonly centroid: { readonly lat: number; readonly lng: number } | null; // median position
}
export interface NetworkKpis {
  readonly fleet: Figure; readonly depots: Figure; readonly reporting: Figure;
  readonly onRoad: Figure; readonly stationary: Figure; readonly noSignal: Figure;
  readonly underMaintenance: Figure; readonly assigned: Figure;
}
export interface FieldCoverage { readonly field: string; readonly label: string;
  readonly populated: number; readonly of: number }
export interface DepotNetworkResponse {
  readonly depots: readonly DepotSummary[]; readonly kpis: NetworkKpis;
  readonly coverage: readonly FieldCoverage[];
  readonly feedNow: string | null; readonly fetchedAt: string;
  readonly source: UpstreamSource; readonly stale: boolean; readonly recordCount: number;
}

// labels.ts
export const PROVENANCE_LABEL: Record<Provenance, string>; // LIVE, DERIVED, MODELLED, REFERENCE
export const DEPOT_KIND_LABEL: Record<DepotKind, string>;

// live/depotKind.ts
export function classifyDepotKind(name: string | null): DepotKind;

// live/aggregate.ts
export const REPORTING_WINDOW_MIN = 30;
export function summariseDepots(rows: readonly DepotBusRow[], feedNow: string | null): DepotSummary[];
export function networkKpis(depots: readonly DepotSummary[]): NetworkKpis;

// live/coverage.ts
export function fieldCoverage(rows: readonly DepotBusRow[]): FieldCoverage[];

// repositories/types.ts
export interface FleetSnapshotView {
  readonly rows: readonly DepotBusRow[]; readonly feedNow: string | null;
  readonly fetchedAt: string; readonly source: UpstreamSource; readonly stale: boolean;
  readonly recordCount: number;
}
export interface FleetRepository { snapshot(): Promise<FleetSnapshotView> }
export interface DepotRepositories { readonly fleet: FleetRepository }

// repositories/index.ts — the single composition root
export function getRepositories(): DepotRepositories;
```

Rules:
- `classifyDepotKind`: name starting `ENFORCEMENT` (case-insensitive) → `'enforcement'`; containing the word `HIRED` → `'hired'`; containing the word `ELECTRIC` → `'electric'`; null or empty → `'unassigned'`; otherwise `'depot'`.
- `summariseDepots`: group by `depotId`; rows with a null `depotId` go to one bucket with id `UNASSIGNED_DEPOT_ID`, name `'Unassigned'`. A depot's name is the most frequent `depotName` among its rows. `reporting` counts rows whose `gpsTimestamp` is within `REPORTING_WINDOW_MIN` minutes **before or after** `feedNow` (device clocks run slightly ahead); it is `0` for every depot when `feedNow` is null. `centroid` is the per-axis median of valid positions, null when there are none. Output sorted by `fleet` descending, then `name`.
- `networkKpis`: totals over every bucket; `depots.value` counts only `kind === 'depot'`. `fleet`, `onRoad`, `stationary`, `noSignal`, `underMaintenance` are `provenance: 'live'`; `reporting`, `assigned`, `depots` are `'derived'`. Each count figure carries `coverage: { n: value, of: fleetTotal }`.
- `fieldCoverage`: one entry each, in this order, for depot (`depotId`), position, vehicle status (≠ `'unknown'`), GPS time, route (`routeName`), scheduled start, actual start, delay, odometer, main power, tamper code. `of` is `rows.length`.
- Nothing may produce `NaN` or `Infinity`.

- [ ] **Step 1: Failing tests** with a `makeRow(overrides): DepotBusRow` factory:
  - `classifyDepotKind`: `'BAREILLY(R)'`→depot, `'ENFORCEMENT_HQ'`→enforcement, `'enforcement_ayodhya'`→enforcement, `'KAISERBAGH HIRED'`→hired, `'NOIDA ELECTRIC'`→electric, `null`/`''`→unassigned, `'HIREDABAD'`→depot (word boundary).
  - `summariseDepots`: counts by status; null-depot rows land in the unassigned bucket; the name is the modal name; `reporting` respects the 30-minute window on both sides and is 0 when `feedNow` is null; a row with an invalid timestamp string is not reporting; `positioned` ignores null positions; centroid is the median, null with no positions; `powerCut` and `tamperFlagged` counts; order by fleet then name; input not mutated; empty input → `[]`.
  - `networkKpis`: totals; `depots` excludes non-depot kinds; coverage `of` equals fleet total; all-zero input yields zeros and no `NaN`.
  - `fieldCoverage`: order and counts on a hand-built 4-row set; empty input gives `populated: 0, of: 0` for every field.
  - Fixture check: `summariseDepots(normalizeDepotRows(fixture).rows, feedNow)` returns 113 buckets whose `fleet` values sum to 400.

  Expect FAIL; commit `test: specify depot aggregates and field coverage`.
- [ ] **Step 2:** `types.ts` and `labels.ts`. Commit `feat: add depot domain types and labels`.
- [ ] **Step 3:** `depotKind.ts`, `aggregate.ts`, `coverage.ts` to GREEN. Commit `feat: aggregate live rows into depot summaries`.
- [ ] **Step 4:** repository types, `liveFleetRepository.ts` (adapts `getLiveSnapshot()`), `index.ts`. Commit `feat: add fleet repository seam`.

---

### Task 4: Network API

**Files:**
- Create: `src/lib/depot/live/networkView.ts` — `buildNetworkResponse(view: FleetSnapshotView): DepotNetworkResponse`, memoised on `view.fetchedAt` + `view.source` (module-level single entry).
- Create: `src/app/api/upsrtc/depot/network/route.ts`
- Test: `src/tests/unit/depot-network-view.test.ts`

Route: `runtime 'nodejs'`, `dynamic 'force-dynamic'`, `export const maxDuration = 30`; `requireUpsrtcAccess()` → 401 via `unauthorizedResponse()`; `getRepositories().fleet.snapshot()`; `jsonResponse(buildNetworkResponse(view), { acceptEncoding })`. If the repository throws, answer `jsonResponse({ error: 'Depot data unavailable' }, { status: 503 })` and never leak the underlying message.

- [ ] **Step 1: Failing tests** for `buildNetworkResponse`: shape; passes `source`, `stale`, `fetchedAt`, `feedNow`, `recordCount` through; returns the *same object* for the same `fetchedAt`+`source` and a new one when either changes. Commit `test: specify the depot network view`.
- [ ] **Step 2:** implement view and route; `npm run test && npm run typecheck && npm run lint && npm run build` (route table lists `/api/upsrtc/depot/network`). Commit `feat: add depot network API`.

---

### Task 5: Depot UI foundation

**Files:**
- Create: `src/hooks/useDepotNetwork.ts` — `useDepotNetwork(): { data: DepotNetworkResponse | null; error: string | null; loading: boolean; refresh: () => void }`; polls `/api/upsrtc/depot/network` every `DEPOT_POLL_INTERVAL_MS = 60_000` with the abort-on-overlap pattern of `src/hooks/useLiveFleet.ts`; keeps the last good `data` when a later poll fails and sets `error`.
- Create: `src/components/depot/data/DepotNetworkProvider.tsx` — client context running the hook once; `useDepotNetworkContext()` throws a clear error outside the provider.
- Create: `src/components/depot/shell/ProvenanceBadge.tsx` — `ProvenanceBadge({ provenance, coverage? })`; text from `PROVENANCE_LABEL`; colours per the design brief; when `coverage` is given, an accessible suffix "n of N".
- Create: `src/components/depot/shell/FeedStatus.tsx` — top-bar chip: LIVE / CACHE / FIXTURE, "stale" when stale, and the feed time (`feedNow`) as `HH:MM`; `data-testid="depot-feed-status"`.
- Create: `src/components/depot/shell/DataStates.tsx` — `LoadingBlock`, `ErrorPanel({ message, onRetry })`, `StaleStrip({ since })`, `EmptyState({ children })`.
- Create: `src/components/depot/shell/DataTable.tsx` — generic, typed: `columns: readonly Column<T>[]` (`key`, `header`, `align`, `sortValue?`, `render`), `rows`, `rowKey`, `initialSort?`, `caption`. Real `<table>` with `<caption className="sr-only">`, `<th scope="col">`, sortable headers as buttons with `aria-sort`, sticky header, horizontal scroll inside its own container. Sorting is pure (copy then sort).
- Create: `src/lib/depot/format.ts` — `formatCount(n)`, `formatShare(n, of): string` (`'—'` when `of` is 0), `formatFeedTime(iso)`.
- Modify: `src/components/depot/shell/DepotShell.tsx` / `DepotTopBar.tsx` to mount the provider and `FeedStatus`.
- Test: `src/tests/unit/depot-format.test.ts`, `src/tests/unit/depot-table-sort.test.ts` (extract the sort into `sortRows(rows, column, direction)` in `src/lib/depot/tableSort.ts` and test that: numeric and string order, stability, direction, no mutation).

- [ ] Steps: tests first for `format.ts` and `tableSort.ts` (commit), then each component as its own commit: `feat: add depot formatters`, `feat: add depot table sorting`, `feat: add depot network hook and provider`, `feat: add provenance badge`, `feat: add depot data states`, `feat: add depot data table`, `feat: show feed status in the depot top bar`.

---

### Task 6: Network overview page

**Files:**
- Create: `src/components/depot/network/KpiBand.tsx` — eight figures from `NetworkKpis`; hero numerals in `font-display`; each with label, `ProvenanceBadge` and, for counts, the share of fleet.
- Create: `src/components/depot/network/DepotTable.tsx` — `DataTable` over `DepotSummary`: Depot, Kind, Fleet, On road, Stationary, No signal, Maintenance, Reporting %, Assigned %. Default sort Fleet descending. A kind filter (All / Depots / Other) as plain buttons with `aria-pressed`. A status-mix hairline bar per row with a text alternative.
- Create: `src/components/depot/network/NetworkOverview.tsx` (client) — composes states, `KpiBand`, `DepotTable`.
- Modify: `src/app/(protected)/project/depots/page.tsx` — replace the pending panel with `<NetworkOverview />`.

States: loading → `LoadingBlock` with the same footprint; error with no data → `ErrorPanel` with Retry; error with data → keep data, show `StaleStrip`; `stale` → `StaleStrip`; fixture → figures still shown, chip says FIXTURE.

- [ ] Commits: `feat: add network KPI band`, `feat: add depot table`, `feat: show live depot figures on the network overview`.

---

### Task 7: Data Sources registry

**Files:**
- Create: `src/lib/depot/sources/registry.ts` — `FEED_REGISTRY: readonly FeedEntry[]` where `FeedEntry { id; name; status: 'live' | 'modelled' | 'awaiting'; summary; fields: readonly { name; type; note? }[]; unlocks }`. Entries: GPS and device feed (live), Route details API (live), Depot master, Fleet master, Network timetable, Crew and duties, Maintenance, Fuel, Ticketing and ridership, History store (all `awaiting` in this phase). Field lists for the two live feeds come from the real payloads (`DepotBusRow` and `CanonicalStop`); for the others, the schema a real feed is expected to provide, as listed in the design spec's "Data needed" table.
- Create: `src/components/depot/sources/SourcesRegistry.tsx` (client) and `src/app/(protected)/project/depots/sources/page.tsx` (gated with `requireProjectSession`).
- Modify: `src/lib/depot/nav.ts` — add a `System` group with `Data sources` → `/project/depots/sources`.
- Test: extend `src/tests/unit/depot-nav.test.ts`; add `src/tests/unit/depot-registry.test.ts` (unique ids, every entry has at least one field, statuses valid).

The page shows, for the GPS feed, the measured `coverage` from the network response as labelled bars with exact counts ("1,726 of 9,588 buses"), tagged DERIVED. Statuses render LIVE, MODELLED or AWAITING FEED.

- [ ] Commits: `test: specify the feed registry`, `feat: add feed registry`, `feat: add data sources page`.

---

### Task 8: Full-fleet fixture

**Files:**
- Create: `scripts/build-depot-fixture.ts` — fetches `UPSRTC_LIVE_URL` once (same default as `src/lib/upsrtc/client.ts`), applies the redaction already used in `scripts/inspect-upsrtc-api.ts`, keeps only the raw keys `normalizeLivePayload` and `normalizeDepotRows` read, and writes `src/fixtures/upsrtc-fleet-sample.json`. Prints record, depot and route counts. Add `"build:depot-fixture"` to `package.json` scripts.
- Modify: `src/lib/upsrtc/liveSnapshot.ts` — the fixture fallback uses the full-fleet file when present.

This task makes one request to the UPSRTC server. If the host cannot be reached from this machine, do not retry in a loop: commit the script, leave the existing 400-row fixture as the fallback, and report the task as DONE_WITH_CONCERNS stating that the fixture was not generated.

- [ ] Commits: `feat: add depot fixture builder`, and if generated `chore: add full-fleet sample fixture` + `feat: fall back to the full-fleet fixture`.

---

### Task 9: End-to-end coverage

Extend `tests/e2e/depot-management.spec.ts`:

1. `GET /api/upsrtc/depot/network` without a cookie → 401 and a body with no `depots`.
2. Overview shows eight KPI figures, each with a provenance tag; the depot table has at least one row; clicking the Fleet header toggles `aria-sort`.
3. Feed status chip is visible and reads LIVE, CACHE or FIXTURE.
4. With the network API forced to 503 via `page.route`, the overview shows the error panel; after un-routing and clicking Retry, figures appear.
5. Data sources page: GPS feed tagged LIVE with coverage bars; at least one feed tagged AWAITING FEED; nav marks it current.
6. Neither page contains `/simulated/i`; neither scrolls sideways at 1440, 1024 and 800.
7. The command-centre spec still passes (the live route refactor changed nothing observable).

- [ ] Commit `test: cover depot overview and data sources end to end`.

---

### Task 10: Documentation

- `README.md`: the new API in the route table, the shared snapshot in the architecture and data-pipeline sections, the depot module section.
- `docs/ARCHITECTURE.md`: one fetch, two projections; the repository seam.
- `docs/LIVE_VS_PREDICTED.md`: which depot figures are LIVE and which DERIVED, and the coverage rule.
- `docs/API_DISCOVERY.md`: measured notes — `delay` is in minutes and measured at the previous stop; `distance` unit unconfirmed; `status` and `vehicle_status` are different vocabularies; depot names include non-depots; times share one clock and carry a misleading `Z`.

- [ ] Commit `docs: describe the live depot data path`.

## Phase gate

1. `npm run typecheck && npm run lint && npm run test && npm run build`.
2. Both e2e specs through the local wrapper on port 3210.
3. Overview and Data sources walked in a browser at 1440, 1024 and 800, in loading, live or fixture, stale and error states.
4. Whole-phase code review; design critique of both pages; findings fixed or recorded.
