# Depot Management P8 — Resources and Economics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A depot manager and HQ can see crew availability against the day's duties, fuel use and cost per bus and route, and revenue and ridership per route — the three domains the transport department will connect next — fully working on modelled data today and ready to switch to real feeds.

**Architecture:** None of these domains is in the live feed, so each is a modelled repository behind an interface, generated deterministically per depot and operating date and anchored on what is live (the depot's fleet, its duties from P7, the routes it is seen running, each route's real length where profiled). Each domain is one pure generator, one pure analysis module, one view and API, and one page. The Data Sources registry flips each feed from AWAITING FEED to MODELLED, and states the schema the real feed must provide.

**Tech Stack:** TypeScript, vitest, Next.js route handlers, Recharts (through the `dataviz` skill), Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-06-depot-management-design.md`, `docs/superpowers/specs/2026-10-06-depot-ui-design-brief.md`. Builds on P1–P7.

## Global Constraints

- All earlier global constraints still bind: determinism, anchoring, provenance on every figure, `feedNow` as the clock, no bulk rows to the browser, recommendation only.
- **People.** Crew data is about availability and rostering only. Nothing scores, ranks, compares or flags an individual; no page lists a named or numbered person beside a performance figure; no figure is derived from telemetry about how someone drives. Crew members are modelled as anonymous slots (`D-014`), and every crew screen carries the sentence "Availability and rostering only. No individual is assessed."
- **Fuel.** A variance flag is raised against a vehicle or a route, never a person, and its wording states a variance, not a cause ("uses 18% more than similar buses on this route"); it never says theft, pilferage or misuse.
- **Everything on these pages is MODELLED** and is tagged so on every figure, in every table header and in every chart title. A modelled economic figure never appears in the Depot Efficiency Index; economics get their own, separately labelled index.
- Anchors: crew required equals duties from the P7 generator; fuel issued is consistent with modelled distance and a modelled consumption per service class; route revenue is consistent with modelled boardings and a fare per kilometre; route length is the real profiled length when known and is tagged DERIVED in that case.
- Money is in rupees, formatted with Indian digit grouping; rates are per kilometre.

## Review Focus

1. A depot with more duties than crew slots available: the shortfall is shown as uncovered duties, not hidden by double-booking a slot. Task 1.
2. A crew slot would exceed the duty-hours limit: it is not assigned, and the reason is shown. Task 1.
3. A bus with zero modelled distance: consumption is "no distance recorded", never a division by zero or an infinite figure. Task 2.
4. A route with no profile (unknown length): revenue per kilometre is withheld with the reason, not computed from a guess. Task 3.
5. Any text on any of the three pages that names, numbers or characterises an individual beyond an anonymous slot id. Tasks 1 and 4.

---

### Task 1: Crew availability and rostering

**Files:** create `src/lib/depot/sim/crew.ts`, `src/lib/depot/crew/types.ts`, `src/lib/depot/crew/roster.ts`, `src/lib/depot/repositories/modelledCrewRepository.ts`; tests `src/tests/unit/depot-sim-crew.test.ts`, `depot-crew-roster.test.ts`.

```ts
export type CrewRole = 'driver' | 'conductor';
export type CrewAvailability = 'available' | 'weekly_off' | 'leave' | 'training' | 'absent';
export interface CrewSlot { readonly id: string; readonly role: CrewRole; readonly availability: CrewAvailability;
  readonly hoursThisWeek: number }
export interface CrewAssignment { readonly dutyId: string; readonly driverSlot: string | null; readonly conductorSlot: string | null;
  readonly uncoveredReason: 'no_available_crew' | 'hours_limit' | null }
export interface CrewSummary { readonly required: Readonly<Record<CrewRole, number>>;
  readonly available: Readonly<Record<CrewRole, number>>; readonly byAvailability: Readonly<Record<CrewAvailability, number>>;
  readonly uncoveredDuties: number; readonly assignments: readonly CrewAssignment[] }
export const MAX_DUTY_HOURS_PER_DAY = 10; export const MAX_HOURS_PER_WEEK = 48;
export function modelCrew(depot: DepotSummary, dutyCount: number, operatingDate: string): CrewSlot[];
export function rosterCrew(duties: readonly Duty[], crew: readonly CrewSlot[]): CrewSummary;
```

Strength is modelled at a stated ratio to duties with a seeded absence mix. Rostering assigns one available driver and one conductor per duty, earliest duty first, never the same slot to overlapping duties, never beyond either hours limit.

- [ ] Commits `test: specify modelled crew`, `feat: model crew availability`, `test: specify crew rostering`, `feat: roster crew against duties`.

### Task 2: Fuel and cost

**Files:** create `src/lib/depot/sim/fuel.ts`, `src/lib/depot/fuel/types.ts`, `src/lib/depot/fuel/analysis.ts`, `src/lib/depot/repositories/modelledFuelRepository.ts`; tests.

```ts
export interface BusFuelDay { readonly registrationNumber: string; readonly distanceKm: number; readonly fuelLitres: number;
  readonly serviceClass: ServiceClass; readonly routeName: string | null }
export interface FuelFigure { readonly kmPerLitre: number | null; readonly costPerKm: number | null; readonly variancePct: number | null }
export const FUEL_VARIANCE_FLAG_PCT = 15;
export function modelFuelDay(buses: readonly DepotBusView[], fleet: ReadonlyMap<string, ModelledBus>, operatingDate: string): BusFuelDay[];
export function analyseFuel(days: readonly BusFuelDay[], pricePerLitre: number): { perBus; perRoute; perClass; flagged };
```

Variance is against the median of buses of the same class on the same route (or the same class in the depot when a route has fewer than three buses), using the robust statistics already in `src/lib/depot/stats/robust.ts`.

- [ ] Commits `test: specify modelled fuel`, `feat: model daily fuel issue`, `test: specify fuel analysis`, `feat: analyse fuel use and cost`.

### Task 3: Revenue and ridership

**Files:** create `src/lib/depot/sim/ridership.ts`, `src/lib/depot/revenue/types.ts`, `src/lib/depot/revenue/analysis.ts`, `src/lib/depot/repositories/modelledRevenueRepository.ts`; tests.

Per route and day: trips (the P6 frequency model), boardings, load factor against seats, revenue, earnings per kilometre (only where the route's length is known), and the same per depot. A separate, labelled **Depot Economics Index (modelled)** combines earnings per kilometre, cost per kilometre and load factor within peer groups using the same robust scoring as the efficiency index, kept in its own module and never merged into `DepotScore`.

- [ ] Commits `test: specify modelled ridership`, `feat: model ridership and revenue`, `test: specify the economics index`, `feat: score depot economics separately`.

### Task 4: Views, APIs and pages

**Files:** create `src/lib/depot/live/{crewView,fuelView,revenueView}.ts`, routes `src/app/api/upsrtc/depot/[depotId]/{crew,fuel,revenue}/route.ts`, hooks on `usePolledJson`, components under `src/components/depot/{crew,fuel,revenue}/`, pages `d/[depotId]/{crew,fuel,revenue}/page.tsx`, a network page `/project/depots/economics`; update the feed registry statuses to `modelled`; depot sub-navigation and network navigation entries.

Each page: a summary, one hero chart or table, the detail table, and the MODELLED statement with what real feed replaces it and the schema that feed must provide (linking to Data Sources).

- [ ] Commits one per view, route and page.

### Task 5: End-to-end and documentation

- e2e: each API 401, 400 and 404; each page renders with its MODELLED statement; the crew pages contain the availability-only sentence and no individual's name; no banned wording; no sideways scroll at 1440, 1024 and 800.
- Docs: README, `docs/LIVE_VS_PREDICTED.md` (each model's assumptions and parameters), the Data Sources registry entries.

- [ ] Commits `test: cover resources and economics end to end`, `docs: describe the crew, fuel and revenue models`.

## Phase gate

1. `npm run typecheck && npm run lint && npm run test && npm run build`.
2. Both e2e specs on `http://localhost:3000`.
3. The pages walked in a browser at 1440, 1024 and 800.
4. Whole-phase code review; design critique; a specific read of every crew screen against the People constraint; findings fixed or recorded.
