# Depot Management — module reference

**Last updated:** 2026-10-06

The reference for the Depot Management module at `/project/depots`: what it is for, where
its data comes from, every route and API, every inference and model with its constants,
and what would replace each model. Written from the code; where this file and a plan or the
design spec disagree, the code is what is described here. Related documents:
[`DEPOT_UI_PATTERNS.md`](DEPOT_UI_PATTERNS.md) (shared page components) and
[`DEPOT_COPILOT_OPERATIONS.md`](DEPOT_COPILOT_OPERATIONS.md) (copilot settings and limits).

---

## 1. Purpose and scope

A workspace for HQ planners and depot managers, built on the same live GPS feed as the
command centre. It answers: how many buses each depot has and what they are doing, which
depots stand out against peers of similar size, which buses are physically in a depot's
yard, what a duty plan, crew roster, fuel and revenue picture would look like, and where
buses or routes could be moved to reduce empty running.

What it does not do:

- **Nothing is dispatched, assigned or written back.** Transfers, route allocations,
  bus-to-duty matches and the parking order are recommendations. Transfer decisions a user
  records are kept in the browser's `localStorage` (`src/lib/depot/rebalance/decisionStore.ts`).
- **No individual is scored or named.** Crew appear as anonymous slots; scoring is per
  depot, never per driver.
- **No database.** Live figures come from the current snapshot; history and trends are a
  generated series behind a repository interface (section 8).
- **One shared PIN, no per-depot permissions.** Any signed-in user can open any depot.
- **Route details are fetched one route at a time on a user's action**, never crawled
  (section 7.9).

## 2. Scopes and URL structure

There are two scopes: the **network** (every unit in the feed) and **one depot**. A
"unit" is any home-depot value in the feed; an "operating depot" is a unit whose kind is
`depot` (section 7.2). Navigation is defined in `src/lib/depot/nav.ts` (network) and
`src/lib/depot/depotNav.ts` (depot); the root is `/project/depots`.

| Route | Rail label | What it is for | Rests on |
| --- | --- | --- | --- |
| `/project/depots` | Overview | Fleet strength, state mix and efficiency across every unit | Live, derived |
| `/project/depots/league` | League table | Operating depots ranked by the Depot Efficiency Index within peer groups | Derived (rolling window) |
| `/project/depots/rebalance` | Fleet distribution | Buses each depot has against buses it needs; recommended inter-depot transfers; a what-if sandbox; a decision trail | Supply derived, requirement modelled |
| `/project/depots/routes` | Routes | Every route in the feed, and which depot should run it to cut dead kilometres | Live, derived from cached route profiles, trip frequency modelled |
| `/project/depots/exceptions` | Exceptions | Depots and buses that stand out, each with the figures that put it there | Derived |
| `/project/depots/economics` | Economics | Operating depots ranked by a modelled economics index | Modelled |
| `/project/depots/trends` | Network trends | Each network measure's history, a short forecast, and every unit's trend | Modelled history ending on a live value |
| `/project/depots/ask` | Ask | Plain-language questions to the copilot | Facts derived on the server |
| `/project/depots/sources` | Data sources | Every feed behind the module, its status, coverage and expected schema | Reference |
| `/project/depots/d/[depotId]` | Cockpit | Status board, outshedding tracker, exceptions, briefing for one depot | Live, derived |
| `/project/depots/d/[depotId]/roster` | Roster | Every bus homed at the depot: state, location, last heard, timetable on demand | Live, derived |
| `/project/depots/d/[depotId]/yard` | Yard | Who is in the inferred yard now; a night parking order on a modelled lane layout | Derived, modelled layout |
| `/project/depots/d/[depotId]/duties` | Duties | The day's modelled duties and the buses a matching would put on them | Duties modelled, bus states live |
| `/project/depots/d/[depotId]/maintenance` | Maintenance | Buses the feed reports under maintenance; modelled preventive services; workshop load | Off-road live, the rest modelled |
| `/project/depots/d/[depotId]/crew` | Crew | Anonymous crew availability against the day's shifts | Modelled |
| `/project/depots/d/[depotId]/fuel` | Fuel and cost | Fuel, distance, km per litre and cost per km; buses whose use stands out from peers | Modelled |
| `/project/depots/d/[depotId]/revenue` | Revenue | Trips, boardings and revenue by route | Modelled |
| `/project/depots/d/[depotId]/trends` | Trends | The depot's measures over time, a forecast, and forecast availability against modelled requirement | Modelled history ending on a live value |

Gates: `src/app/(protected)/project/depots/layout.tsx` calls `requireProjectSession`; the
depot layout (`d/[depotId]/layout.tsx`) refuses a malformed id with `notFound()` before the
session check, and `d/not-found.tsx` renders the miss. The client polls the depot APIs every
60 s (`DEFAULT_POLL_INTERVAL_MS` in `src/hooks/usePolledJson.ts`).

## 3. Provenance

Four words, defined in `src/lib/depot/labels.ts`:

| Word | Meaning |
| --- | --- |
| `LIVE` | Read from the feed as sent |
| `DERIVED` | Computed from live data on the server |
| `MODELLED` | Generated from planning assumptions, not measured |
| `REFERENCE` | Curated static data, not from the feed |

The word "simulated" is not used for depot data, on screen or in documents.

**Declared once per page (ruling S44).** A page declares its default provenance once,
under its header, as one tag and one fixed-formula sentence: `provenanceLine` on
`PageHeader`, rendered by `ProvenanceLine` from the pure `provenanceLine()` in
`src/lib/depot/provenanceLine.ts`. Its descriptions are `modelled` (optionally naming what
replaces it, with a link to Data sources), `mixed` (naming the live part and the modelled
part), `derived`, `live` and `reference`. Only a figure, column or section whose provenance
differs from the page default carries its own tag; an all-modelled page carries the tag
once. The stale, sample-data, unavailable and waiting wordings come from the same function.
See [`DEPOT_UI_PATTERNS.md`](DEPOT_UI_PATTERNS.md#provenance-line). At the time of writing,
pages are being moved onto `provenanceLine`; some still declare provenance through section
and figure tags.

## 4. The live data path

```
UPSRTC getGpsLiveData.php
        │  one fetch, single-flight, 15 s TTL (src/lib/upsrtc/liveSnapshot.ts)
        ▼
LiveSnapshot ──► map projection   (/api/upsrtc/live, command centre)
        └──────► depot projection (src/lib/upsrtc/depotNormalizer.ts, src/models/depotLive.ts)
                        │
                        ▼
FleetRepository.snapshot() (src/lib/depot/repositories/liveFleetRepository.ts)
                        │
                        ▼
analyseSnapshot (src/lib/depot/live/analysis.ts): states, locations, yards, scores,
exceptions — once per snapshot rows array
                        │
                        ▼
views (src/lib/depot/live/*View.ts) ──► route handlers (src/app/api/upsrtc/depot/**)
```

- **One upstream fetch, two projections.** The map route and the depot module read the
  same `LiveSnapshot`, so a depot count and a map pin always describe one payload.
- **Snapshot chain.** Live upstream, then the fresh cache (`LIVE_CACHE_TTL_MS = 15_000`),
  then last-known-good flagged `stale`, then the sanitised fixture. `NEXT_PUBLIC_DEMO_MODE`
  forces the fixture. The feed chip shows `LIVE` or `STALE`, never `CACHE`
  (`src/lib/depot/feedChip.ts`).
- **The feed clock.** `feedNow` is the newest `receivedTime` in the payload; every age
  (minutes since a fix, darkness, outshedding, the score window, yard holds, the operating
  date) is measured against it, never against the server's wall clock, so a stale or
  fixture snapshot stays internally consistent. The wall clock is used only for the HTTP
  envelope's `fetchedAt`, cache TTLs and rate-limit windows.
- **Server-side aggregation.** The browser never receives the fleet's ~9.6k rows for a
  network page; it receives summaries. Per-bus rows are sent only for one depot.

### Server house rules (every depot view)

1. Session check first: `requireUpsrtcAccess()`, else 401 (`unauthorizedResponse`).
2. Ids are validated before any lookup, cache key or response: `isValidDepotId` and
   `isValidRouteName` (`src/lib/depot/ids.ts`), and strict query parsers that refuse
   unknown or repeated parameters.
3. Fixed error bodies; the underlying error is logged server-side through `logDepotError`
   and never returned.
4. `Cache-Control: no-store` on every response (`jsonResponse` in `src/lib/upsrtc/respond.ts`),
   with opportunistic gzip.
5. Bodies are memoised per snapshot (`memoiseBody` in `live/analysis.ts`, keyed weakly on
   the analysis, which is keyed on the identity of the rows array); the feed envelope
   (`feedNow`, `fetchedAt`, `source`, `stale`) is built per request by `feedEnvelope`, so
   the same rows can be reported fresh on one request and stale on the next.
6. No view calls the upstream. The only depot route that can is the route-profile route,
   and only on a cache miss (section 7.9).
7. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30` (45 for the copilot).

### API routes

All under `src/app/api/upsrtc/depot/`, all `GET` except the copilot. Unless stated, errors
are `401` (no session), `400 {"error":"Invalid depot id"}` or `400 {"error":"Invalid query"}`,
`404 {"error":"Depot not found"}`, `503 {"error":"Depot data unavailable"}`. Payload types are
in `src/lib/depot/api.ts` and the domain `api.ts` files.

| Route | Returns | Query and validation |
| --- | --- | --- |
| `network` | Unit summaries, network KPIs, field coverage, scores, exception counts by kind and severity, `scoreWindow` | none |
| `exceptions` | Depot exceptions, counts, bus severity counts, one page of bus exceptions | `kind` (one of the four bus kinds), `depotId`, `offset`, `limit` ≤ 100 (`BUS_PAGE_MAX_LIMIT`); strict |
| `distribution` | Supply and modelled requirement per depot, the transfer plan | none |
| `routes` | One page of routes in the feed with derived columns | paging, sort `dir`, filters; `limit` default 25, max 100 (`src/lib/depot/routes/routeQuery.ts`); strict |
| `allocation` | The route-to-depot plan over cached profiles, filtered and paged per request | parsed by `parseAllocationQuery` (routeQuery.ts); strict |
| `route/[routeName]` | One route profile (stops, terminals, length) | `isValidRouteName` → `400 {"error":"Invalid route name"}`; cache misses rate-limited → `429 {"error":"Too many requests","retryAfterSeconds":n}`; `503 {"error":"Route data unavailable"}` |
| `economics` | The modelled economics index, network and per depot | none |
| `history` | A daily series for one metric | `metric` (onRoadShare, offRoadRate, darkRate, index, available), `scope` network or depot, `depotId` when scope is depot, `days` 7–180 default 30 (`live/historyView.ts`); `404` "No value for this metric" / "No index for this depot" |
| `trends` | History with trend words for many units | strict parser in `live/trendsView.ts`, `days` 7–90 default 30 |
| `forecast` | Trend and forecast for one series | the history query plus one `horizon` (`live/forecastView.ts`) |
| `[depotId]` | One depot's detail: summary, buses, yard, outshedding, exceptions | depot id |
| `[depotId]/parking` | The yard's modelled lanes and the night parking order | depot id |
| `[depotId]/duties` | The duty board: duties, proposed bus matches, exclusions | depot id |
| `[depotId]/maintenance` | Off-road list, modelled service schedule, workshop load | depot id |
| `[depotId]/crew` | Anonymous slots, shifts, coverage, uncovered shifts with reasons | depot id |
| `[depotId]/fuel` | Fuel per bus, route and class; flagged buses | depot id |
| `[depotId]/revenue` | Trips, boardings and revenue per route | depot id |
| `copilot` (POST) | A briefing, rationale or answer | origin, body, limits and deadline enforced in `src/lib/depot/copilot/service/`; see [`DEPOT_COPILOT_OPERATIONS.md`](DEPOT_COPILOT_OPERATIONS.md) |

## 5. Repositories and the composition root

`src/lib/depot/repositories/` is the seam between depot logic and where its data comes
from. Views and routes call `getRepositories()` (`repositories/index.ts`) and never import
an adapter.

| Repository | Adapter today | Interface |
| --- | --- | --- |
| `fleet` | `liveFleetRepository` — the shared live snapshot; rows passed through uncopied, because the analysis is memoised on their identity | `snapshot(): Promise<FleetSnapshotView>` |
| `history` | `modelledHistoryRepository` — `sim/history.ts` | `series(metric, scope, days, anchor)` |
| `crew` | `modelledCrewRepository` | crew/api.ts |
| `fuel` | `modelledFuelRepository` | fuel/api.ts |
| `revenue` | `modelledRevenueRepository` | revenue/api.ts |

To replace a model with a real feed or a database: write a new adapter implementing the
same interface (returning the same payload shape, with real values), wire it in
`repositories/index.ts`, and change the page's provenance declaration and the
Data sources registry entry (`src/lib/depot/sources/registry.ts`) from `modelled` to
`live`. Nothing else imports the adapter. The history adapter is the one a database
replaces: a daily store of per-depot snapshots behind `series()`.

Models that are not yet behind a repository and are called directly by views: the
requirement model, the depot master (`sim/depotMaster.ts`: parking capacity, bays, fuel
points), the yard lane layout, the fleet master (`sim/fleetMaster.ts`), the duty plan and
operating day, and the maintenance service model. Replacing them means adding a repository
first.

## 6. In-process state and its limits

| State | Where | Bound |
| --- | --- | --- |
| Live snapshot cache and last-known-good | `src/lib/upsrtc/liveSnapshot.ts` | 15 s TTL |
| Rolling score window | `score/windowStore.ts` | 20 min of feed time, ≤ 120 samples per depot |
| Yard memory | `infer/yardMemory.ts` | 12 h hold, ≤ 1,000 depots |
| Memoised analyses and view bodies | `live/analysis.ts` | held weakly per snapshot |
| Route-profile cache | `routes/routeCatalogue.ts` | ≤ 2,000 routes; negative answers 10 min |
| Allocation plan | `live/allocationView.ts` | re-planned at most every 30 s per rows |
| Route-profile fetch limiters | `route/[routeName]/route.ts`, `rateLimit.ts` | per minute |
| Copilot runtime: response cache, in-flight sharing, allowances, limiters, CLI semaphore and breaker | `copilot/service/` | see the copilot document |

Consequences: a restart or cold start empties all of it. The score window then starts
short and screens say "since HH:MM"; yards are re-established from one snapshot; the route
catalogue is empty until users load details again; the copilot's limits and budget reset.
With several instances, each holds its own copy: two requests can be scored over different
windows, see different held yards and different cached routes, and every limit and the
copilot's Claude budget multiply by the number of instances. A shared store (for example
Redis) is the fix and is not built.

## 7. Inferences and algorithms

All pure TypeScript under `src/lib/depot/`, deterministic, with no clock read except the
feed time passed in.

### 7.1 Bus state — `infer/busState.ts`, `infer/thresholds.ts`

First matching rule wins: feed says under maintenance → `off_road`; no signal, no fix time,
or a fix older than `DARK_AFTER_MIN = 360` minutes → `dark`; speed at or below
`MOVING_SPEED_KMPH = 3` → `standing`; moving, carrying a route, scheduled for the feed date
and heard within `REPORTING_WINDOW_MIN = 30` → `in_service`; any other moving bus →
`on_road`. A bus quiet for more than the reporting window but not yet dark gets
"Not heard for N min" (`notHeardMinutes`) rather than a new state. `LONG_DARK_AFTER_MIN =
4320` marks the long-dark exception.

Location (`infer/location.ts`): `in_yard`, `at_other_yard`, `away` or `unknown`, testing the
bus's own yard first.

### 7.2 Depot kind and peer groups — `live/depotKind.ts`, `score/peerGroups.ts`

Kind is read from the name: empty → `unassigned`; starting `ENFORCEMENT` → `enforcement`;
whole word `HIRED` → `hired`; whole word `ELECTRIC` → `electric`; otherwise `depot`. Only
`depot` units with at least `MIN_FLEET_FOR_RANK = 10` buses are rankable. Rankable depots
are split into fleet-size terciles; if any tercile would hold fewer than
`MIN_PEER_GROUP = 5`, everyone goes into one group.

### 7.3 Depot Efficiency Index and its rolling window — `score/`

Five components (`score/config.ts`): on-road share 0.35, off-road rate 0.20, dark rate 0.20,
schedule coverage 0.15, device integrity 0.10. Each is a robust z against the peer group
(`stats/robust.ts`: (value − median) / (1.4826 × MAD); when the MAD is 0, the mean absolute
deviation around the median × 1.2533 is used, ruling S9), clamped to `Z_CLAMP = 3`, signed so
higher is better, weighted, and scaled to 0–100 as `50 + (weighted / 3) × 50` (`score/dei.ts`).

**Rolling window (ruling S42).** Components are computed from counts summed over the
snapshots seen in the last `SCORE_WINDOW_MIN = 20` minutes of feed time, at most
`SCORE_WINDOW_MAX_SAMPLES = 120` (`score/window.ts`), one sample per distinct feed time. A
repeated or older snapshot adds nothing. The `network`, `exceptions` and `[depotId]`
responses carry `scoreWindow` (minutes, since, samples). Ruling S42 asks every screen to state
the window ("over the last 20 minutes", or "since HH:MM" when shorter); at the time of writing
no page component reads `scoreWindow`, and the League table's description still reads "One
snapshot of the live feed". Peer-group membership follows present fleet size. The window is process memory (section 6).

### 7.4 Exceptions — `exceptions/`

Depot exceptions compare a depot with its peers (`dark_share_high`, `off_road_high`,
`on_road_low`) at `EXCEPTION_Z = 2`, critical at `CRITICAL_Z = 3`, and need a rate gap of at
least `MIN_RATE_GAP = 0.1`; these use the rolling window. `power_cut_cluster` needs at least
`POWER_CUT_CLUSTER_MIN = 3` buses and `POWER_CUT_CLUSTER_SHARE = 0.1` of the fleet. Bus
exceptions: `long_dark`, `power_cut`, `tamper_code` (any code other than
`NORMAL_TAMPER_CODE = 'C'`; the meaning of other codes is not asserted), `emergency`, capped at
`BUS_EXCEPTION_CAP = 500` with counts taken before the cap (`exceptions/config.ts`).

### 7.5 Yard inference — `infer/yard.ts`, `infer/yardClusters.ts`

There is no depot master, so a yard is learned from where a depot's standing buses park.
Parked buses are linked by distance (density clustering, ruling S25): a bus is a core point
when at least `YARD_CORE_MIN_NEIGHBOURS = 4` parked buses, itself included, stand within
`YARD_LINK_M = 150` m; core points within the link distance form one group, and any other
bus within reach of a core point joins that group as a border member without extending it. The rule, as screens state it (`infer/yardRuleText.ts`, built
from the constants):

> A yard is claimed only when at least 6 parked buses stand together, each within 150 m of
> the next, in one place that holds at least 25% of the depot's parked buses, 1.5 times as
> many as any other place, and is no more than 1.5 km across.

(`YARD_MIN_CLUSTER = 6`, `YARD_MIN_SHARE = 0.25`, `YARD_DOMINANCE_RATIO = 1.5`,
`YARD_MAX_SPAN_M = 1500`.) The yard's radius is the largest member distance plus
`YARD_RADIUS_PAD_M = 40`, at least `YARD_MIN_RADIUS_M = 120`. Otherwise the depot has no yard
and screens say so. Screens describe an inferred yard as "Learned from where the depot's
buses park; not a surveyed location" (`live/depotView.ts`).

### 7.6 Yard continuity — `infer/yardContinuity.ts`, `infer/yardMemory.ts`

Ruling S43. Once a yard is established in this process it is kept while at least
`YARD_MIN_CLUSTER` (6) of the depot's standing buses are inside it, even when another stand
has grown as large, for up to `YARD_HOLD_MAX_HOURS = 12` hours of feed time; it is then shown
as "held since HH:MM" (`Yard.heldSince`). Only a newer feed time writes the memory; an older
one bypasses it. A fresh process remembers nothing.

### 7.7 Outshedding — `infer/outshed.ts`

Per scheduled trip, ordered (ruling S6): ended; departed on actual time; upcoming (start
still ahead of `feedNow`, even if the bus is dark); unknown (dark or unlocated); departed by
location; due; overdue after `OUTSHED_GRACE_MIN = 10`. An actual start counts only within
`ACTUAL_START_WINDOW_MIN` (120 before, 360 after the schedule); delays above
`MAX_PLAUSIBLE_DELAY_MIN = 180` are not shown as adherence. Coverage is low because few rows
carry a schedule.

### 7.8 Requirement and transfers — `sim/requirement.ts`, `optimise/`

The feed says what a depot has, not what it needs. The requirement is **modelled** from the
live figures (`sim/config.ts`): a base utilisation of 0.86 of available buses at peak, moved by
0.5 points per point of on-road share above peers, plus a seeded ±0.04 per-depot variation,
plus a spare ratio (`DEFAULT_SPARE_RATIO = 0.08`, range 0–0.3, in `optimise/config.ts`).
Available = fleet − off-road.

Transfers (`optimise/rebalance.ts`, `optimise/minCostFlow.ts`): min-cost max-flow by
successive shortest paths from surplus to deficit depots, distance = straight line × detour
factor 1.3, up to a maximum transfer distance (default 250 km, bounded 25–600). Only
`kind === 'depot'` units give or receive (ruling S7); excluded depots stay in the totals and
their deficit is reported as uncovered with reason `excluded`; locked depots may receive but
not give. Uncovered reasons in order: `excluded`, `no_position`, `no_surplus_in_range`,
`insufficient_surplus`. The what-if sandbox (`optimise/scenario.ts`) re-runs the plan with a
demand surge (−50% to +100%), fleet adjustments (≤ 500 per depot), spare ratio and distance.
Depot positions are the inferred yards.

### 7.9 Route profiles and route-to-depot allocation — `routes/`, `optimise/allocate*.ts`

A route profile (ordered stops, terminals, one-way length) is read through one bus running
that route, from the schedule API, once per route per operating day, and cached
(`routes/routeCatalogue.ts`: `ROUTE_CACHE_MAX = 2000`, negative answers for
`ROUTE_NEGATIVE_TTL_MS = 600_000`). Stops at 0,0 stay in the list but do not count toward
length. There is **no background crawl** (ruling S40). A profile is fetched one route at a time,
when a user opens that route on the Routes page, or opens a depot's roster or a bus on that
route (`PROFILES_GROW_WITH_USE` in `routes/allocationWording.ts`), so coverage grows with use.
Ruling S40 also approved a user-initiated, sequential loader for one depot's routes; it is
not in this build. Cache misses are limited (`ROUTE_PROFILE_FETCH_LIMITS` in
`rateLimit.ts`): 20 per identity, 40 per trusted address, 120 per process, per minute.

The allocation (`optimise/allocate.ts`) recommends which depot should run each route to cut
dead kilometres (inferred yard to the route's real first and last stop) within capacity. It
starts from the current allocation and applies single-route shifts and swaps that save at
least `MIN_SAVING_KM_PER_DAY = 5` in total (a swap as a whole, ruling S20), up to
`MAX_MOVES = 200` (`optimise/allocateConfig.ts`). Trips per day are modelled
(`sim/tripFrequency.ts`, 1–2 depot-anchored runs per bus). Only routes whose profiles are
already cached are planned. Unchanged routes carry one reason (ruling S21).

### 7.10 Duties and bus-to-duty matching — `sim/duties.ts`, `optimise/assignDuties.ts`

The modelled duty plan has exactly one duty per bus the depot needs at peak, dealt
round-robin over the depot's routes in name order; durations are out-and-back plus layover
when a scheduled duration is known, otherwise a seeded 4–10 h; starts cluster on a morning
peak. The matching (Hungarian algorithm, `optimise/hungarian.ts`) excludes buses that are off
road, dark or not in the yard (one reason each), forbids cross-class pairs, and costs
`ageYears × round(durationHours)` so longer duties prefer younger buses. When the depot has no
established yard, location is ignored. Duties without a bus are `no_eligible_bus`.

### 7.11 Night parking order — `optimise/parkingOrder.ts`, `sim/yardLayout.ts`

The lane layout is modelled: lanes of 6–10 buses summing to the modelled parking capacity,
seeded by depot id. The plan deals buses by ascending first departure, layer by layer from
the lane mouths, so the earliest departures sit at different mouths and no bus is blocked by
a later one; buses beyond capacity overflow latest-first.

### 7.12 Maintenance — `maintenance/`

Off-road buses are live (`vehicleStatus === 'under_maintenance'`). Preventive services are
modelled: each bus has a modelled odometer anchored on its modelled age and a class's annual
distance (`maintenance/config.ts`: service intervals 10,000 / 12,000 / 8,000 / 8,000 km for
ordinary / express / ac / premium; due soon within `DUE_SOON_WITHIN_KM = 1_500`). The
workshop compares live off-road buses with modelled bays (`sim/config.ts`:
`BUSES_PER_WORKSHOP_BAY = 25`).

**The feed's `distance` field** (`odometerRaw`) has no documented unit and is never shown as
kilometres or used for service due dates. `scripts/calibrate-odometer.ts` gathers evidence
on its unit from two snapshots (`maintenance/calibration.ts`); it never confirms a unit by
itself.

### 7.13 One modelled operating day — `sim/operatingDay.ts`

Ruling S41. Crew, fuel, revenue and the duty count all derive from one modelled day per depot
and date: the duty plan, and which available buses ran which duty (class matched, seeded
order). A bus that ran covered its duty's route out and back; a route's length is the real
one when its profile is cached (DERIVED), else a typical class length (MODELLED,
`sim/operatingDayConfig.ts`). It reads:

- **Crew** (`sim/crew.ts`, `crew/roster.ts`): shifts derived from duties (a duty longer than
  `MAX_DUTY_HOURS_PER_DAY = 10` is split, ruling S27); slots per shift 1.45 drivers and 1.4
  conductors plus `CREW_RESERVE_SLOTS = 2`; seeded leave 6%, training 3%, absent 4%; weekly
  limit `MAX_HOURS_PER_WEEK = 48`. Uncovered shifts carry a reason per role (ruling S36).
  Slots are anonymous.
- **Fuel** (`sim/fuelConfig.ts`, `fuel/`): km per litre 4.8 / 4.6 / 4.0 / 3.6 by class with a
  per-bus spread and daily noise; price `DEFAULT_PRICE_PER_LITRE = 92`. A bus is compared
  with its peers (other buses of its class on the route, `MIN_PEERS = 2`) and flagged at
  `FUEL_VARIANCE_FLAG_PCT = 15` only when the peer median is supported (rulings S28, S31).
- **Revenue** (`sim/revenueConfig.ts`): load factor 0.62 / 0.55 / 0.45 / 0.40; fare per
  occupied seat-km ₹1.1 / 1.5 / 2.2 / 2.8; revenue per leg = seats × load factor × length ×
  fare per km, two legs per trip (ruling S32).
- **Economics** (`revenue/economicsIndex.ts`): earnings per km 0.40, cost per km 0.35, load
  factor 0.25, robust z clamped at 3, within the efficiency index's peer groups; every
  operating depot is ranked when its group keeps at least `MIN_PEER_GROUP` members, else
  `peer_group_too_small` (ruling S39).

### 7.14 History, trends and forecasting — `sim/history.ts`, `forecast/`

History is a **modelled** daily series: a mean-reverting walk with a weekly rhythm, built
backwards from today's live value so it cannot contradict the figure beside it, seeded per
date. Network rates are computed from summed counts, never a mean of depot rates.

Trend words compare a week and four weeks (`FOUR_WEEK_DAYS = 28`, ruling S35), and "steady"
is judged against the series' own variation (`STEADY_QUANTILE = 0.8`).

Forecasts (`forecast/config.ts`): seasonal-naive is the baseline; Holt-Winters replaces it
only when its backtest error over the displayed horizon beats it by `METHOD_MARGIN = 0.05`.
Backtest over `BACKTEST_DAYS = 28`; the band h days ahead is the `BAND_QUANTILE = 0.8`
quantile of that method's h-step errors, pooled when fewer than `MIN_BAND_SAMPLES = 10`
(ruling S34). No forecast from fewer than `MIN_HISTORY_DAYS = 28` days; horizon default
`DEFAULT_HORIZON_DAYS = 14`, max 28. Because the history is modelled, so is every forecast.

## 8. The copilot

A server route (`POST /api/upsrtc/depot/copilot`) writes briefings, transfer rationales and
answers. Every figure comes from server facts; a model writes only the wording, validated by
a token grammar and a closed vocabulary (rulings S26, S38) before anyone sees it. Two
providers behind the `CopilotProvider` interface (`copilot/types.ts`): `scripted` (always
available) and `claude-cli`, which runs the locally installed `claude` command and works only
on a machine where Claude Code is signed in. A staff-facing deployment needs an API-key
provider behind the same interface; it is not built. Settings, limits and what one PIN holder
can do: [`DEPOT_COPILOT_OPERATIONS.md`](DEPOT_COPILOT_OPERATIONS.md).

## 9. Directory map

`src/lib/depot/`:

| Folder | Holds |
| --- | --- |
| `live/` | Snapshot analysis, aggregation, and one view builder per API route |
| `infer/` | Bus state, location, yard inference and continuity, outshedding |
| `score/`, `stats/` | Efficiency index, peer groups, rolling window, robust statistics |
| `exceptions/` | Depot and bus exceptions, paging |
| `optimise/` | Transfers (min-cost flow), what-if, allocation, Hungarian matching, parking |
| `sim/` | Every model: requirement, depot and fleet master, duties, operating day, crew, fuel, ridership, history, yard layout |
| `routes/` | Route catalogue and profiles, route table, allocation inputs, dead kilometres |
| `crew/`, `fuel/`, `revenue/`, `maintenance/`, `duties/`, `yard/`, `cockpit/`, `roster/`, `league/`, `network/`, `rebalance/` | Per-domain page models and payload types |
| `forecast/` | Trend, seasonal-naive, Holt-Winters, backtest, band, chart models |
| `copilot/` | Facts, grammar, vocabulary, providers, CLI runner, service, client |
| `repositories/` | The data seam and composition root |
| `sources/` | The Data sources registry |
| top level | Ids, navigation, labels, provenance line, feed chip, rate limiter, formatting |

`src/components/depot/`: one folder per page (`cockpit`, `roster`, `yard`, `duties`,
`maintenance`, `crew`, `fuel`, `revenue`, `economics`, `league`, `network`, `rebalance`,
`routes`, `exceptions`, `trends`, `sources`, `copilot`) plus `shell` (header, navigation,
provenance line, data states), `shared` and `data`.

## 10. Testing

- **Unit:** Vitest under `src/tests/unit/`, named `depot-<subject>.test.ts(x)`; 216 of the
  230 test files there belong to the module. Run one with
  `npx vitest run src/tests/unit/depot-yard.test.ts`, or all with `npm run test`.
- **End to end:** `tests/e2e/depot-management.spec.ts` (the deep link through login, the
  shell, Back to Operations, the banned-wording check, no sideways scroll at three widths,
  the skip link, a console-error-free load). Run with `npm run test:e2e` after
  `npm run build`. It needs `E2E_PROJECT_PIN` (without it the suite is skipped); optional
  `E2E_PROJECT_NAME`, `E2E_HOST`, `E2E_PORT`, `E2E_ORIGIN`. The server needs the app's own
  environment (section 3 of the README).
- **Odometer evidence:** `npx tsx scripts/calibrate-odometer.ts --live` (two upstream reads
  at least a minute apart; aggregates only).

## 11. What is real, what is modelled, what is needed

From the Data sources registry (`src/lib/depot/sources/registry.ts`), which lists the schema
each real feed must provide.

| Domain | Today | Replaced by | Needed fields (summary) |
| --- | --- | --- | --- |
| Bus states, positions, routes, device health | LIVE: GPS and device feed | — | — |
| Stops and terminals | LIVE on demand: route details API | a route and stop master | stops with ids, sequence, coordinates |
| Yard position and capacity | DERIVED yard; MODELLED capacity, bays, lanes | Depot master | depotId, name, kind, regionId, latitude, longitude, parkingCapacity, bays |
| Bus class, seats, age | MODELLED fleet master | Fleet master | registrationNumber, homeDepotId, busType, seats, yearOfManufacture, status |
| Requirement, duties, trips | MODELLED | Network timetable or blocks | routeId, tripId, depotId, blockId, direction, departure, arrival, daysOfOperation |
| Crew | MODELLED | Crew and duties feed | depotId, date, anonymous slotId, role, availability, hoursThisWeek |
| Maintenance | LIVE off-road flag; MODELLED services | Maintenance work orders | registrationNumber, workOrderId, category, openedAt, expectedReturn, closedAt |
| Fuel | MODELLED | Fuel issue records | registrationNumber, date, distanceKm, fuelLitres, serviceClass, routeName |
| Revenue, ridership, economics | MODELLED | Ticketing and ridership | routeName, date, serviceClass, trips, seatCapacity, boardings, revenue, routeLengthKm |
| History, trends, forecasts | MODELLED series ending on a live value | History store and ingestion worker | snapshotAt, depotId, fleet, state counts, reporting, efficiencyIndex |

The corporation must also confirm the meaning and unit of the feed's `distance` field and
of `delayMinutes`, and the meaning of tamper codes other than `C`.
