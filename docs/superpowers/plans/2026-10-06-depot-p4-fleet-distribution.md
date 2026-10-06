# Depot Management P4 — Fleet Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HQ sees, for every depot, the buses it has against the buses it needs, and gets an optimiser-recommended set of transfers between depots with before-and-after impact, a what-if sandbox, and a decision trail.

**Architecture:** A deterministic modelled world, seeded by depot and operating date and anchored on the live snapshot, supplies what the feed lacks (depot master, fleet master, vehicle requirement, history). A pure min-cost-flow optimiser turns surplus and deficit into a transfer plan. The plan is computed on the server for the baseline and re-run in the browser for what-if scenarios on the 143-row balance table. Supply is live-derived; requirement is modelled, so the plan is labelled MODELLED everywhere.

**Tech Stack:** TypeScript, vitest, Next.js route handlers, Google Maps (transfer arcs), Recharts (sparklines), Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-06-depot-management-design.md`, `docs/superpowers/specs/2026-10-06-depot-ui-design-brief.md`. Builds on P1–P3.

## Global Constraints

- All earlier global constraints still bind.
- **Anchoring invariants** (enforced by tests): a depot's modelled counts partition its live fleet; modelled off-road is never below the live off-road count; modelled parking capacity is never below the live fleet; the last point of every modelled history series equals the live value for that metric.
- **Determinism:** the modelled world is a pure function of (depot id, operating date, live anchors). Same inputs, same world. Randomness comes only from `SeededRandom` in `src/lib/simulation/seededRandom.ts`; never `Math.random()` or the clock.
- Modelled values never overwrite or blend into live figures. They live in separate fields typed `Figure` with `provenance: 'modelled'`.
- **Recommendation only.** Nothing is dispatched. Every screen showing a plan carries the sentence "Recommendation only. No transfer order is issued." Decisions are recorded locally through the existing audit log and are flagged as model-derived.
- The optimiser is pure and side-effect free, takes plain data, and runs identically on the server and in the browser.
- Integer flows only: buses are not divisible.
- Before writing any chart or map encoding, load and follow the `dataviz` skill.

## Review Focus

1. A network with no surplus, or no deficit, or neither: the plan is empty with correct before/after totals, not an error. Task 2.
2. Total surplus smaller than total deficit: the plan covers as much as possible and reports the uncovered remainder per depot. Task 2.
3. Every deficit depot farther than the maximum transfer distance from any surplus depot: zero transfers, deficit reported as unreachable. Task 2.
4. A case where the greedy nearest-first choice is not optimal: the optimiser must find the cheaper plan. Task 2.
5. A what-if that removes more buses than a depot has, or sets a negative spare ratio: inputs are clamped and the UI says what was clamped. Task 3.
6. Fixture mode (about three buses per depot): balances and the plan still compute without dividing by zero, and the page explains that the sample is too small to be meaningful. Tasks 1 and 6.

---

### Task 1: Modelled world — depot master, fleet master, requirement

**Files:** create `src/lib/depot/sim/seed.ts`, `sim/depotMaster.ts`, `sim/fleetMaster.ts`, `sim/requirement.ts`, `sim/config.ts`; modify `src/lib/depot/types.ts`; tests `src/tests/unit/depot-sim-world.test.ts`.

```ts
export interface ModelledDepotMaster { readonly depotId: string; readonly parkingCapacity: number;
  readonly workshopBays: number; readonly fuelPoints: number }
export interface ModelledBus { readonly registrationNumber: string;
  readonly serviceClass: 'ordinary' | 'express' | 'ac' | 'premium';
  readonly ageYears: number; readonly seats: number }
export interface DepotBalance { readonly depotId: string; readonly depotName: string; readonly kind: DepotKind;
  readonly fleet: number;               // live
  readonly offRoad: number;             // live
  readonly available: number;           // fleet − offRoad (derived)
  readonly peakRequirement: number;     // modelled
  readonly spareTarget: number;         // modelled
  readonly required: number;            // peakRequirement + spareTarget
  readonly balance: number;             // available − required; positive is surplus
  readonly position: { readonly lat: number; readonly lng: number } | null } // yard, else centroid

export function operatingDateOf(feedNow: string | null, fetchedAt: string): string;   // YYYY-MM-DD
export function seedFor(depotId: string, operatingDate: string, salt: string): string;
export function modelDepotMaster(depot: DepotSummary, operatingDate: string): ModelledDepotMaster;
export function modelBus(registrationNumber: string, routeName: string | null): ModelledBus; // stable per registration
export function modelBalances(depots: readonly DepotSummary[], yards: ReadonlyMap<string, Yard>,
  operatingDate: string, params: RequirementParams): DepotBalance[];
export interface RequirementParams { readonly spareRatio: number; readonly baseUtilisation: number;
  readonly utilisationSensitivity: number; readonly noise: number }
export const DEFAULT_REQUIREMENT_PARAMS: RequirementParams; // spareRatio 0.08, base 0.86, sensitivity 0.5, noise 0.04
```

Requirement model (documented in `sim/config.ts` with the reasoning): a depot whose buses are more on the road than its peers right now is assumed to be stretched, and one with many standing buses to have slack.
`peakRequirement = round(available × clamp(baseUtilisation + sensitivity × (onRoadShare − medianOnRoadShare) + ε, 0.70, 1.12))` where `onRoadShare` is the P2 `onRoad` component, the median is over ranked depots, and `ε` is uniform in ±`noise` from the depot's seed. `spareTarget = ceil(peakRequirement × spareRatio)`. Only `kind === 'depot'` gets a requirement; other kinds have `required = available` and `balance = 0`. `serviceClass` is read from the route-name token when present (`ORD` → ordinary, `EXP` → express, `AC` → ac, `VOLVO`/`JAN`/`SCANIA` → premium), otherwise sampled from the registration seed with fixed proportions.

- [ ] Tests: determinism (same inputs twice; different date changes ε); every anchoring invariant on the fixture and on hand-built depots; `balance = available − required`; non-depot kinds balance to zero; parameters outside range are clamped (`spareRatio` to [0, 0.3]); a depot with zero available buses yields zero requirement and no `NaN`; `modelBus` is stable per registration and reads the service class from the route token. Commits `test: specify the modelled depot world`, `feat: seed the modelled world`, `feat: model depot and fleet master data`, `feat: model vehicle requirement and depot balance`.

---

### Task 2: Min-cost flow and the transfer plan

**Files:** create `src/lib/depot/optimise/minCostFlow.ts`, `optimise/rebalance.ts`, `optimise/config.ts`; tests `src/tests/unit/depot-min-cost-flow.test.ts`, `depot-rebalance.test.ts`.

```ts
// minCostFlow.ts — generic, integer capacities and costs
export interface FlowEdgeInput { readonly from: number; readonly to: number; readonly capacity: number; readonly cost: number }
export interface FlowResult { readonly flow: number; readonly cost: number; readonly edgeFlows: readonly number[] } // parallel to input edges
export function minCostMaxFlow(nodeCount: number, edges: readonly FlowEdgeInput[], source: number, sink: number): FlowResult;

// rebalance.ts
export interface RebalanceParams { readonly maxTransferKm: number; readonly detourFactor: number;
  readonly lockedDepotIds: readonly string[]; readonly excludedDepotIds: readonly string[] }
export const DEFAULT_REBALANCE_PARAMS: RebalanceParams;   // maxTransferKm 250, detourFactor 1.3
export interface Transfer { readonly id: string; readonly fromDepotId: string; readonly toDepotId: string;
  readonly buses: number; readonly distanceKm: number; readonly busKm: number }
export interface NetworkBalanceTotals { readonly depotsInDeficit: number; readonly depotsInSurplus: number;
  readonly totalDeficit: number; readonly totalSurplus: number }
export interface TransferPlan { readonly transfers: readonly Transfer[];
  readonly before: NetworkBalanceTotals; readonly after: NetworkBalanceTotals;
  readonly coveredDeficit: number; readonly uncovered: readonly { readonly depotId: string; readonly buses: number;
    readonly reason: 'no_surplus_in_range' | 'insufficient_surplus' | 'no_position' }[];
  readonly totalBusKm: number }
export function roadDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }, detourFactor: number): number;
export function planTransfers(balances: readonly DepotBalance[], params: RebalanceParams): TransferPlan;
export function applyTransfers(balances: readonly DepotBalance[], transfers: readonly Transfer[]): DepotBalance[];
```

Method: successive shortest augmenting paths on the residual graph with Bellman–Ford (costs can be negative on reverse edges; the graph is tiny). Network: source → each surplus depot (capacity = surplus), surplus → deficit arcs for pairs within `maxTransferKm` (cost = distance in whole metres), each deficit depot → sink (capacity = deficit). Max flow first, minimum cost among max flows. Locked depots give nothing; excluded depots neither give nor receive; depots without a position cannot take part and are reported as `no_position`. Transfers are sorted by buses descending then ids; ids are `from>to`.

- [ ] Tests for `minCostMaxFlow`: a 2×2 case where nearest-first is suboptimal and the known optimum is asserted; flow conservation at every inner node; capacities respected; disconnected sink → flow 0; zero-capacity edges; determinism. Tests for `planTransfers`: every Review Focus case 1–4; locked and excluded depots; `applyTransfers` reproduces `after`; `before`/`after` totals; covered + uncovered = total deficit; no mutation; runs under 100 ms on a synthetic 143-depot network (assert with a generous bound). Commits `test: specify min-cost flow`, `feat: add min-cost max-flow solver`, `test: specify the transfer plan`, `feat: plan transfers between depots`.

---

### Task 3: What-if scenarios

**Files:** create `src/lib/depot/optimise/scenario.ts`; test `src/tests/unit/depot-scenario.test.ts`.

```ts
export interface Scenario { readonly spareRatio?: number; readonly maxTransferKm?: number;
  readonly lockedDepotIds?: readonly string[]; readonly excludedDepotIds?: readonly string[];
  readonly fleetAdjustments?: readonly { readonly depotId: string; readonly deltaBuses: number }[];
  readonly demandSurges?: readonly { readonly depotId: string; readonly percent: number }[] }
export interface ScenarioOutcome { readonly balances: readonly DepotBalance[]; readonly plan: TransferPlan;
  readonly clamped: readonly string[] }   // human-readable notes on every input that was clamped
export function runScenario(base: readonly DepotBalance[], scenario: Scenario): ScenarioOutcome;
export function compareOutcomes(baseline: ScenarioOutcome, candidate: ScenarioOutcome): ScenarioDelta;
```

Clamps: `spareRatio` to [0, 0.3]; `maxTransferKm` to [25, 600]; a fleet adjustment cannot take `available` below 0; a surge percent to [−50, 100]. Surges scale `peakRequirement`; a changed spare ratio recomputes `spareTarget` from the existing `peakRequirement`.

- [ ] Commits `test: specify what-if scenarios`, `feat: run what-if scenarios on depot balances`.

---

### Task 4: Modelled history

**Files:** create `src/lib/depot/sim/history.ts`, `src/lib/depot/repositories/modelledHistoryRepository.ts`; modify repositories `types.ts` and `index.ts`; test `src/tests/unit/depot-sim-history.test.ts`.

```ts
export type MetricKey = 'onRoadShare' | 'offRoadRate' | 'darkRate' | 'index' | 'available';
export type HistoryScope = { readonly kind: 'network' } | { readonly kind: 'depot'; readonly depotId: string };
export interface SeriesPoint { readonly date: string; readonly value: number }
export interface HistoryRepository {
  series(metric: MetricKey, scope: HistoryScope, days: number, anchor: { readonly date: string; readonly value: number }): Promise<readonly SeriesPoint[]>;
}
```

A seeded mean-reverting walk with a weekly rhythm, generated backwards from the anchor so that the final point is exactly the live value on the operating date; values clamped to the metric's valid range; `days` clamped to [7, 180].

- [ ] Tests: last point equals the anchor; length; determinism; range clamps; different depots differ. Commits `test: specify modelled history`, `feat: add modelled history behind the history repository`.

---

### Task 5: Distribution and history APIs

**Files:** create `src/lib/depot/live/distributionView.ts`, `src/app/api/upsrtc/depot/distribution/route.ts`, `src/app/api/upsrtc/depot/history/route.ts`, `src/hooks/useDepotDistribution.ts`, `src/hooks/useDepotHistory.ts`; modify `src/lib/depot/sources/registry.ts` (depot master, fleet master, network timetable, history → `modelled`); tests for the view and for query validation (zod).

`GET /api/upsrtc/depot/distribution` → `{ balances, plan, requirementParams, rebalanceParams, operatingDate, feedNow, fetchedAt, source, stale }`. `GET /api/upsrtc/depot/history?metric=&scope=network|depot&depotId=&days=` → `{ series, provenance: 'modelled', anchor }`; invalid query → 400.

- [ ] Commits `test: specify distribution and history views`, `feat: add fleet distribution API`, `feat: add modelled history API`.

---

### Task 6: Fleet distribution page

**Files:** create `src/components/depot/rebalance/RebalancePage.tsx`, `BalanceSummary.tsx` (before and after totals), `TransferMap.tsx` (arcs between depots, width by buses, surplus and deficit nodes distinguished by shape as well as colour), `TransferTable.tsx`, `BalanceTable.tsx` (every depot: available, required, balance, as a diverging bar around zero), `src/app/(protected)/project/depots/rebalance/page.tsx`; modify nav (Network → `Fleet distribution`).

The transfer map is the hero instrument. The header carries the MODELLED tag and the sentence explaining what is live (fleet, off-road, available) and what is modelled (requirement, spare). The recommendation-only sentence is always visible.

- [ ] Commits one per component, then `feat: add fleet distribution page`.

---

### Task 7: Sandbox and decision trail

**Files:** create `src/components/depot/rebalance/ScenarioPanel.tsx` (spare ratio, maximum distance, lock or exclude a depot, add or remove buses at a depot, surge at a depot; shows clamped notes; "Reset to baseline"), `ScenarioCompare.tsx` (baseline against scenario), `DecisionTrail.tsx`; modify `src/lib/audit/auditLog.ts` (new event types `depot-transfer-approved`, `depot-transfer-rejected`, `depot-transfer-deferred`, model-derived); create `src/lib/depot/decisions.ts` (pure reducers over audit events, tested).

Each transfer row gets Approve, Reject and Defer with an optional note. Decisions persist through the existing audit log (browser storage) and are listed with time and note. Approving changes nothing but the record.

- [ ] Commits `test: specify transfer decisions`, `feat: record transfer decisions in the audit log`, `feat: add what-if sandbox`, `feat: add decision trail`.

---

### Task 8: Balance and trends on existing pages

**Files:** create `src/components/depot/shared/Sparkline.tsx`; modify the overview KPI band, league table and depot cockpit to add modelled trend sparklines (tagged MODELLED, never mixed into the live numeral) and, on the cockpit, a fleet-balance block (available, required, balance, and any transfer involving this depot).

- [ ] Commits `feat: add sparkline`, `feat: show modelled trends beside live figures`, `feat: show fleet balance on the depot cockpit`.

---

### Task 9: End-to-end and documentation

- e2e: distribution API 401; page renders balances and a plan or the "no transfers needed" state; sandbox change updates the comparison; clamped input shows its note; approve, reject and defer persist across reload; recommendation-only sentence present; no banned wording, no sideways scroll at 1440, 1024, 800.
- Docs: README, `docs/LIVE_VS_PREDICTED.md` (the requirement model, its parameters, anchoring invariants, what would make it real), `docs/ARCHITECTURE.md` (modelled world, history repository seam).

- [ ] Commits `test: cover fleet distribution end to end`, `docs: describe the modelled world and the transfer optimiser`.

## Phase gate

1. `npm run typecheck && npm run lint && npm run test && npm run build`.
2. Both e2e specs through the local wrapper on port 3210.
3. Fleet distribution walked in a browser at 1440, 1024 and 800: baseline, three scenarios, decisions, fixture mode.
4. Whole-phase code review; design critique; findings fixed or recorded.
