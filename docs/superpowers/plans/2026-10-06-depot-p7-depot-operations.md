# Depot Management P7 — Depot Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A depot manager gets a duty board that assigns buses to the day's duties automatically, a maintenance view of what is off road and what is coming due, and a night parking order that lets the first bus out in the morning leave without shunting.

**Architecture:** Duties, job cards, yard capacity and parking lanes are not in the feed, so they are modelled: generated deterministically per depot and operating date and anchored on the live fleet, the live off-road list and the routes each depot is seen running. Bus-to-duty assignment is an exact minimum-cost matching (Hungarian algorithm). The parking order is a pure sequencing rule over lanes. Each real feed (timetable, maintenance system, depot survey) replaces its modelled repository behind the same interface.

**Tech Stack:** TypeScript, vitest, Next.js route handlers, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-06-depot-management-design.md`, `docs/superpowers/specs/2026-10-06-depot-ui-design-brief.md`. Builds on P1–P4.

## Global Constraints

- All earlier global constraints still bind, including determinism of the modelled world and its anchoring invariants.
- **Anchors:** modelled duties for a depot never exceed its live available buses plus the modelled spare; a bus the feed reports under maintenance always has an open modelled job card and is never assigned a duty; modelled lane capacity is never below the buses located in the yard.
- The odometer (`odometerRaw`) is used only after its unit is established by the calibration script, and until then every odometer-based figure is withheld with the sentence "Odometer unit not yet confirmed".
- Recommendation only: assignments, job cards and parking orders are proposals. Nothing is dispatched or written back.
- Nothing ranks, scores or names an individual.

## Review Focus

1. More duties than assignable buses, or more buses than duties: the board shows unassigned duties (or spare buses) explicitly; the matching never fails. Task 2.
2. A bus that is off road, dark, or away from the yard at duty start: it is not assigned, and the reason is shown. Task 2.
3. A rectangular or empty cost matrix, and equal costs: the matching is still optimal and deterministic. Task 2.
4. Duties crossing midnight: timeline geometry and overlap checks stay correct. Tasks 1 and 3.
5. A yard that is not established: the parking order is withheld with the reason, not invented. Task 5.

---

### Task 1: Modelled duties and repository

**Files:** create `src/lib/depot/sim/duties.ts`, `src/lib/depot/duties/types.ts`, `src/lib/depot/repositories/modelledTimetableRepository.ts`; extend repositories `types.ts` and `index.ts`; test `src/tests/unit/depot-sim-duties.test.ts`.

```ts
export interface Duty { readonly id: string; readonly depotId: string; readonly routeName: string;
  readonly startMin: number; readonly endMin: number;      // minutes from midnight; endMin may exceed 1440
  readonly serviceClass: ServiceClass; readonly provenance: Provenance }
export interface TimetableRepository { dutiesFor(depotId: string, operatingDate: string): Promise<readonly Duty[]> }
export function modelDuties(depot: DepotSummary,
  routes: readonly { readonly routeName: string; readonly scheduledDurationMin: number | null }[],
  peakRequirement: number, operatingDate: string): { duties: Duty[]; routesWithoutDuty: string[] };
```

Duty count equals the depot's modelled `peakRequirement`. Start times follow a morning-peaked spread; durations come from the route's real scheduled duration when its profile is cached, otherwise from a seeded range; routes are drawn from the routes the depot is seen operating.

- [ ] Commits `test: specify modelled duties`, `feat: model depot duties behind the timetable repository`.

---

### Task 2: Bus-to-duty assignment

**Files:** create `src/lib/depot/optimise/hungarian.ts`, `optimise/assignDuties.ts`; test `src/tests/unit/depot-hungarian.test.ts`, `depot-assign-duties.test.ts`.

```ts
/** Minimum-cost assignment on a rectangular matrix; Infinity marks a forbidden pair. */
export function hungarian(cost: readonly (readonly number[])[]): { readonly rowToCol: readonly number[]; readonly total: number }; // -1 = unassigned
export type Ineligibility = 'off_road' | 'dark' | 'not_in_yard' | 'class_mismatch';
export interface DutyAssignment { readonly dutyId: string; readonly registrationNumber: string | null;
  readonly reason: 'assigned' | 'no_eligible_bus' }
export interface AssignmentPlan { readonly assignments: readonly DutyAssignment[];
  readonly spareBuses: readonly string[];
  readonly excluded: readonly { readonly registrationNumber: string; readonly reason: Ineligibility }[];
  readonly unassignedDuties: number }
export function assignDuties(duties: readonly Duty[], buses: readonly DepotBusView[], fleet: ReadonlyMap<string, ModelledBus>): AssignmentPlan;
```

Cost of pairing a bus with a duty: 0 base; a class mismatch is forbidden; a penalty that prefers younger buses for longer duties, so wear is spread. Buses that are off road, dark or not in the yard are excluded before matching, each with its reason. Verified against brute force on small matrices.

- [ ] Commits `test: specify minimum-cost assignment`, `feat: add Hungarian assignment`, `test: specify duty assignment`, `feat: assign buses to duties`.

---

### Task 3: Duty board

**Files:** create `src/lib/depot/live/dutyView.ts`, `src/app/api/upsrtc/depot/[depotId]/duties/route.ts`, `src/hooks/useDepotDuties.ts`, `src/components/depot/duties/DutyBoard.tsx` (a timeline: one row per bus, duties as bars on a 24-hour-plus axis, unassigned duties in their own lane, a "now" marker from feed time), `DutyLegend.tsx`, `DutyTable.tsx` (the same data as a table, for keyboard and screen-reader users), `d/[depotId]/duties/page.tsx`; depot sub-nav entry `Duties`; pure geometry in `src/lib/depot/duties/timeline.ts` with tests.

- [ ] Commits `test: specify timeline geometry`, `feat: add duty view and API`, `feat: add duty board`.

---

### Task 4: Maintenance

**Files:** create `scripts/calibrate-odometer.ts` (two live snapshots a few minutes apart; compares each moving bus's change in `distance` with its straight-line displacement to decide between metres and kilometres; prints the evidence; makes exactly two requests), `src/lib/depot/sim/maintenance.ts`, `src/lib/depot/maintenance/types.ts`, `src/lib/depot/repositories/modelledMaintenanceRepository.ts`, `src/lib/depot/live/maintenanceView.ts`, `src/app/api/upsrtc/depot/[depotId]/maintenance/route.ts`, `src/components/depot/maintenance/*`, `d/[depotId]/maintenance/page.tsx`; tests.

Live: the off-road list with how long each bus has been silent. Modelled: a job card per off-road bus (category, days open, bay), upcoming preventive maintenance, workshop bay load against modelled bays. Odometer-based due dates stay withheld until the unit is confirmed in `src/lib/depot/reference/odometer.ts`.

- [ ] Commits `feat: add odometer calibration script`, `test: specify modelled maintenance`, `feat: model job cards and preventive maintenance`, `feat: add maintenance view, API and page`.

---

### Task 5: Yard capacity and night parking order

**Files:** create `src/lib/depot/optimise/parkingOrder.ts`, `src/lib/depot/sim/yardLayout.ts` (modelled lanes and their depth), `src/components/depot/yard/ParkingOrder.tsx`; extend the yard page with occupancy against modelled capacity; tests `src/tests/unit/depot-parking-order.test.ts`.

```ts
export interface Lane { readonly id: string; readonly depth: number }          // buses nose to tail; the last in is the first out
export interface ParkingSlot { readonly laneId: string; readonly position: number; readonly registrationNumber: string;
  readonly firstDutyStartMin: number | null }
export function planParking(lanes: readonly Lane[], buses: readonly { registrationNumber: string; firstDutyStartMin: number | null }[]): {
  readonly slots: readonly ParkingSlot[]; readonly blocked: number; readonly overflow: readonly string[] };
```

Buses with no duty tomorrow go deepest; within a lane, departure times decrease from the back to the mouth, so no bus has to be moved to let another out. `blocked` counts buses that would still be boxed in; `overflow` lists buses that do not fit.

- [ ] Commits `test: specify the night parking order`, `feat: plan the night parking order`, `feat: show yard capacity and parking order`.

---

### Task 6: End-to-end and documentation

- e2e: duties, maintenance and parking for a depot; the unassigned and "yard not established" states; APIs 401, 400 and 404; no banned wording, no sideways scroll.
- Docs: README, `docs/LIVE_VS_PREDICTED.md` (what is live: off-road list, yard presence; what is modelled: duties, job cards, lanes), `docs/API_DISCOVERY.md` (the odometer finding once the script has been run).

- [ ] Commits `test: cover depot operations end to end`, `docs: describe duties, maintenance and the parking order`.

## Phase gate

1. `npm run typecheck && npm run lint && npm run test && npm run build`.
2. Both e2e specs through the local wrapper on port 3210.
3. The three depot pages walked in a browser at 1440, 1024 and 800.
4. Whole-phase code review; design critique; findings fixed or recorded.
