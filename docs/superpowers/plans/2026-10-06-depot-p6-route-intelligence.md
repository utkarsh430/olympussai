# Depot Management P6 — Route Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HQ sees every route the fleet is running with the depot that operates it, how well it is running, its real stops and terminals, and a recommendation of which depot should operate each route so that buses drive the fewest empty kilometres to and from their first and last stops.

**Architecture:** A route table is derived from the live snapshot (one row per route name: operating depot, buses on it, state mix, delay pattern). Real stop lists and terminals come from the on-demand route catalogue built in P3. Dead kilometres are the road distance from a depot's yard to a route's first stop and from its last stop back. A pure assignment optimiser (regret-based greedy construction followed by swap and shift local search) reallocates routes to depots within depot capacity. Trip frequency is not in the feed, so it is modelled and the savings are labelled MODELLED.

**Tech Stack:** TypeScript, vitest, Next.js route handlers, Google Maps, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-06-depot-management-design.md`, `docs/superpowers/specs/2026-10-06-depot-ui-design-brief.md`. Builds on P1–P4.

## Global Constraints

- All earlier global constraints still bind.
- The route catalogue fetches one route per request. The allocation optimiser works only with routes whose terminals are already known (profiled); it must never trigger a batch of upstream calls. The page shows how many routes are profiled out of the total and lets the user profile a route by opening it.
- A dead-kilometre figure is DERIVED only when both the depot's yard and the route's located terminal are known. Anything multiplied by modelled trips per day is MODELLED.
- A route with an unlocated first or last stop uses its nearest located stop and says so; with fewer than two located stops it has no dead-kilometre figure.
- `delayMinutes` is used only for buses scheduled for the feed date and within `MAX_PLAUSIBLE_DELAY_MIN`, and every delay statistic shows its coverage.
- Recommendation only. No route is reassigned.

## Review Focus

1. A route operated by buses of two depots: the table shows both and names the majority operator; the optimiser treats the route as one unit. Task 1.
2. No depot has enough capacity for every route: the optimiser returns a feasible partial improvement and reports what it left unchanged, never an infeasible plan. Task 3.
3. A route whose current depot is already the nearest: it is not moved for a zero or negative saving, and not moved for a saving below the minimum threshold. Task 3.
4. A depot without an established yard: its routes keep their current allocation and are excluded from savings, with a reason. Tasks 2 and 3.
5. Only a handful of routes are profiled: the page says so and the plan covers only those. Task 5.

---

### Task 1: Route table from the live snapshot

**Files:** create `src/lib/depot/routes/routeTable.ts`; extend `src/lib/depot/routes/types.ts`; test `src/tests/unit/depot-route-table.test.ts`.

```ts
export interface RouteOperator { readonly depotId: string; readonly depotName: string; readonly buses: number }
export interface RouteRow { readonly routeName: string; readonly routeId: string | null; readonly description: string | null;
  readonly serviceToken: string | null;             // token parsed from the name, e.g. ORD
  readonly direction: 'IN' | 'OUT' | null;
  readonly buses: number;                            // buses carrying this route name now
  readonly operators: readonly RouteOperator[];      // sorted by buses desc, then depot id
  readonly primaryDepotId: string | null;            // majority operator; null on an exact tie
  readonly states: StateMix;
  readonly delay: { readonly medianMin: number | null; readonly lateShare: number | null; readonly coverage: Coverage } }
export const LATE_AFTER_MIN = 10;
export function buildRouteTable(rows: readonly DepotBusRow[], stateOf: (row: DepotBusRow) => BusOpState, feedNow: string | null): RouteRow[];
```

Sorted by buses descending then route name. `lateShare` is the share of covered buses with delay above `LATE_AFTER_MIN`.

- [ ] Commits `test: specify the route table`, `feat: derive the route table from the live snapshot`.

---

### Task 2: Dead kilometres

**Files:** create `src/lib/depot/routes/deadKm.ts`; test `src/tests/unit/depot-dead-km.test.ts`.

```ts
export interface DeadKm { readonly outKm: number; readonly inKm: number; readonly perTripKm: number;   // out + in
  readonly firstStopUsed: string; readonly lastStopUsed: string; readonly approximated: boolean }      // true when a nearest located stop stood in
export function terminalsOf(profile: RouteProfile): { first: RouteStop; last: RouteStop; approximated: boolean } | null;
export function deadKmFor(yard: LatLng, profile: RouteProfile, detourFactor: number): DeadKm | null;
```

- [ ] Commits `test: specify dead kilometres`, `feat: compute dead kilometres between a yard and a route`.

---

### Task 3: Route-to-depot allocation

**Files:** create `src/lib/depot/optimise/allocate.ts`, `optimise/allocateConfig.ts`; extend `optimise/types.ts`; test `src/tests/unit/depot-allocate.test.ts`.

```ts
export interface AllocRoute { readonly routeName: string; readonly currentDepotId: string; readonly busesNeeded: number;
  readonly tripsPerDay: number;                                 // modelled
  readonly deadKmByDepot: Readonly<Record<string, number>> }    // per-trip dead km for each candidate depot
export interface AllocDepot { readonly depotId: string; readonly capacity: number }  // buses it can field
export interface RouteMove { readonly routeName: string; readonly fromDepotId: string; readonly toDepotId: string;
  readonly busesNeeded: number; readonly savedKmPerDay: number;
  readonly madeRoom: boolean }                                  // own net saving under the minimum: moved so another route could
export interface AllocationPlan { readonly moves: readonly RouteMove[]; readonly beforeKmPerDay: number;
  readonly afterKmPerDay: number; readonly savedKmPerDay: number;
  readonly unchanged: readonly { readonly routeName: string; readonly reason: UnchangedReason }[] }
// UnchangedReason, in precedence order: 'no_candidate' | 'already_best' | 'below_threshold' | 'over_capacity' | 'move_limit' | 'no_capacity'
export const MIN_SAVING_KM_PER_DAY = 5;
export const MAX_MOVES = 200;
export function planAllocation(routes: readonly AllocRoute[], depots: readonly AllocDepot[]): AllocationPlan;
```

Method: start from the current allocation (always feasible by definition: a depot's capacity is at least what it fields now). Improvement phase 1, regret order: for each route compute the saving of its best alternative depot with free capacity; process routes by regret (best saving minus second-best saving) descending, moving a route when the saving is at least `MIN_SAVING_KM_PER_DAY`. Phase 2, local search until no improving move remains or `MAX_MOVES` is reached: shift (one route to another depot with capacity) and swap (two routes exchange depots when capacities allow), always taking the best improving move, ties broken by route name. Capacity is never exceeded at any step. Deterministic for shuffled input.

- [ ] Tests: a hand case where greedy alone is suboptimal and a swap finds the improvement; capacity never exceeded (assert after every plan); no move below the threshold; a route already at its best depot is `already_best`; no capacity anywhere → `no_capacity`; total kilometres never increase; `beforeKmPerDay − afterKmPerDay = savedKmPerDay = Σ moves`; determinism; 1,200 routes × 143 depots completes within a generous bound; no mutation. Commits `test: specify route allocation`, `feat: allocate routes to depots to cut dead kilometres`.

---

### Task 4: Modelled trip frequency, views and APIs

**Files:** create `src/lib/depot/sim/tripFrequency.ts` (trips per day per route, seeded by route name and anchored on the buses seen on the route: `max(1, round(buses × f))`, `f` in a documented range), `src/lib/depot/live/routesView.ts`, `src/app/api/upsrtc/depot/routes/route.ts` (the route table, with whichever profiles are already cached), `src/app/api/upsrtc/depot/allocation/route.ts`, `src/hooks/useDepotRoutes.ts`, `useDepotAllocation.ts`; add a read-only accessor to the route catalogue for already-cached profiles; tests for the frequency model, the views and query validation.

- [ ] Commits `test: specify trip frequency and route views`, `feat: model trip frequency`, `feat: add routes and allocation APIs`.

---

### Task 5: Routes page

**Files:** create `src/components/depot/routes/RoutesPage.tsx`, `RouteTable.tsx`, `RouteDrawer.tsx` (real stop list, terminals on a small map, length and scheduled duration, operators, dead km from the operating depot; opening it profiles the route), `AllocationPanel.tsx` (moves, kilometres saved per day, profiled-routes coverage, the recommendation-only sentence), `src/app/(protected)/project/depots/routes/page.tsx`; nav entry Network → `Routes`.

- [ ] Commits one per component, then `feat: add route intelligence page`.

---

### Task 6: End-to-end and documentation

- e2e: APIs 401; table renders and sorts; opening a route shows stops or its "profile unavailable" reason; allocation panel shows its coverage line; no banned wording, no sideways scroll.
- Docs: README and `docs/LIVE_VS_PREDICTED.md` (what is real: stops and terminals; what is modelled: trips per day and therefore daily savings), `docs/ARCHITECTURE.md` (the allocation heuristic and why it never crawls).

- [ ] Commits `test: cover route intelligence end to end`, `docs: describe route intelligence and the allocation heuristic`.

## Phase gate

1. `npm run typecheck && npm run lint && npm run test && npm run build`.
2. Both e2e specs through the local wrapper on port 3210.
3. Routes page walked in a browser at 1440, 1024 and 800.
4. Whole-phase code review; design critique; findings fixed or recorded.
