# Depot Management P3 — Depot Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A depot manager can switch scope to one depot and see, on live data, what is on the road, what is standing in the yard, what is late out, every bus with its real route and stops, and who is physically in the yard right now.

**Architecture:** Three more pure inference modules (yard, location, outshedding) feed a per-depot view served by one new API. The existing schedule fetch is factored into a shared service so a route catalogue can build real route profiles (stops and terminals) on demand. The depot scope lives in the URL (`/project/depots/d/[depotId]`), reached through a scope switcher.

**Tech Stack:** TypeScript, vitest, Next.js route handlers, Google Maps through the existing loader, Tailwind, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-depot-management-design.md`, `docs/superpowers/specs/2026-10-06-depot-ui-design-brief.md`. Builds on P1 (`DepotBusRow`, `getLiveSnapshot`, repositories, UI foundation) and P2 (`classifyBusState`, thresholds, scores, exceptions).

## Global Constraints

- All P1 and P2 global constraints still bind.
- Yard position and radius are **inferred**: every screen that uses them says so (DERIVED, "learned from where this depot's buses park") and shows the sample size. A depot whose yard cannot be inferred shows "yard not established", never a guess.
- Outshedding figures always show their coverage (buses carrying a schedule for the feed date, out of fleet). It is not a headline number.
- `delayMinutes` is displayed only when the bus's schedule is for the feed date and `|delay| <= MAX_PLAUSIBLE_DELAY_MIN`.
- The route catalogue fetches at most one route per request, on demand, with a per-day cache and negative caching. No loop over all routes, no background crawl.
- Scope is a URL segment. `depotId` is validated (`^\d{1,6}$` or `unassigned`) in the layout and in the API before any work.
- Bus-level data for one depot may go to the browser; never the whole fleet.

## Review Focus

1. A depot with three parked buses, or buses split between two stands 30 km apart: the yard must be null ("not established"), not the midpoint. Task 1.
2. Two depots sharing one yard: each bus counts as in its own home yard, not as a visitor at the neighbour. Task 2.
3. `actual_start_time` left over from a previous day: it must not make today's departure look on time. Task 3.
4. A bus that is dark at its scheduled start: its outshed state is "unknown", not "overdue". Task 3.
5. The route-details API answers `" Bus Not Assigned!!! "` or stops with `0,0`: the profile is "unavailable" or carries unlocated stops flagged, never a crash or a zero-length route. Task 5.
6. An unknown or malformed `depotId` in the URL or API: 404 or 400, with no work done and nothing reflected back unescaped. Tasks 4 and 6.

---

### Task 1: Yard inference

**Files:** create `src/lib/depot/infer/geo.ts`, `src/lib/depot/infer/yard.ts`; extend `src/lib/depot/infer/thresholds.ts`; test `src/tests/unit/depot-yard.test.ts`. Reuse the haversine in `src/lib/geo` if one exists (check `src/tests/unit/geo.test.ts` for what is already there) instead of writing another.

```ts
export interface Yard {
  readonly lat: number; readonly lng: number;
  readonly radiusM: number;        // clamped to [YARD_MIN_RADIUS_M, YARD_MAX_RADIUS_M]
  readonly parked: number;         // candidates considered
  readonly inCluster: number;      // candidates inside the winning cluster
}
export const YARD_CELL_M = 150;
export const YARD_MIN_CLUSTER = 6;
export const YARD_MIN_SHARE = 0.5;
export const YARD_MIN_RADIUS_M = 120;
export const YARD_MAX_RADIUS_M = 600;
export const YARD_RADIUS_PAD_M = 40;

/** Rows of ONE depot. Returns null when no confident cluster exists. */
export function inferYard(rows: readonly DepotBusRow[]): Yard | null;
/** Yards for every depot id present, computed once per snapshot. */
export function inferYards(rows: readonly DepotBusRow[]): ReadonlyMap<string, Yard>;
```

Method: candidates are rows with a valid position and speed at or below `MOVING_SPEED_KMPH` (parked, dark or off-road buses all count: a silent bus was last heard where it stopped). Project to metres around the candidates' median latitude. Bin into `YARD_CELL_M` cells; take the densest cell (ties: lowest cell key, for determinism) plus its eight neighbours as the cluster. Reject when the cluster has fewer than `YARD_MIN_CLUSTER` buses or holds less than `YARD_MIN_SHARE` of the candidates. Centre is the cluster mean; radius is the 90th-percentile distance from the centre plus `YARD_RADIUS_PAD_M`, clamped.

- [ ] Tests: a tight cluster of 10 → yard within 20 m of the true centre; 3 buses → null; 6 at the yard and 6 at a stand 30 km away → null (share exactly 0.5 passes, so use 6 and 7); moving buses ignored; rows without position ignored; radius clamps at both ends; deterministic on shuffled input; empty input → null; `inferYards` groups by depot and skips null `depotId`. Commits `test: specify yard inference`, `feat: infer depot yards from parked buses`.

---

### Task 2: Bus location

**Files:** create `src/lib/depot/infer/location.ts`; modify `src/lib/depot/types.ts`; test `src/tests/unit/depot-location.test.ts`.

```ts
export type BusLocation = 'in_yard' | 'at_other_yard' | 'away' | 'unknown';
export interface LocatedBus { readonly location: BusLocation;
  readonly otherDepotId: string | null;     // set for 'at_other_yard'
  readonly distanceFromYardKm: number | null } // one decimal; null when no home yard or no position
export function locateBus(row: DepotBusRow, yards: ReadonlyMap<string, Yard>): LocatedBus;
```

Order: no position → `unknown`. Inside its own home yard → `in_yard` (checked first, so shared yards resolve to home). Inside another depot's yard → `at_other_yard` with that depot id (nearest centre when several match). Home yard known → `away` with distance. Home yard unknown and not inside any yard → `unknown`.

- [ ] Tests for each branch, the shared-yard case, boundary exactly on the radius (inside), nearest-of-several. Commits `test: specify bus location`, `feat: locate buses against depot yards`.

---

### Task 3: Outshedding

**Files:** create `src/lib/depot/infer/outshed.ts`; extend thresholds; modify types; test `src/tests/unit/depot-outshed.test.ts`.

```ts
export type OutshedState = 'upcoming' | 'due' | 'departed' | 'overdue' | 'ended' | 'unknown';
export interface OutshedRow { readonly registrationNumber: string; readonly routeName: string | null;
  readonly journeyCode: string | null; readonly scheduledStart: string; readonly scheduledEnd: string | null;
  readonly state: OutshedState; readonly minutesLate: number | null;   // departed: actual − scheduled, when actual is credible
  readonly minutesOverdue: number | null; readonly evidence: 'actual_time' | 'left_yard' | 'none' }
export interface OutshedSummary { readonly rows: readonly OutshedRow[];
  readonly counts: Readonly<Record<OutshedState, number>>; readonly coverage: Coverage }
export const OUTSHED_GRACE_MIN = 10;
export const ACTUAL_START_WINDOW_MIN = { before: 120, after: 360 } as const;
export const MAX_PLAUSIBLE_DELAY_MIN = 180;

export function isScheduledForFeedDate(row: DepotBusRow, feedNow: string | null): boolean;
export function classifyOutshed(row: DepotBusRow, state: BusOpState, located: LocatedBus, feedNow: string): OutshedRow | null;
export function summariseOutshed(rows: readonly DepotBusRow[], yards: ReadonlyMap<string, Yard>, feedNow: string | null): OutshedSummary;
```

Rules: only rows whose `scheduledStart` shares the calendar date of `feedNow` (compare the `YYYY-MM-DD` prefix of both ISO strings; both are on the feed clock) are considered; others return null. Then, first match:
1. `scheduledEnd` earlier than `feedNow` → `ended`.
2. `actualStart` within `ACTUAL_START_WINDOW_MIN` of `scheduledStart` → `departed`, `evidence: 'actual_time'`, `minutesLate` = difference (may be negative).
3. `scheduledStart` at or before `feedNow` and the bus is `in_service`/`on_road`, or located `away`/`at_other_yard` → `departed`, `evidence: 'left_yard'`, `minutesLate: null`.
4. Bus state is `dark`, or location is `unknown` → `unknown`.
5. `scheduledStart` after `feedNow` → `upcoming`.
6. Within `OUTSHED_GRACE_MIN` after `scheduledStart` → `due`.
7. Otherwise → `overdue` with `minutesOverdue`.

`coverage` is `{ n: rows considered, of: depot fleet }`. `feedNow` null → empty summary with zero counts. Rows sorted by `scheduledStart`.

- [ ] Tests: one per rule and boundary; a stale `actualStart` (three days old) falls through to rule 3 or later; a dark bus is `unknown`; yesterday's schedule is ignored; null `feedNow`; counts add up; ordering. Commits `test: specify outshedding`, `feat: track outshedding against schedule`.

---

### Task 4: Depot detail view and API

**Files:** create `src/lib/depot/live/depotView.ts`, `src/app/api/upsrtc/depot/[depotId]/route.ts`, `src/lib/depot/ids.ts` (`isValidDepotId`), `src/hooks/useDepotDetail.ts`; modify types; tests `src/tests/unit/depot-view.test.ts`, `src/tests/unit/depot-ids.test.ts`.

```ts
export interface DepotBusView { readonly registrationNumber: string; readonly state: BusOpState;
  readonly location: BusLocation; readonly otherDepotId: string | null; readonly distanceFromYardKm: number | null;
  readonly latitude: number | null; readonly longitude: number | null; readonly speedKmph: number | null;
  readonly gpsAgeMin: number | null; readonly vehicleStatus: DepotVehicleStatus; readonly tripStatus: string | null;
  readonly routeName: string | null; readonly routeDescription: string | null; readonly journeyId: string | null;
  readonly journeyCode: string | null; readonly scheduledStart: string | null; readonly scheduledEnd: string | null;
  readonly tripDate: string | null; readonly delayMinutes: number | null;   // already filtered for plausibility
  readonly mainPowerOn: boolean | null; readonly tamperCode: string | null }
export interface VisitorBus { readonly registrationNumber: string; readonly homeDepotId: string | null;
  readonly homeDepotName: string | null; readonly state: BusOpState }
export interface DepotDetailResponse { readonly depot: DepotSummary; readonly score: DepotScore | null;
  readonly yard: Figure<Yard | null>; readonly buses: readonly DepotBusView[];
  readonly locationMix: Readonly<Record<BusLocation, number>>; readonly outshed: OutshedSummary;
  readonly exceptions: { readonly depot: readonly DepotException[]; readonly bus: readonly BusException[] };
  readonly visitors: readonly VisitorBus[];
  readonly feedNow: string | null; readonly fetchedAt: string; readonly source: UpstreamSource; readonly stale: boolean }
export function buildDepotDetail(view: FleetSnapshotView, depotId: string): DepotDetailResponse | null; // null = unknown depot
```

Per-snapshot work (yards, states, scores) is memoised once and shared with the network and exception views; do not recompute it per depot request. Route: `GET /api/upsrtc/depot/[depotId]`; invalid id → 400 `{ error: 'Invalid depot id' }`; unknown → 404 `{ error: 'Depot not found' }`; same guards, flags and 503 handling as the other depot routes. `useDepotDetail(depotId)` polls every 60 s with the established pattern.

- [ ] Commits: `test: specify depot ids and the depot view`, `feat: validate depot ids`, `feat: build the per-depot view`, `feat: add depot detail API`, `feat: add depot detail hook`.

---

### Task 5: Route catalogue from the route-details API

**Files:** create `src/lib/upsrtc/scheduleService.ts` (the fetch-normalise-fallback logic now inside `src/app/api/upsrtc/schedule/route.ts`, moved verbatim so both callers share it; the route becomes a thin caller with an unchanged response); create `src/lib/depot/routes/routeProfile.ts`, `routeCatalogue.ts`, `src/app/api/upsrtc/depot/route/[routeName]/route.ts`, `src/hooks/useRouteProfile.ts`; modify `src/lib/depot/sources/registry.ts` (route details: live, on demand); tests `src/tests/unit/depot-route-profile.test.ts`, `depot-route-catalogue.test.ts`.

```ts
export interface RouteStop { readonly name: string; readonly sequence: number;
  readonly lat: number | null; readonly lng: number | null; readonly scheduled: string | null }
export interface RouteProfile { readonly routeName: string; readonly routeId: string | null;
  readonly description: string | null; readonly direction: string | null;
  readonly origin: RouteStop | null; readonly destination: RouteStop | null;
  readonly stops: readonly RouteStop[]; readonly unlocatedStops: number;
  readonly scheduledDurationMin: number | null; readonly lengthKm: number | null; // null with fewer than two located stops
  readonly sampledFrom: string;   // registration the profile was read from
  readonly operatingDate: string }
export type RouteProfileResult =
  | { readonly status: 'ok'; readonly profile: RouteProfile }
  | { readonly status: 'unavailable'; readonly reason: 'no_bus_on_route' | 'no_schedule' | 'upstream_error' };
export function buildRouteProfile(schedule: CanonicalSchedule, sampledFrom: string): RouteProfile;
export function getRouteProfile(routeName: string, view: FleetSnapshotView): Promise<RouteProfileResult>;
```

`buildRouteProfile` is pure: `lengthKm` sums straight-line legs between consecutive *located* stops; `scheduledDurationMin` is last minus first scheduled time, adding a day when the difference is negative (overnight). `getRouteProfile`: pick the row on that route with the freshest GPS, preferring `in_service`; fetch its schedule through `scheduleService`; cache `ok` results per `routeName` + operating date (bounded map, `ROUTE_CACHE_MAX = 2000`, oldest evicted) and `unavailable` results for `ROUTE_NEGATIVE_TTL_MS = 10 minutes`. Route names are validated with `^[A-Za-z0-9_-]{1,64}$` → 400 otherwise.

- [ ] Commits: `refactor: share the schedule fetch as a service` (existing schedule tests and e2e test 4 stay green), `test: specify route profiles`, `feat: build route profiles from a schedule`, `test: specify the route catalogue`, `feat: add on-demand route catalogue`, `feat: add route profile API`.

---

### Task 6: Depot scope — switcher, layout, sub-navigation

**Files:** create `src/components/depot/shell/ScopeSwitcher.tsx` (client; an accessible combobox over the depots in the network context with type-to-filter; "Network" returns to `/project/depots`; `data-testid="depot-scope-switcher"`), `src/app/(protected)/project/depots/d/[depotId]/layout.tsx` (gate, id validation → `notFound()`, `DepotDetailProvider`, sub-nav: Cockpit, Roster, Yard), `src/components/depot/data/DepotDetailProvider.tsx`, `src/components/depot/shell/DepotSubNav.tsx`; modify `DepotTopBar.tsx` (the static crumb becomes the switcher), `src/lib/depot/nav.ts` (`depotNav(depotId)`), league table rows and map panel (link to the depot). Use the Radix primitives already installed only if they give correct combobox semantics with less code than hand-rolling; otherwise a native `<input list>` is not acceptable for styling reasons, so build a small listbox with full keyboard support. Test `depot-nav.test.ts` additions.

- [ ] Commits: `feat: add depot sub-navigation model`, `feat: add depot scope layout`, `feat: add scope switcher`, `feat: link league and map to depot scope`.

---

### Task 7: Cockpit

**Files:** create `src/components/depot/cockpit/DepotCockpit.tsx`, `DepotHeader.tsx` (name, kind, fleet, index and rank within peer group or the unranked reason), `StatusBoard.tsx` (the five states as counts with a location split for standing buses: in yard, at another yard, away, unknown), `OutshedTracker.tsx` (table: scheduled, bus, route, state, minutes; coverage line; `overdue` first), `DepotExceptions.tsx`, `VisitorList.tsx`; `src/app/(protected)/project/depots/d/[depotId]/page.tsx`.

The status board is the page's single hero instrument. Every block has loading, empty, stale and error states. When the yard is not established, the location split is replaced by one sentence saying so.

- [ ] Commits: one per component, then `feat: add depot cockpit`.

---

### Task 8: Roster and bus drawer

**Files:** create `src/components/depot/roster/RosterTable.tsx`, `RosterFilters.tsx` (state, location, has-route, search by registration), `BusDrawer.tsx` (Radix dialog as a side sheet: bus facts, device flags, and the real timetable from `/api/upsrtc/schedule` — stops in order, the next stop marked), `src/lib/depot/routes/nextStop.ts` (pure: nearest located stop ahead of the bus by position, falling back to the first stop whose scheduled time is after the feed time; returns which method was used), `src/hooks/useBusSchedule.ts`, `roster/page.tsx`; test `src/tests/unit/depot-next-stop.test.ts`.

- [ ] Commits: `test: specify next-stop inference`, `feat: infer the next stop`, `feat: add roster table`, `feat: add bus drawer with live timetable`, `feat: add roster page`.

---

### Task 9: Yard page

**Files:** create `src/components/depot/yard/YardMap.tsx` (yard circle, buses inside coloured by state, visitors distinct, legend in words), `YardRoll.tsx` (who is in the yard now, grouped by state, with GPS age), `yard/page.tsx`.

Occupancy is a count only in this phase (capacity is modelled data and arrives in P7). "Yard not established" replaces the map with an explanation of the rule (at least six parked buses, half of them in one place).

- [ ] Commits: `feat: add yard map`, `feat: add yard roll`, `feat: add yard page`.

---

### Task 10: End-to-end and documentation

- e2e: scope switcher by mouse and keyboard; deep link to a depot survives login; unknown depot id → not-found page inside the shell; depot API 400/404/401; cockpit, roster (filter, open drawer, timetable or its empty state), yard (map or "not established"); route profile API validation; no banned wording, no sideways scroll at 1440, 1024, 800.
- Docs: README, `docs/LIVE_VS_PREDICTED.md` (yard inference rule, location, outshedding rules and coverage), `docs/API_DISCOVERY.md` (stale `actual_start_time`), `docs/ARCHITECTURE.md` (schedule service, route catalogue and its caching limits).

- [ ] Commits: `test: cover the depot workspace end to end`, `docs: describe yard inference, outshedding and the route catalogue`.

## Phase gate

1. `npm run typecheck && npm run lint && npm run test && npm run build`.
2. Both e2e specs through the local wrapper on port 3210.
3. Cockpit, roster (with drawer) and yard walked in a browser at 1440, 1024 and 800 for a large depot, a small depot and an unranked unit.
4. Whole-phase code review; design critique of the three pages; findings fixed or recorded.
