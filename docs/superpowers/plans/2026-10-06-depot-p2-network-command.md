# Depot Management P2 — Network Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HQ can see every depot on a map of Uttar Pradesh, rank depots fairly against peers with a Depot Efficiency Index, and open an exception centre listing the depots and buses that need attention — all computed from live data.

**Architecture:** Pure inference and scoring functions over `DepotBusRow[]` (bus operational state, robust statistics, peer groups, index, exceptions) run on the server inside the network view built in P1. The browser receives scores and exceptions, never bulk rows. Three pages consume them: the overview (map and summary), the league table, and the exception centre.

**Tech Stack:** TypeScript, vitest, Next.js route handlers, Google Maps JS API through the existing singleton loader, Recharts where a chart is needed, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-06-depot-management-design.md`, `docs/superpowers/specs/2026-10-06-depot-ui-design-brief.md`. Builds on `docs/superpowers/plans/2026-10-06-depot-p1-live-depot-path.md`.

## Global Constraints

- All P1 global constraints still bind (tracked code only, explicit staging, commit granularity and trailer, provenance and coverage on every figure, `feedNow` not `Date.now()`, no bulk rows to the browser, strict TypeScript, no new dependencies, design brief).
- Everything in this phase is `derived` from live data. Nothing here may be labelled or described as a trend: it is one snapshot.
- Scores and exceptions are **per depot**. Nothing in this phase scores, ranks or names an individual driver or crew member.
- Thresholds are named constants in one file per module with a comment giving the measured basis. No magic numbers in logic.
- A depot with fewer than `MIN_FLEET_FOR_RANK` buses is shown with its figures but is not ranked.
- Enforcement, hired and electric units and the unassigned bucket are listed but never ranked against depots.
- No function may return `NaN` or `Infinity`. A zero denominator yields `null`.
- Before writing any chart, bar or map colour, load and follow the `dataviz` skill.
- Map code uses `getMapsLoader()` from `src/lib/maps/loader.ts` (never a new Loader), `MAP_DARK_STYLE`, and `MapFallback` when the map cannot load.

## Measured basis for thresholds (400-row sample, GPS age relative to feedNow)

| `vehicle_status` | Median age | 90th percentile | Moving (>3 km/h) |
|---|---|---|---|
| `live` | 0.8 min | 33 min | 81% |
| `stationary` | 5.9 min | 110 min (max 4 h) | 0% |
| `no_signal` | 12.5 h | 4.5 days (none under 30 min) | — |
| `under_maintenance` | 4.8 days | 8.8 days | — |

Only 22 of 90 `live` buses carry a route assignment.

## Review Focus

1. A peer group where every depot has the same value (MAD of zero): z-scores must be 0, not `NaN` or `Infinity`. Task 2 and 3.
2. A depot with a fleet of 1 or 2: it must not top or bottom the league on a 100% or 0% rate. Task 3.
3. `feedNow` is null (no `receivedTime` anywhere): every bus state must still be defined and no exception may fire on age. Task 1 and 4.
4. Fixture mode with about three buses per depot: pages must render sensible "not enough buses to rank" states, not an empty or broken table. Tasks 6 and 9.
5. Google Maps fails to load (no key, blocked): the overview still shows KPIs and the ranked list; the map area shows `MapFallback`. Task 7.
6. The same snapshot scored twice gives identical output (determinism; stable tie-breaks). Task 3.

---

### Task 1: Bus operational state

**Files:**
- Create: `src/lib/depot/infer/busState.ts`, `src/lib/depot/infer/thresholds.ts`
- Modify: `src/lib/depot/types.ts` (add `BusOpState`, `StateMix`; add `states: StateMix` to `DepotSummary`)
- Modify: `src/lib/depot/live/aggregate.ts` (fill `states`)
- Test: `src/tests/unit/depot-bus-state.test.ts`; extend `depot-aggregate.test.ts`

**Produces:**

```ts
export type BusOpState = 'in_service' | 'on_road' | 'standing' | 'dark' | 'off_road';
export interface StateMix { readonly inService: number; readonly onRoad: number;
  readonly standing: number; readonly dark: number; readonly offRoad: number }

// thresholds.ts
export const MOVING_SPEED_KMPH = 3;      // above GPS jitter; no `stationary` bus exceeds it
export const DARK_AFTER_MIN = 360;       // `stationary` tops out at 4 h, `no_signal` starts at 7.5 h
export const LONG_DARK_AFTER_MIN = 4320; // 72 h

// busState.ts
export function gpsAgeMinutes(row: DepotBusRow, feedNow: string | null): number | null;
export function classifyBusState(row: DepotBusRow, feedNow: string | null): BusOpState;
```

Ordered rules (first match wins):
1. `vehicleStatus === 'under_maintenance'` → `off_road`.
2. `vehicleStatus === 'no_signal'`, or `gpsTimestamp` is null, or GPS age > `DARK_AFTER_MIN` → `dark`. When `feedNow` is null, age is unknown and only the first two conditions apply.
3. Speed > `MOVING_SPEED_KMPH` and a `routeName` is present → `in_service`.
4. Speed > `MOVING_SPEED_KMPH` → `on_road`.
5. Otherwise → `standing`.

`gpsAgeMinutes` returns null when either time is missing or unparsable, and clamps small negative ages (device clock ahead) to 0.

- [ ] **Step 1:** failing table-driven tests: one row per rule, the boundaries (speed exactly 3 → standing; age exactly 360 → not dark, 361 → dark), null `feedNow`, null speed, unparsable timestamp, negative age clamps to 0, and the fixture check that state counts per depot sum to `fleet`. Commit `test: specify bus operational state`.
- [ ] **Step 2:** implement; GREEN; `npm run test`. Commit `feat: classify bus operational state`.
- [ ] **Step 3:** add `states` to `DepotSummary` and fill it in `summariseDepots`. Commit `feat: add state mix to depot summaries`.

---

### Task 2: Robust statistics

**Files:**
- Create: `src/lib/depot/stats/robust.ts`
- Test: `src/tests/unit/depot-robust-stats.test.ts`

```ts
export function median(values: readonly number[]): number | null;        // null for empty
export function mad(values: readonly number[]): number | null;           // median absolute deviation
export const MAD_TO_SIGMA = 1.4826;
/** (value - median) / (1.4826 * MAD); 0 when MAD is 0; null when the sample is empty. */
export function robustZ(value: number, sample: readonly number[]): number | null;
export function clamp(value: number, min: number, max: number): number;
/** Cut points splitting sorted values into three near-equal groups. */
export function tercileCuts(values: readonly number[]): readonly [number, number] | null;
export function ratio(n: number, of: number): number | null;             // null when of is 0
```

- [ ] Tests: odd and even medians, single value, empty, unsorted input not mutated, MAD of identical values is 0 and `robustZ` is then 0, a known hand-computed z, `tercileCuts` on 9 and on 2 values, `ratio(0, 0)` null. Commit `test: specify robust statistics`, then `feat: add robust statistics helpers`.

---

### Task 3: Peer groups and the Depot Efficiency Index

**Files:**
- Create: `src/lib/depot/score/config.ts`, `src/lib/depot/score/peerGroups.ts`, `src/lib/depot/score/dei.ts`
- Modify: `src/lib/depot/types.ts`
- Test: `src/tests/unit/depot-dei.test.ts`

```ts
// config.ts
export const MIN_FLEET_FOR_RANK = 10;
export const MIN_PEER_GROUP = 5;       // smaller groups merge into one "all depots" group
export const Z_CLAMP = 3;
export const DEI_COMPONENTS = [
  { key: 'onRoad',       label: 'On-road share',      weight: 0.35, higherIsBetter: true  },
  { key: 'offRoad',      label: 'Off-road rate',      weight: 0.20, higherIsBetter: false },
  { key: 'dark',         label: 'Dark rate',          weight: 0.20, higherIsBetter: false },
  { key: 'scheduled',    label: 'Schedule coverage',  weight: 0.15, higherIsBetter: true  },
  { key: 'deviceHealth', label: 'Device integrity',   weight: 0.10, higherIsBetter: true  },
] as const;   // weights sum to 1; asserted by a test

// types.ts
export type PeerGroupId = 'small' | 'medium' | 'large' | 'all';
export type DeiComponentKey = 'onRoad' | 'offRoad' | 'dark' | 'scheduled' | 'deviceHealth';
export interface DeiComponent { readonly key: DeiComponentKey; readonly value: number | null;
  readonly peerMedian: number | null; readonly z: number | null; readonly contribution: number }
export interface DepotScore {
  readonly depotId: string;
  readonly peerGroup: PeerGroupId | null;      // null when not rankable
  readonly ranked: boolean;
  readonly reason: 'ok' | 'not_a_depot' | 'fleet_too_small';
  readonly index: number | null;               // 0-100, one decimal; null when not ranked
  readonly rank: number | null;                // 1-based within peer group
  readonly peerCount: number | null;
  readonly components: readonly DeiComponent[];// raw values always present; z and contribution only when ranked
}

// peerGroups.ts
export function assignPeerGroups(depots: readonly DepotSummary[]): ReadonlyMap<string, PeerGroupId>;
// dei.ts
export function componentValues(depot: DepotSummary): Record<DeiComponentKey, number | null>;
export function scoreDepots(depots: readonly DepotSummary[]): DepotScore[];
```

Definitions (rates between 0 and 1, all from `StateMix` and the P1 counts):
- `onRoad` = (inService + onRoad) / (fleet − offRoad)
- `offRoad` = offRoad / fleet
- `dark` = dark / fleet
- `scheduled` = assigned / fleet
- `deviceHealth` = 1 − (powerCut + tamperFlagged) / fleet, floored at 0

Scoring: rankable = `kind === 'depot'` and `fleet >= MIN_FLEET_FOR_RANK`. Peer groups are fleet-size terciles of the rankable depots; any group smaller than `MIN_PEER_GROUP` collapses everything into `'all'`. For each component: `z = robustZ(value, peerValues)`, clamped to ±`Z_CLAMP`, sign flipped when lower is better; a null value contributes 0. `index = clamp(50 + (Σ weight·z / Z_CLAMP) · 50, 0, 100)` rounded to one decimal. Rank within the peer group by index descending, ties broken by `depotId` ascending.

- [ ] **Step 1: failing tests.** Weights sum to 1. A depot identical to its peer median scores exactly 50. Monotonic: raising `onRoad` alone never lowers the index; raising `dark` alone never raises it. All-identical peer group → every index 50 and no `NaN`. Fleet below the minimum → `ranked: false`, `reason: 'fleet_too_small'`, `index: null`, component raw values still present. Non-depot kinds → `reason: 'not_a_depot'`. Tie-break by id. Deterministic: scoring a shuffled copy gives the same scores per depot. Fewer than `MIN_PEER_GROUP` in a tercile → all in `'all'`. Input not mutated. Commit `test: specify peer groups and the depot efficiency index`.
- [ ] **Step 2:** implement; GREEN. Commits `feat: assign depot peer groups`, `feat: score depots with the efficiency index`.

---

### Task 4: Exceptions

**Files:**
- Create: `src/lib/depot/exceptions/config.ts`, `depotExceptions.ts`, `busExceptions.ts`, `index.ts`
- Modify: `src/lib/depot/types.ts`
- Test: `src/tests/unit/depot-exceptions.test.ts`

```ts
export type ExceptionSeverity = 'critical' | 'warning' | 'info';
export type DepotExceptionKind = 'dark_share_high' | 'off_road_high' | 'on_road_low' | 'power_cut_cluster';
export type BusExceptionKind = 'long_dark' | 'power_cut' | 'tamper_code' | 'emergency';
export interface DepotException { readonly id: string; readonly depotId: string; readonly depotName: string;
  readonly kind: DepotExceptionKind; readonly severity: ExceptionSeverity;
  readonly value: number; readonly peerMedian: number | null; readonly z: number | null;
  readonly affected: number; readonly fleet: number }
export interface BusException { readonly id: string; readonly registrationNumber: string;
  readonly depotId: string | null; readonly depotName: string | null;
  readonly kind: BusExceptionKind; readonly severity: ExceptionSeverity;
  readonly lastSeen: string | null; readonly detail: string | null }
export interface ExceptionReport { readonly depot: readonly DepotException[];
  readonly bus: readonly BusException[]; readonly busTotal: number;       // before the cap
  readonly counts: Readonly<Record<DepotExceptionKind | BusExceptionKind, number>> }

export function buildExceptionReport(rows: readonly DepotBusRow[], depots: readonly DepotSummary[],
  scores: readonly DepotScore[], feedNow: string | null): ExceptionReport;
```

Rules (constants in `config.ts`):
- Depot exceptions fire only for ranked depots, when the component's z is at or beyond `EXCEPTION_Z = 2` in the bad direction **and** the rate differs from the peer median by at least `MIN_RATE_GAP = 0.10`. `|z| >= 3` is `critical`, otherwise `warning`.
- `power_cut_cluster`: `powerCut >= max(3, 10% of fleet)` among buses not `off_road`; `warning`.
- `long_dark`: GPS age > `LONG_DARK_AFTER_MIN`, bus not `off_road`; `warning`; never fires when `feedNow` is null.
- `power_cut`: `mainPowerOn === false` and state is not `off_road`; `info`.
- `tamper_code`: `tamperCode` present and not `'C'`; `info`; `detail` carries the raw code. Do not assert what the code means.
- `emergency`: `emergency === true`; `critical`.
- Sort: severity (critical, warning, info), then depot name, then registration. The `bus` list is capped at `BUS_EXCEPTION_CAP = 500`; `busTotal` and `counts` are computed before the cap. Ids are stable strings (`kind:depotId` and `kind:registration`).

- [ ] Tests for every rule and its boundary, the null-`feedNow` case, ordering, cap with correct totals, stable ids, no mutation. Commit `test: specify depot and bus exceptions`, then `feat: detect depot and bus exceptions`.

---

### Task 5: Serve scores and exceptions

**Files:**
- Modify: `src/lib/depot/types.ts` (`DepotNetworkResponse` gains `scores: readonly DepotScore[]` and `exceptionCounts`), `src/lib/depot/live/networkView.ts`
- Create: `src/lib/depot/live/exceptionView.ts` (memoised like the network view), `src/app/api/upsrtc/depot/exceptions/route.ts`
- Create: `src/hooks/useDepotExceptions.ts` (same polling pattern as `useDepotNetwork`, 60 s)
- Test: extend `depot-network-view.test.ts`; add `depot-exception-view.test.ts`

`GET /api/upsrtc/depot/exceptions` → `{ report: ExceptionReport; feedNow; fetchedAt; source; stale }`. Same guards, runtime flags, `maxDuration` and 503 handling as the network route.

- [ ] Commits: `test: specify score and exception views`, `feat: serve depot scores with the network view`, `feat: add depot exceptions API`.

---

### Task 6: League table page

**Files:**
- Create: `src/components/depot/league/LeagueTable.tsx`, `LeagueFilters.tsx`, `IndexBar.tsx`, `ScoreBreakdown.tsx`, `src/app/(protected)/project/depots/league/page.tsx`
- Create: `src/lib/depot/score/explain.ts` — `strongestAndWeakest(score): { strongest: DeiComponent | null; weakest: DeiComponent | null }` (pure, tested)
- Modify: `src/lib/depot/nav.ts` (Network → `League table`)
- Test: `src/tests/unit/depot-score-explain.test.ts`

Columns: Rank, Depot, Peer group, Index (numeral plus `IndexBar`), On-road, Off-road, Dark, Schedule coverage, Device integrity, Fleet. Each rate cell shows the value and its difference from the peer median in points. Filters: peer group, a text search on depot name, "show unranked". Selecting a row opens `ScoreBreakdown`: each component's value, peer median, z and contribution to the index, with one plain sentence naming the strongest and weakest component. Unranked depots show their reason ("12 buses needed to rank; this depot has 3"). The page header carries a DERIVED tag and the sentence "One snapshot of the live feed, compared within peer groups of similar fleet size."

- [ ] Commits: `test: specify score explanation`, `feat: explain a depot score`, `feat: add league table`, `feat: add league page`.

---

### Task 7: Depot map

**Files:**
- Create: `src/components/depot/network/DepotMap.tsx` (client), `src/lib/depot/map/nodeStyle.ts` (pure: radius from fleet, colour band from index, tested), `src/components/depot/network/DepotMapLegend.tsx`
- Test: `src/tests/unit/depot-map-node-style.test.ts`

One node per depot at its `centroid` (described on screen as "median position of the depot's buses", DERIVED). Radius scales with the square root of fleet between fixed minimum and maximum pixel sizes. Colour is a five-band sequential scale of the index; unranked depots are hollow. Hover shows name, fleet and index; click selects the depot and shows a summary panel beside the map. A legend explains size and colour in words. Depots without a centroid are counted in a line under the map ("4 depots have no positioned buses"). When Maps fails, render `MapFallback` and keep the rest of the page working. Read `src/components/map/FleetMap.tsx` and `src/components/bunching/BunchingMap.tsx` first and follow their loading, cleanup and auth-failure handling.

- [ ] Commits: `test: specify depot map node styling`, `feat: style depot map nodes`, `feat: add depot map`.

---

### Task 8: Exception centre page

**Files:**
- Create: `src/components/depot/exceptions/ExceptionCentre.tsx`, `DepotExceptionList.tsx`, `BusExceptionTable.tsx`, `src/lib/depot/exceptions/describe.ts` (pure sentence builders, tested), `src/app/(protected)/project/depots/exceptions/page.tsx`
- Modify: `src/lib/depot/nav.ts` (Network → `Exceptions`)
- Test: `src/tests/unit/depot-exception-describe.test.ts`

Top: counts by kind. Then depot exceptions as sentences with the numbers ("Dark rate 31% against a peer median of 12%: 44 of 142 buses"). Then the bus table (registration, depot, kind, last seen, detail) with filters by kind and depot and a note when the list is capped ("Showing 500 of 1,204"). Severity is always a word as well as a colour.

- [ ] Commits: `test: specify exception descriptions`, `feat: describe exceptions in plain language`, `feat: add exception centre`.

---

### Task 9: Overview composition

**Files:**
- Modify: `src/components/depot/network/NetworkOverview.tsx`
- Create: `src/components/depot/network/RankedStrip.tsx` (top five and bottom five ranked depots), `ExceptionSummary.tsx`

Order on the page: KPI band; map with its side panel; ranked strip; exception summary linking to the exception centre; the P1 depot table. In fixture mode with too few buses to rank, the ranked strip says so in one sentence.

- [ ] Commit `feat: compose the network overview`.

---

### Task 10: End-to-end and documentation

- Extend `tests/e2e/depot-management.spec.ts`: league page renders rows or the "not enough buses to rank" state; filters and row selection work by keyboard; exceptions API is 401 without a cookie; exception centre renders counts; the overview works with Google Maps blocked (`page.route` aborting `maps.googleapis.com`); no banned wording and no sideways scroll on the three pages at 1440, 1024 and 800.
- `README.md`, `docs/LIVE_VS_PREDICTED.md`: the index, its components and weights, peer groups, exception rules and thresholds with their measured basis, and what a snapshot can and cannot say.

- [ ] Commits: `test: cover league, map fallback and exceptions end to end`, `docs: describe the efficiency index and exception rules`.

## Phase gate

1. `npm run typecheck && npm run lint && npm run test && npm run build`.
2. Both e2e specs through the local wrapper on port 3210.
3. Overview, league and exceptions walked in a browser at 1440, 1024 and 800, with live or fixture data, and with Maps blocked.
4. Whole-phase code review; design critique of the three pages; findings fixed or recorded.
