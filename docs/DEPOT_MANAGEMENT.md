# Depot Management — module reference

**Last updated:** 6 Oct 2026

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
  records are kept in this browser's `localStorage` (`depot-transfer-decisions-v1`,
  `src/lib/depot/rebalance/decisionStore.ts`), visible to anyone who uses the browser, notes
  included, as the trail's note says. A Clear trail control (with a confirm step) removes the
  whole trail. A trail that cannot be read is reported, never read as empty, and is copied
  aside to `depot-transfer-decisions-v1-unreadable` before the next decision is written. Each
  decision is also copied, with its note emptied, to the command centre's shared audit log
  (`upsrtc-copilot-audit-v1`, `src/lib/audit/auditLog.ts`), which Clear trail does not reach.
- **No individual is scored or named.** Crew appear as anonymous slots; scoring is per
  depot, never per driver.
- **No database.** Live figures come from the current snapshot; history and trends are a
  generated series behind a repository interface (section 5).
- **One shared PIN, no per-depot permissions.** Any signed-in user can open any depot.
- **Route details are fetched one route at a time on a person's action**, never crawled
  (section 7.9).
- **Server state is held in process memory** (section 6): a restart forgets it, and several
  instances each hold their own copy.

## 2. Scopes and URL structure

There are two scopes: the **network** (every unit in the feed) and **one depot**. A
"unit" is any home-depot value in the feed; an "operating depot" is a unit whose kind is
`depot` (section 7.2). Every module path is defined once, in `src/lib/depot/nav.ts`, and
imported from there; the network pages are listed there and the depot pages in
`src/lib/depot/depotNav.ts`. The root is `/project/depots`.

| Route | Rail label | What it is for | Rests on |
| --- | --- | --- | --- |
| `/project/depots` | Overview | Fleet strength, state mix and efficiency across every unit | Live, derived |
| `/project/depots/league` | League table | Operating depots ranked by the Depot Efficiency Index within peer groups | Derived (rolling window) |
| `/project/depots/rebalance` | Fleet distribution | Buses each depot has against buses it needs; recommended inter-depot transfers; a what-if sandbox; a decision trail | Supply derived, requirement modelled |
| `/project/depots/routes` | Routes | Every route in the feed, and which depot should run it to cut dead kilometres | Live, derived from cached route profiles, trip frequency modelled |
| `/project/depots/routes/r/[routeName]` | Routes (reached from a route's row or drawer) | One route's day hour by hour: buses deployed, scheduled and needed, the gap, proposals and punctuality (section 7.15) | Deployed derived (modelled where not observed), scheduled derived and partial, demand, need and proposals modelled |
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
session check, and `d/not-found.tsx` renders the miss. The route day page gates itself the
same way with `requireRoutePage` (`src/lib/depot/depotGate.ts`): a name that fails
`isValidRouteName` ends in `routes/r/not-found.tsx` before the session check; its path is
`routeHourlyPath(routeName)` in `nav.ts`, under the Routes page, so the rail keeps Routes lit. The client polls the depot APIs every
60 s (`DEFAULT_POLL_INTERVAL_MS` in `src/hooks/usePolledJson.ts`). The polling hook's rules:
a tick never aborts a request in flight, skips while one is pending or the tab is hidden, and
showing the tab refreshes at once; a new query on the same path can keep the previous answer
on screen, marked as previous, while it loads (`keepPreviousOnQueryChange`, used by the route
table); a page's own failed request after a success keeps its figures and says so at once
(`src/lib/depot/pageRefresh.ts`, `PageRefreshNotice`); a 404 drops the figures and stops
polling, so the page shows its not-found state; a 401 drops them, stops polling and sends
the browser once to `/login?next=<this page>` (`src/lib/depot/signInRedirect.ts`), never
from the sign-in page itself.

**State in the URL.** The Exceptions page reads its filters from the router's search
parameters and writes them with `history.pushState`, so a link into Exceptions lands on the
filtered page and Back steps through filters. The roster's `?bus=` is validated
(`parseBusParam` in `src/lib/depot/roster/rosterQuery.ts`: at most
`MAX_BUS_PARAM_LENGTH = 16` characters) before it reaches the drawer, and the roster writes
its URL with `history.replaceState`, so Back leaves the page.

**The shell.** One navigation model (`src/lib/depot/shellModel.ts`) feeds two forms: from
1280 px wide a left rail with the depot's pages first (in depot scope) and then the network
groups; below 1280 px a top bar and one horizontal strip of the current scope's pages, with
Operations, Sign out and (in depot scope) the network pages behind the bar's menu. The
shell's geometry (breakpoints, rail, gutters, content width) is defined once in
`src/lib/depot/shell/geometry.ts`, and every table frame is computed from it. The shared page
pieces (page header, provenance line, figure bands, tables, notices, the stale notice, the
footer) are documented in
[`DEPOT_UI_PATTERNS.md`](DEPOT_UI_PATTERNS.md#shell-navigation-and-the-footer).

## 3. Provenance

Four words, defined in `src/lib/depot/labels.ts`:

| Word | Meaning |
| --- | --- |
| `LIVE` | Read from the feed as sent |
| `DERIVED` | Computed from live data on the server |
| `MODELLED` | Generated from planning assumptions, not measured |
| `REFERENCE` | Curated static data, not from the feed |

The word "simulated" is not used for depot data, on screen or in documents.

**Declared once per page.** Every depot page declares its default
provenance once, in a line under its header: one tag and one fixed-formula sentence, from
the pure `provenanceLine()` in `src/lib/depot/provenanceLine.ts`, rendered by
`ProvenanceLine`. Its descriptions are `modelled` (optionally naming what replaces it, with
a link to Data sources), `mixed` (naming what is live, what is derived and what is
modelled, in that order), `derived` (optionally stating the efficiency index window),
`live` and `reference`. A page that rests on the modelled operating day adds the day's
sentence (`src/lib/depot/modelledDayLine.ts`). The stale, sample-data, unavailable and
waiting wordings come from the same function, so a page on the saved sample says "sample
data" in this line.

**"Live" only for live data.** A page on the saved sample or on last-good data never calls
its figures live: where a sentence, caption, legend or label names the data's source, it
takes the words the feed chip uses for that source (`src/lib/depot/feedChip.ts`), or it is
worded so that it is true in all three states (live, last-good, sample).

Only what differs from the page default carries its own tag, with one guard: a
section or column where a generated figure or status sits beside a real, named bus, depot
or route carries one tag (on the section label when the whole section is generated,
otherwise on the column header), on every page, including all-modelled ones. A generated
band of figures on a mixed or derived page carries one tag for the band. Each page's line is
pinned by a test that renders the page's real component in its states (for example
`depot-routes-page-provenance.test.tsx`, `depot-maintenance-provenance.test.tsx`,
`depot-fuel-revenue-provenance.test.tsx`). See
[`DEPOT_UI_PATTERNS.md`](DEPOT_UI_PATTERNS.md#provenance-line).

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
exceptions, the requirement's held on-road shares — once per snapshot rows array
                        │
                        ▼
views (src/lib/depot/live/*View.ts) ──► route handlers (src/app/api/upsrtc/depot/**)
```

- **One upstream fetch, two projections.** The map route and the depot module read the
  same `LiveSnapshot`, so a depot count and a map pin always describe one payload.
- **Snapshot chain** (`src/lib/upsrtc/liveSnapshot.ts`). Live upstream, then the fresh cache
  (`LIVE_CACHE_TTL_MS = 15_000`), then last-known-good, then the saved sample (section 4.1).
  `NEXT_PUBLIC_DEMO_MODE=1` forces the saved sample. A fetch's age, the cache TTL and the
  feed clock's ceiling are timed from when the answer arrived, not from when it was asked.
  - **Back-off.** After a failed refresh no new upstream call is made for
    `LIVE_RETRY_BACKOFF_MS = 20_000` (20 s): every request in that span is answered at once
    with what the failure fell back to (last-good, else the sample). A success clears it.
  - **Young data served while refreshing.** The depot path (the fleet repository) asks for
    last-good data up to `LAST_GOOD_FRESH_MS = 90_000` (90 s) old: when the cache has expired
    but last-good is that young, it is answered at once (`source: 'cache'`) and one refresh
    runs in the background (single-flight; a failed background refresh is logged). Depot
    pages therefore usually show data about one poll old, under its own feed time. The
    command centre's routes do not ask for this and wait for the refresh as before.
  - **Short replies.** A reply whose depot rows are fewer than
    `MIN_ROWS_SHARE_OF_LAST_GOOD = 0.5` of last-good's is treated as a failed refresh (it
    backs off and is logged like one), so a partial payload is never served as live. The
    `SHORT_REPLIES_BEFORE_ACCEPTED = 3`rd short reply in a row is accepted as the fleet's new
    size, so a fleet that really shrinks is not held at its old size for ever. A reply with
    no bus rows is always refused.
  - **Log lines.** Each change of what is served is logged once per process, never per
    request, as one `[depot:live-snapshot] …` line (`src/lib/serverLog.ts`, which cuts a line at
    `MAX_LOG_MESSAGE_CHARS = 300`): "serving last good data instead
    of live data: <reason>" (or "the saved sample"), and on recovery the notice "upstream
    recovered; serving live data again instead of …". An address in the reason is replaced
    by "(address withheld)".
- **The depot projection's rows** (`src/lib/upsrtc/depotNormalizer.ts`). Registrations are
  upper-cased; a text field longer than `MAX_ROW_TEXT_CHARS = 128` becomes empty, and a row
  whose registration is longer is refused. A registration that appears more than once gives
  one row, chosen by the map's own rule so the map and the depot pages pick the same row: a
  row with a position fix beats one without; among equals only a strictly newer report time
  replaces the row kept; the first wins a tie.
- **When the depot pages call the feed stale.** The shared snapshot flags every answer served
  after a failed refresh, or from last-good while refreshing, as stale. The depot pages do
  not: the fleet repository (`src/lib/depot/repositories/liveFleetRepository.ts`) reports
  last-good data as stale only when it is older than `LAST_GOOD_FRESH_MS` (90 s) by its
  fetch time, or when its age cannot be known; the saved sample is always stale.
- **The feed chip** (`src/lib/depot/feedChip.ts`) reads `LIVE`, `STALE`, `FEED QUIET`,
  `CHECK CLOCK` or `FIXTURE`, never which cache layer answered. `FEED QUIET · HH:MM` means the
  feed's newest report is more than `FEED_QUIET_AFTER_MIN = 10` minutes older than the last
  fetch (a frozen upstream). A page whose own request has failed after a success reads
  `STALE` at its figures' feed time. Order: stale or sample, a page request failing, quiet,
  check clock, live. `CHECK CLOCK` means the feed is live but at
  least `FEED_CLOCK_AHEAD_WARN_SHARE = 0.01` of the response's rows, and at least
  `FEED_CLOCK_AHEAD_WARN_MIN_ROWS = 20`, were stamped ahead of the feed clock's ceiling, so
  the feed clock may lag. A page shows its stale notice only once the data is older than
  `STALE_NOTICE_AFTER_MS` (5 minutes, same file) by the browser clock; before that the chip
  and the provenance line carry it alone.
- **The feed clock.** `feedNow` is the newest receive time that is not later
  than the snapshot's own fetch time read in Indian time plus `FEED_CLOCK_MAX_LEAD_MIN = 5`
  minutes (`deriveFeedClock` in `src/lib/upsrtc/depotNormalizer.ts`). Rows stamped beyond
  that are ignored for the clock, counted, and sent as `feedClockAheadRows` (only when above
  zero). It does not depend on how many buses report, so a night feed with few buses still
  advances; the saved sample's clock has no upper limit. Every age (minutes since a fix,
  darkness, outshedding, the score window, yard holds, the operating date) is measured
  against `feedNow`, never against the server's wall clock, so a stale or sample snapshot
  stays internally consistent. The wall clock is used for the envelope's `fetchedAt`, cache
  TTLs, the stale limits above and rate-limit windows.
- **Server-side aggregation.** The browser never receives the fleet's ~9.6k rows for a
  network page; it receives summaries. Per-bus rows are sent only for one depot.

### 4.1 The saved full-fleet sample

When the live feed and last-good data are both unavailable, or `NEXT_PUBLIC_DEMO_MODE=1`, the
app serves a saved sample of the whole fleet: `src/fixtures/upsrtc-fleet-sample.json.gz`,
gzip-compressed JSON. It is read lazily on the first fallback and memoised for
the life of the process (`src/lib/upsrtc/fleetFixture.ts`); if it is missing or unreadable,
the small `src/fixtures/upsrtc-live-sample.json` is used instead. The response's `source` is
`fixture`, the chip reads `FIXTURE`, and every page's provenance line says "sample data" with
the sample's own feed time. The score window, the yard memory and the held peak on-road
shares are neither read nor written for it.

It is built by `npm run build:depot-fixture` (`scripts/build-depot-fixture.ts`): one request
to the live feed, no retry, keeping only the raw keys the normalisers read
(`FLEET_FIXTURE_KEYS` in `src/lib/upsrtc/fleetFixtureShape.ts`). It holds no personal data:
`src/tests/unit/fleet-fixture-shape.test.ts` fails if a key that suggests a person is ever
allowlisted, and `src/tests/unit/fleet-fixture-file.test.ts` reads the saved file and fails
on any key outside the allowlist, any key suggesting a person, or any value that looks like a
phone number.

### Server house rules (every depot view)

1. Session check first: `requireUpsrtcAccess()`, else 401 (`unauthorizedResponse`).
2. Ids are validated before any lookup, cache key or response: `isValidDepotId` and
   `isValidRouteName` (`src/lib/depot/ids.ts`), and strict query parsers that refuse
   unknown or repeated parameters.
3. Fixed error bodies; the underlying error is logged server-side through `logDepotError`
   (`src/lib/serverLog.ts`, one bounded line) and never returned.
4. `Cache-Control: no-store` on every response (`jsonResponse` in `src/lib/upsrtc/respond.ts`),
   with opportunistic gzip.
5. Bodies are memoised per snapshot (`memoiseBody` in `live/analysis.ts`, keyed weakly on
   the analysis, which is keyed on the identity of the rows array); bodies that depend on
   query parameters (history, trends, forecast) are held per query in a map bounded to
   `MAX_QUERY_BODIES_PER_SNAPSHOT = 64` per snapshot, oldest out (`live/queryMemo.ts`), and
   an unknown depot's 404 is never held. The feed envelope
   (`feedNow`, `fetchedAt`, `source`, `stale`) is built per request by `feedEnvelope`, so
   the same rows can be reported fresh on one request and stale on the next.
6. No view calls the upstream. The only depot route that can is the route-profile route,
   and only on a cache miss (section 7.9). It reads the feed through the fleet repository,
   like every other depot route.
7. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30` (45 for the copilot).

### API routes

All under `src/app/api/upsrtc/depot/`, all `GET` except the copilot. Unless stated, errors
are `401` (no session), `400 {"error":"Invalid depot id"}` or `400 {"error":"Invalid query"}`,
`404 {"error":"Depot not found"}`, `503 {"error":"Depot data unavailable"}`. Every response
except the copilot's carries the feed envelope (`DepotFeedEnvelope`: `feedNow`, `fetchedAt`,
`source`, `stale`, and `feedClockAheadRows` only when above zero), built for that request.
A `depotId` filter on `exceptions`, `routes`, `allocation` or `history` that is well formed but
not in the feed answers the fixed `404 {"error":"Depot not found"}`. Payload types are in
`src/lib/depot/api.ts` and the domain `api.ts` files.

| Route | Returns | Query and validation |
| --- | --- | --- |
| `network` | Unit summaries, network KPIs, field coverage, scores, exception counts by kind and severity, `scoreWindow` | none |
| `exceptions` | Depot exceptions, counts, bus severity counts, one page of bus exceptions | `kind` (one of the four bus kinds), `depotId`, `offset`, `limit` ≤ 100 (`BUS_PAGE_MAX_LIMIT`); strict |
| `distribution` | Supply and modelled requirement per depot, the transfer plan | none |
| `routes` | One page of routes in the feed with derived columns | paging, sort `dir`, filters; `limit` default 25, max 100 (`src/lib/depot/routes/routeQuery.ts`); strict |
| `allocation` | The route-to-depot plan over cached profiles, filtered and paged per request; `plannedAt` is the feed time of the snapshot the held plan was made on (null when that snapshot had no feed clock) | parsed by `parseAllocationQuery` (routeQuery.ts); strict |
| `route/[routeName]` | One route profile (stops, terminals, length; `unlocatedStops` counts stops with no usable position and `mislocatedStops` those whose position does not fit the timetable, both with `lat`/`lng` null, section 7.9) with the feed envelope of the snapshot it read; `fetchedAt` is that snapshot's fetch time | `isValidRouteName` → `400 {"error":"Invalid route name"}`; calls to the schedule server rate-limited, one slot per call → `429 {"error":"Too many requests","retryAfterSeconds":n}` with `Retry-After`; `503 {"error":"Route data unavailable"}`, also after `ROUTE_LOOKUP_DEADLINE_MS = 25_000` |
| `schedule-day/[registration]` | One bus's whole day from the schedule server (`ScheduleDayResponse`, `service/scheduleDayApi.ts`), asked for by the route day's timetable loader: `?route=` names the route the bus was seen on. The feed's operating date is asked first, then the fallback dates; a real answer is recorded in the scheduled-trip store for the operating date (`answeredDate` is the date that answered: another is a borrowed day) and answered as `{status:"ok",trips,tripsOnRoute,…}` with the feed envelope; "not assigned" on every date is `{status:"unavailable",reason:"no_schedule"}`, a failure or the sample stand-in `reason:"upstream_error"`, and neither records anything | the same limits as `route/[routeName]`, one slot per call to the schedule server, taken before each call → `429 {"error":"Too many requests","retryAfterSeconds":n}` with `Retry-After`; strict: `isValidRegistrationNumber` (at most 16 characters) and exactly one valid `route`, else `400 {"error":"Invalid request"}`; a bus this server has not seen on the route (in the snapshot or earlier that date) → `404 {"error":"Bus not seen on this route"}` with no call made; `503 {"error":"Schedule data unavailable"}` on failure and after `ROUTE_LOOKUP_DEADLINE_MS`; the only route besides `route/[routeName]` that the API guard lets reach the schedule server (`service/scheduleDayLookup.ts`) |
| `service/route/[routeName]` | One route's day hour by hour (`RouteHourlyResponse`, `service/types.ts`): 24 hours of deployed, scheduled, modelled demand, needed and gap; the need inputs; what this server observed; scheduled and route-name coverage; proposals; punctuality by hour (`reliability`); the buses seen on the route (`busesOnRoute`), those with a recorded day (`busesWithDay`) and any borrowed timetable date (`timetableBorrowedFrom`) | `isValidRouteName` → `400 {"error":"Invalid route name"}`; strict query: only `date`, which must be the feed's operating date (`YYYY-MM-DD`), else `400 {"error":"Invalid query"}`; a route the snapshot does not carry → `404 {"error":"Route not found"}`; no upstream call (`live/routeHourlyView.ts`) |
| `economics` | The modelled economics index, network and per depot | none |
| `history` | A daily series for one metric, with the feed envelope; `available` points carry `ceiling` (the fleet) | `metric` (onRoadShare, offRoadRate, darkRate, index, available), `scope` network or depot, `depotId` when scope is depot, `days` 7–180 default 30 (`live/historyView.ts`); `404` "No value for this metric" / "No index for this depot" |
| `trends` | History with trend words for many units | strict parser in `live/trendsView.ts`, `days` 7–90 default 30 |
| `forecast` | Trend and forecast for one series | the history query, with `days` defaulting to 90 here (`FORECAST_DEFAULT_DAYS`), plus at most one `horizon`, 7–28, default 14 (`live/forecastView.ts`) |
| `[depotId]` | One depot's detail: summary, buses, yard, outshedding, exceptions | depot id |
| `[depotId]/parking` | The yard's modelled lanes and the night parking order | depot id |
| `[depotId]/duties` | The duty board: duties, proposed bus matches, exclusions | depot id |
| `[depotId]/maintenance` | Off-road list, modelled service schedule, workshop load | depot id |
| `[depotId]/crew` | Anonymous slots, shifts, coverage, uncovered shifts with reasons | depot id |
| `[depotId]/fuel` | Fuel per bus, route and class; flagged buses | depot id |
| `[depotId]/revenue` | Trips, boardings and revenue per route | depot id |
| `copilot` (POST) | A briefing, rationale or answer; `dataSource` (`last_good` or `sample`) when not on the live feed | origin, body, limits and deadline enforced in `src/lib/depot/copilot/service/`; see [`DEPOT_COPILOT_OPERATIONS.md`](DEPOT_COPILOT_OPERATIONS.md) |

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

The hour-by-hour stores sit beside these, behind their own entry point,
`getServiceRepositories()` (`ServiceRepositories` in `repositories/types.ts`), so the depot
repositories did not change:

| Repository | Adapter today | Interface |
| --- | --- | --- |
| `hourly` | `memoryHourlyObservationRepository` — reads the per-process hour store (`live/serviceHold.ts`) | `routeHours`, `depotHours`, `observedSummary`, `distinctBusesOnRoute`, `busesOnRoute`, `journeysOnRoute`; all async |
| `scheduled` | `memoryScheduledTripRepository` — the trips of the bus days looked up, per process | `recordBusDay`, `tripsForRoute`, `knownBusesOnRoute`, `recordedBuses`, `revision` (a count of days recorded, in the route day's memo key so a load shows on the next poll); all async |

A bus's day is recorded two ways, both only from the schedule server's own answer (never
the sample stand-in): a successful route-details lookup records the whole day of the bus it
was read through (every trip, other routes included, at no further call; `getRouteProfile`'s
`record`), and the schedule-day route records the day of each bus the timetable loader asks
for. The command centre's schedule route records nothing.

A database written by a 5-minute sampler replaces the first, and a timetable store the
second, behind the same interfaces.

To replace a model with a real feed or a database: write a new adapter implementing the
same interface (returning the same payload shape, with real values), wire it in
`repositories/index.ts`, and change the page's provenance declaration and the
Data sources registry entry (`src/lib/depot/sources/registry.ts`) from `modelled` to
`live`. Nothing else imports the adapter. The history adapter is the one a database
replaces: a daily store of per-depot snapshots behind `series()`.

Models called directly by views, with no repository between: the requirement model, the depot master (`sim/depotMaster.ts`: parking capacity, bays, fuel
points), the yard lane layout, the fleet master (`sim/fleetMaster.ts`), the duty plan and
operating day, and the maintenance service model. Replacing them means adding a repository
first.

## 6. In-process state and its limits

| State | Where | Bound |
| --- | --- | --- |
| Live snapshot cache, last-known-good, the back-off, the short-reply count and which source is served | `src/lib/upsrtc/liveSnapshot.ts` | 15 s TTL; one key; 20 s back-off |
| Rolling score window | `score/windowStore.ts` | 20 min of feed time, ≤ 120 samples per depot, ≤ 1,000 depots |
| Yard memory | `infer/yardMemory.ts` | 12 h hold, ≤ 1,000 depots |
| Held peak on-road shares (the requirement's basis) | `live/peakShareHold.ts` | one number per depot for one operating date, ≤ 1,000 depots |
| Held peak requirements (the floor of each depot's peak) | `live/peakRequirementHold.ts` | one number per depot for one operating date, ≤ 1,000 depots |
| The modelled day and duty plan | `live/operatingDayView.ts` | one slot per analysis, held per snapshot |
| Memoised analyses and view bodies | `live/analysis.ts`, `live/queryMemo.ts` | held weakly per snapshot; ≤ 64 query bodies per snapshot |
| The hour store: one route sample and one depot sample per 5-minute slot of feed time, and the feed's journeys, for one operating date | `live/serviceHold.ts`, `live/serviceHoldReads.ts` | 288 slots, ≤ 1,000 routes and ≤ 1,000 depots a slot, ≤ 20,000 journeys, ≤ 500 buses counted per route; the previous date drops when the feed date changes; the saved sample never writes |
| The looked-up bus days (scheduled trips) | `repositories/memoryScheduledTripRepository.ts` | ≤ 2,000 buses per date, ≤ 3 dates |
| Route-profile cache | `routes/routeCatalogue.ts` | ≤ 2,000 routes, keyed on route and the feed's operating date; negative answers 10 min; failures not cached |
| Schedule cache behind the lookups | `src/lib/upsrtc/scheduleService.ts` | 2 min TTL, ≤ 500 lookups |
| Allocation plan | `live/allocationView.ts` | held for 5 minutes of feed time |
| Route-lookup limiters | `route/[routeName]/route.ts`, `rateLimit.ts` | calls per minute |
| Copilot runtime: response cache, in-flight sharing, allowances, limiters, CLI semaphore and breaker | `copilot/service/` | see the copilot document |

Consequences: a restart or cold start empties all of it. The score window then starts
with one sample and screens say "from one snapshot at HH:MM", then "over the last N
minutes" with N the minutes the samples actually span, until the window is full; yards are decided again from single snapshots, and the
cockpit says "This server has decided this depot's yard on N snapshots so far"; the held
peak shares and held peak requirements start again from the next snapshot, so the first
snapshots after a restart can set them and a server restarted in the evening models a smaller
day than one that saw the morning peak; the allocation plan is made afresh; the route
catalogue is empty until users load details again; the copilot's limits and budget reset;
the hour store starts empty, so the route day shows every hour before the restart as not
observed and draws it from the modelled day.
With several instances, each holds its own copy: two requests can be scored over different
windows, see different held yards, different held peak shares and peak requirements (so a different modelled day
and transfer plan until each instance has seen the peak), allocation plans made at
different feed times, and different cached routes, and every limit and the
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
`on_road`. "Scheduled for the feed date" also accepts a trip whose scheduled start and end
span the feed time (an overnight trip). A bus quiet for more than the reporting window but
not yet dark gets
"Not heard for N min" (`notHeardMinutes`) rather than a new state. `LONG_DARK_AFTER_MIN =
4320` marks the long-dark exception. A fix stamped more than `REPORTING_WINDOW_MIN` ahead of
the feed clock has an unknown age, so it never makes a bus recently heard or in service; up
to that lead it counts as age 0.

Location (`infer/location.ts`): `in_yard`, `at_other_yard`, `away` or `unknown`, testing the
bus's own yard first. "In the yard" means every bus of the depot inside the yard circle,
whatever its state; a figure of the standing subset says "standing in the yard".

**One state vocabulary.** Every page and the network figures use these
classified states, worded On road, Standing, Dark and Off road, never the feed's own status
field: the network KPIs (`onRoad`, `stationary`, `noSignal`, `underMaintenance`) are sums of
the classified states, so they partition the fleet and a network total is the sum of what
each depot's cockpit and roster show (`networkKpis` in `live/aggregate.ts`).

### 7.2 Depot kind and peer groups — `live/depotKind.ts`, `score/peerGroups.ts`

Kind is read from the name: empty → `unassigned`; starting `ENFORCEMENT` → `enforcement`;
whole word `HIRED` → `hired`; whole word `ELECTRIC` → `electric`; otherwise `depot`. Only
`depot` units with at least `MIN_FLEET_FOR_RANK = 10` buses are rankable. Rankable depots
are split into fleet-size terciles; if any tercile would hold fewer than
`MIN_PEER_GROUP = 5`, everyone goes into one group. The economics index draws its groups the
same way over the depots it can score (section 7.13).

### 7.3 Depot Efficiency Index and its rolling window — `score/`

Five components (`score/config.ts`): on-road share 0.35, off-road rate 0.20, dark rate 0.20,
schedule coverage 0.15, device integrity 0.10. Each is a robust z against the peer group
(`stats/robust.ts`: (value − median) / (1.4826 × MAD); when the MAD is 0, the mean absolute
deviation around the median × 1.2533 is used), clamped to `Z_CLAMP = 3`, signed so
higher is better, weighted, and scaled to 0–100 as `50 + (weighted / 3) × 50` (`score/dei.ts`),
held at the one decimal it is shown at. Depots with equal indexes share a rank: the rank is 1
plus the number of depots in the group with a higher index (1, 2, 2, 4;
`score/competitionRanks.ts`, used by the economics index too).

**Rolling window.** Components are ratios of each depot's
counts summed over the snapshots of the last `SCORE_WINDOW_MIN = 20` minutes of feed time,
at most `SCORE_WINDOW_MAX_SAMPLES = 120` per depot (`score/window.ts`) and at most
`SCORE_WINDOW_MAX_DEPOTS = 1000` depots (`score/windowStore.ts`), one sample per distinct
feed time. What each arrival does (`score/windowStore.ts`, `score/epoch.ts`):

- a newer feed time adds a sample per depot and prunes the window at that time;
- a feed time already held (a re-fetch with new rows) replaces that sample;
- an older feed time still inside the window is inserted in order and scored on the window
  up to its own feed time;
- a sample more than one window behind the newest (a straggler: an upstream cache stuck in
  the past, or a clock that really went back) is scored on its own counts and never touches
  the window. A new epoch (window and yard memory emptied, the straggler accepted) starts
  only after `NEW_EPOCH_AFTER_BEHIND = 3` stragglers in a row, each later than the one
  before and within one window of it, spanning at least `EPOCH_RUN_MIN_SPAN_MS` (3 minutes)
  of feed time with no current sample between. A cache repeating one old snapshot never
  spans anything, so it never starts an epoch; a clock that stepped back and keeps
  advancing does;
- the saved sample, or a snapshot with no feed time, is scored on its own counts; the
  window is neither read nor written.

The `network`, `exceptions` and `[depotId]` responses carry `scoreWindow`: the window's
length, `since`, `samples`, and `coveredMin` (the whole minutes of feed time the samples
actually span); each depot's score carries its own `samples`. Pages word the window only
through `score/windowWords.ts`: "over the last N minutes" (from `coveredMin`, so
shorter than 20 while the window fills), "from one snapshot at HH:MM" for a single sample,
or "since HH:MM, N snapshots" when the span cannot be read in whole minutes (see
[`DEPOT_UI_PATTERNS.md`](DEPOT_UI_PATTERNS.md#index-window-words)). Peer-group membership
follows present fleet size. The window is process memory (section 6).

### 7.4 Exceptions — `exceptions/`

Depot exceptions compare a depot with its peers (`dark_share_high`, `off_road_high`,
`on_road_low`) at `EXCEPTION_Z = 2`, critical at `CRITICAL_Z = 3`, and need a rate gap of at
least `MIN_RATE_GAP = 0.1`; these use the rolling window. `power_cut_cluster` needs at least
`POWER_CUT_CLUSTER_MIN = 3` buses and `POWER_CUT_CLUSTER_SHARE = 0.1` of the fleet. Bus
exceptions: `long_dark`, `power_cut`, `tamper_code` (any code other than
`NORMAL_TAMPER_CODE = 'C'`; the meaning of other codes is not asserted), `emergency`, capped at
`BUS_EXCEPTION_CAP = 500` with counts taken before the cap (`exceptions/config.ts`).

Each exception carries its `basis` (`EXCEPTION_BASIS` in `exceptions/config.ts`): the three
peer comparisons are `window` (compared over the rolling window), and `power_cut_cluster` and
every bus exception are `feed_time` (as of the feed time). The exceptions page labels each
one accordingly ("Last 20 min", or "As of HH:MM"; `exceptions/basisWords.ts`). The page and
the API can be scoped to one depot (`?depot=<id>` on the page; the response then carries
`depotScope`).

### 7.5 Yard inference — `infer/yard.ts`, `infer/yardClusters.ts`

There is no depot master, so a yard is learned from where a depot's standing buses park.
Parked buses are linked by distance (density clustering): a bus is a core point
when at least `YARD_CORE_MIN_NEIGHBOURS = 4` parked buses, itself included, stand within
`YARD_LINK_M = 150` m; core points within the link distance form one group, and any other
bus within reach of a core point joins that group as a border member without extending it.

**Adjacent groups are one place (`infer/yardPlace.ts`).** Starting from the
largest group, any group whose nearest bus stands within `YARD_ADJACENT_M` (twice the link
distance, 300 m) of a bus already in the place is taken in, unless that would make the place
wider than the maximum span, and the search repeats after each one taken. This happens
before the size, share, dominance and span tests. It keeps a compound with two parking areas
a little more than the link distance apart from flipping between one yard and none.

The rule, as screens state it, is the sentence `YARD_RULE_SENTENCE` in
`src/lib/depot/infer/yardRuleText.ts`, built from the constants; that file is the source of
truth. With today's constants it reads:

> A yard is claimed only when at least 6 parked buses stand together, each within 150 m of
> the next, in one place that holds at least 25% of the depot's parked buses, 1.5 times as
> many as any other place, and is no more than 1.5 km across. Groups of buses standing within
> 300 m of each other count as one place.

(`YARD_MIN_CLUSTER = 6`, `YARD_MIN_SHARE = 0.25`, `YARD_DOMINANCE_RATIO = 1.5`,
`YARD_MAX_SPAN_M = 1500`, `YARD_ADJACENT_M = 2 * YARD_LINK_M`, all in `infer/yard.ts`.) The yard's radius is the largest member distance plus
`YARD_RADIUS_PAD_M = 40`, at least `YARD_MIN_RADIUS_M = 120`. Otherwise the depot has no yard
and screens say so. Screens describe an inferred yard as "Learned from where the depot's
buses park; not a surveyed location" (`live/depotView.ts`).

### 7.6 Yard continuity — `infer/yardContinuity.ts`, `infer/yardMemory.ts`

Once a yard is established in this process, a later snapshot that
would not place it (no yard, or one elsewhere) keeps it while at least `YARD_MIN_CLUSTER`
(6) of the depot's standing buses with a usable position, heard within the reporting
window, are inside its circle; dead devices left in the yard do not keep it. The held
circle stays exactly where and as large as it was, so buses at its edge cannot walk it
outward. A hold ends `YARD_HOLD_MAX_HOURS = 12` hours of feed time after it began, or as soon
as too few recently heard buses stand in it; the rule then decides afresh. When the rule
places a yard inside the remembered circle, that yard replaces the remembered one. A
re-fetch at the same feed time returns the remembered circle unchanged. The memory follows
the same straggler and epoch rule as the score window (section 7.3) and holds at most
`YARD_MEMORY_MAX_DEPOTS = 1000` depots; the saved sample neither reads nor writes it.

A held yard carries `Yard.heldSince`; the cockpit and the yard page say "Yard held since
HH:MM: this snapshot alone would not place it." (`cockpit/availability.ts`,
`yard/yardPageModel.ts`). The start-up count (`yardSnapshotsSeen` in `infer/yardMemory.ts`,
sent on the depot and duty-board responses) says how many snapshots this process has
decided the depot's yard on; it is not sent for the saved sample or the unassigned group.
Limits: a fresh process remembers nothing, so a yard that only continuity was keeping can be
missing for a while after a restart; and each instance keeps its own memory.

### 7.7 Outshedding — `infer/outshed.ts`

Per scheduled trip, ordered: ended; departed on actual time; upcoming (start
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

The on-road share it reads is each depot's HIGHEST share over the rolling score window
seen so far in the operating date, and the peer median it is compared with is the median of
those maxima. The windowed share is the `onRoad` component the efficiency index sums
(`windowedOnRoadShares` in `sim/requirement.ts`); the maxima are kept by
`live/peakShareHold.ts`, offered each snapshot once when it is first analysed, and carried
on the analysis as `requirementShares`, which the modelled day (`live/operatingDayView.ts`)
and the fleet distribution (`live/distributionView.ts`) both read. "Peak requirement" is
therefore the depot's busiest window so far today: the modelled day and the transfer plan
can still rise until the morning peak has passed and then hold; they do not shrink in the
evening as buses come home.

**The peak requirement does not fall during the day unless fewer buses are available than it
needs.** Holding the shares was not enough: the computed peak, round(available × utilisation),
still moved by one in both directions between snapshots a minute apart, because the feed's
list for a depot can gain or lose a row (so available moves by one; on the saved full-fleet
sample one row moves the peak of 34 of the 40 largest depots) and a peer whose share rises
lifts the peer median and lowers every other depot's utilisation (15 peers rising lowered the
peaks of 76 other depots). So each snapshot's computed peak is floored by the highest
peak computed for that depot earlier in the operating date, and that floor is capped at what
is available now (fleet − off-road), so a real, large loss of buses still shows. The floors
are kept by `live/peakRequirementHold.ts` (the same daily-maximum rule as the shares,
`live/dailyMaxima.ts`), offered each snapshot once when it is first analysed; the floored
balances (spare target, required and balance = available − required, recomputed from the
floored peak with available live) are carried on the analysis as `requirement`, and the
modelled day and the fleet distribution both read them (`requirementBalances` in
`live/heldRequirement.ts`). `modelBalances` stays pure and takes the floors as an optional
map. The day's duty total is the peak exactly (section 7.10), so it holds with it; only the
split of those duties across the routes seen and the buses matched to them follow each
snapshot. The parking order's later-day plan is for another date and reads no floor.

A later operating date (the feed's, `operatingDateOf`) starts afresh; a
snapshot of an earlier date, one with no date and the saved sample read their own windowed
shares and leave the maxima (and the held peaks) as they were. A depot
with no held value reads its single-snapshot share, then the peer median. On a cold server
with one sample it equals the single-snapshot requirement, so the first snapshots after a
restart can set the day's maxima; the maxima are per server (section 6). Fleet and off-road counts are still read from each snapshot, so available
buses, and the day with them, still follow a bus that really goes off the road.

Transfers (`optimise/rebalance.ts`, `optimise/minCostFlow.ts`): min-cost max-flow by
successive shortest paths from surplus to deficit depots, distance = straight line × detour
factor 1.3, held to 100 m (`COST_GRID_M`) so the plan's bus-km add up, up to a maximum transfer distance (default 250 km, bounded 25–600). Only
`kind === 'depot'` units give or receive; excluded depots stay in the totals and
their deficit is reported as uncovered with reason `excluded`; locked depots may receive but
not give. Uncovered reasons in order: `excluded`, `no_position`, `no_surplus_in_range`,
`insufficient_surplus`. The what-if sandbox (`optimise/scenario.ts`) re-runs the plan with a
demand surge (−50% to +100%), fleet adjustments (≤ 500 per depot), spare ratio and distance.
Depot positions are the inferred yards.

### 7.9 Route profiles and route-to-depot allocation — `routes/`, `optimise/allocate*.ts`

A route profile (ordered stops, terminals, one-way length) is read through one bus running
that route, from the schedule API, once per route per operating day, and cached keyed on the
route and the feed's operating date (`routes/routeCatalogue.ts`: `ROUTE_CACHE_MAX = 2000`,
negative answers such as "no schedule" for `ROUTE_NEGATIVE_TTL_MS = 600_000`). A schedule with
no stops is a "no schedule" answer. A failed lookup is never cached, so Retry asks the server
again. Stops at 0,0 stay in the list but do not count toward
length. There is **no background crawl**.

**Positions that do not fit the timetable** (`routes/timetableFit.ts`). The corporation's
stop list places some stops at a same-named place elsewhere in the state: route
VND_1613_ORD_OUT (Vindhyanagar to Varanasi Cantt, 37 stops) has four 130 to 270 km off its
line, each reached and left within minutes, and its straight-line sum through them was
1,697.5 km for a route of about 200. Among the located stops, in sequence order, the
profile keeps the largest chain in which every consecutive pair is reachable at
`MAX_PLAUSIBLE_SPEED_KMH = 110` straight-line over their scheduled minutes (the top legal
speed for a bus, 100 km/h on an expressway, plus a tenth for minute rounding and a stop
placed at its town's centre), never less than `UNTIMED_LEG_ALLOWANCE_KM = 40`. A pair in
the same scheduled minute, or with a missing or unreadable time, is judged by that
allowance alone; a leg whose time runs backwards is taken past midnight. Each stop is
judged on its departure time, else its arrival. Ties between chains of the same size go
to the shorter straight-line length, then to the earliest stops. With fewer than two
usable times the timetable judges nothing and every located stop is kept; with no
fitting pair among two or more located stops, none is kept. A stop outside the chain is
**mislocated**: it stays in the list with its name and time, but its position is
dropped (`lat`, `lng` null), so it is never in the length, never a terminal and never
the nearest stop, and the profile counts it in `mislocatedStops` (apart from
`unlocatedStops`). The length is the straight-line sum along the chain, and dead
kilometres are measured from the chain's first and last stops; with fewer than two kept
stops the route has no length and is excluded from the plan as `too_few_located_stops`.
VND_1613_ORD_OUT now measures 195.6 km between VINDHYANAGAR and VARANASI CANT, with
NIGAHEE, TENDUPUl, LOHRA and RAMNAGAR VARANASI left out. The next stop by position on a
bus's timetable (`routes/nextStop.ts`) reads the same kept stops. The route drawer says
both counts ("4 stops have a position that does not fit the timetable and are left out
of distances."). A profile is fetched one route at a
time, only on a person's action: when that route is opened on the Routes page, when a
depot's roster or a bus on the route is opened, or when a person presses "Load route
details" for one depot on the Routes page's plan panel (`PROFILES_GROW_WITH_USE` in
`routes/allocationWording.ts`), so coverage grows with use.

The loader (`routes/profileLoader.ts`) never starts by itself, runs one lookup at a time in
order, never in parallel, can be cancelled, waits out a 429's `Retry-After` and retries the
same route (at most `MAX_PAUSES_PER_ROUTE = 3` pauses), and loads at most
`PROFILE_LOAD_CAP = 40` routes a press. The depot select lists each depot with its number of
routes in the feed (the `routes` count on each depot option of the routes response) and
preselects the depot most worth a press (`routes/loaderRow.ts`). Until details are loaded the
plan is empty and says so ("No route can be planned yet: no route's details have been
loaded."). Cache misses are limited (`ROUTE_PROFILE_FETCH_LIMITS` in `rateLimit.ts`) in calls to
the schedule server: 20 per identity, 40 per trusted address and 120 per process, per minute.
One lookup can make up to `SCHEDULE_MAX_UPSTREAM_CALLS = 4` calls (the bus's date, then three
fallback dates counted back from the feed's operating date), and each call takes one slot
from every limit immediately before it is made, as the condition of making it: a lookup
whose first date answers costs one slot, and a cache hit costs nothing. If no slot is free
before a call, the lookup stops there and the route answers its fixed 429 with
`Retry-After`; nothing is cached. The route waits at most `ROUTE_LOOKUP_DEADLINE_MS =
25_000` for the snapshot and the lookup, then answers its fixed 503; a lookup still running
then is cached only if it ends in an answer. Every limit is per instance. The limits live in
`routes/upstreamPermit.ts` and are shared with the schedule-day route: one allowance per
person whichever of the two spends it.

The allocation (`optimise/allocate.ts`) recommends which depot should run each route to cut
dead kilometres (inferred yard to the route's real first and last stop) within capacity. It
starts from the current allocation; in a first phase routes, taken in regret order, move to
their best depot that still has room, and a local search then tries swaps. A shift or swap is
applied only when it saves at least `MIN_SAVING_KM_PER_DAY = 5` in total (a swap as a whole), up to
`MAX_MOVES = 200` (`optimise/allocateConfig.ts`). Trips per day are modelled
(`sim/tripFrequency.ts`). Only routes whose profiles are already cached are planned; the
plan is held for `PLAN_HOLD_FEED_MS` (5 minutes) of feed time across snapshots
(`live/allocationView.ts`), and the response's `plannedAt` gives the feed time it was made
at. It is made again after that span, when the feed clock steps back, on a new operating
date, or when the route catalogue changes; a catalogue change still waits for
`REPLAN_MIN_INTERVAL_MS = 30_000` since the last plan, so newly loaded profiles appear in it
within half a minute. The depot filter, list filters, paging and counts are applied per
request on the current snapshot. Unchanged routes carry one reason.

### 7.10 Duties and the one bus-to-duty matcher — `sim/duties.ts`, `sim/dayPlan.ts`, `optimise/assignDuties.ts`

**One plan.** `planDay` (`sim/dayPlan.ts`) is the one place a depot's modelled
duties are generated and its buses matched to them, held once per snapshot, depot and
operating date (`live/operatingDayView.ts`). The duty board, the crew roster, the night
parking order and the modelled day (fuel, revenue, economics) all read this plan, so they
cannot disagree. A repeated registration is one bus (section 4).

The modelled duty plan has exactly one duty per bus the depot needs at peak (section 7.8),
dealt round-robin over the depot's routes in name order, so when the requirement is smaller
than the route count the last routes get none and are listed. The feed carries no scheduled
durations, so every duty length is a seeded 4–10 h; starts cluster on a morning peak
(`sim/duties.ts`).

**The matcher** (`assignDuties`, an exact minimum-cost matching by the Hungarian algorithm in
`optimise/hungarian.ts`). Eligibility, each exclusion with one reason: off the road and dark
never; when the feed has a clock, a bus not heard within the reporting window, moving or
standing; a standing bus away from an established yard. A bus in service or on the
road is eligible: it is out working. Every other pairing is allowed and costed in tiers, in
this order (each tier outweighs everything below it):

1. a bus on the road before a standing one, so the buses left over are standing ones;
2. a bus in service before one merely moving;
3. a bus reporting the duty's route live takes that route's duty;
4. a bus of the duty's service class;
5. time fit: a duty started by the feed time on a bus on the road, a duty still to start on a
   standing bus;
6. `ageYears × round(durationHours)`, so longer duties prefer younger buses; then a fixed
   order by registration.

Duties without a bus are `no_eligible_bus`; eligible buses without a duty are spare, and the
board says where the spare buses stand. Each assignment records how its bus stands now.

**Three plan modes** (`PlanMode`, sent as `planMode`):

- `as_of_feed_time`: the feed's own date once its first duty has started, with every tier.
- `before_first_duty`: the feed's own date before its first duty starts. The day has not
  begun, so there is no time fit (tiers 2 and 5 drop) and tier 1 becomes "the yard first":
  buses standing in the yard take the earliest duties, buses still out on late trips the
  ones after.
- `later_day`: a later date (the parking order's next day). Only the buses in the yard are
  taken, and tiers 1, 2 and 5 drop: how buses stand now says nothing about that day.

A feed with no clock, or a depot with no duties, plans `as_of_feed_time`. The day is
recomputed from each snapshot, but its duty count is the held peak requirement (section 7.8):
it can still rise until the morning peak has passed, and falls during the day only when fewer
buses are available than it needs; it does not shrink in the evening as buses come home, and
a row the feed drops or a peer's rising share no longer moves it;
it is worded "as of the feed time" and would become fixed only when a real timetable is
supplied.

### 7.11 Night parking order — `optimise/parkingOrder.ts`, `live/parkingView.ts`, `sim/yardLayout.ts`

The lane layout is modelled: lanes of 6–10 buses summing to the modelled parking capacity,
seeded by depot id. The buses to park are exactly the depot's own buses the feed places in
its yard. The date it plans: before the first duty of the feed's date it
plans that date, from the same shared plan as the duty board; from the first duty on, it
plans the next date with the `later_day` plan, which covers the yard buses only, so it says
which yard bus leaves first, never how many duties the depot can cover that day; the
response's `operatingDate` says which. The plan deals buses by ascending first departure,
layer by layer from the lane mouths, so the earliest departures sit at different mouths and
no bus is blocked by a later one; buses beyond capacity overflow latest-first. It is MODELLED
and a suggestion only.

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

Crew, fuel, revenue, economics and the duty count all derive from one
modelled day per depot and date, read off the one duty plan (section 7.10): its duties and
the bus the matcher put on each. A bus with a duty ran its route out and back; every other
bus did not run. A route's length is the real one when its profile is cached and the length
is between `MIN_REAL_LENGTH_KM = 2` and `MAX_REAL_LENGTH_KM = 2000` (DERIVED), else a
typical class length seeded by the route name (MODELLED, `sim/operatingDayConfig.ts`). A
newly cached profile changes lengths, never which bus runs which duty. Pages on the day state
it once in their provenance line through `modelledDaySentence` (`src/lib/depot/modelledDayLine.ts`).
It reads:

- **Crew** (`sim/crew.ts`, `crew/roster.ts`): shifts derived from duties (a duty longer than
  `MAX_DUTY_HOURS_PER_DAY = 10` is split); slots per shift 1.45 drivers and 1.4
  conductors plus `CREW_RESERVE_SLOTS = 2`; seeded leave 6%, training 3%, absent 4%; weekly
  limit `MAX_HOURS_PER_WEEK = 48`. Uncovered shifts carry a reason per role.
  Slots are anonymous.
- **Fuel** (`sim/fuelConfig.ts`, `fuel/`): km per litre 4.8 / 4.6 / 4.0 / 3.6 by class with a
  per-bus spread and daily noise; price `DEFAULT_PRICE_PER_LITRE = 92`. A bus is compared
  with its peers (other buses of its class on the route, `MIN_PEERS = 2`) and flagged at
  `FUEL_VARIANCE_FLAG_PCT = 15` only when the peer median is supported.
- **Revenue** (`sim/revenueConfig.ts`): load factor 0.62 / 0.55 / 0.45 / 0.40; fare per
  occupied seat-km ₹1.1 / 1.5 / 2.2 / 2.8; revenue per leg = seats × load factor × length ×
  fare per km, two legs per trip, priced on the seats offered per trip unrounded (the shown
  seats per trip is rounded).
- **Economics** (`revenue/economicsIndex.ts`): earnings per km 0.40, cost per km 0.35, load
  factor 0.25, robust z clamped at 3. Its peer groups are drawn over the depots with every
  component, by the efficiency index's rule (terciles, merged into one group when a tercile
  would hold fewer than `MIN_PEER_GROUP`); a depot missing a component is shown the group its
  fleet falls in. A depot below `MIN_FLEET_FOR_RANK` is `fleet_too_small`; a depot in a group
  still too small to rank is `peer_group_too_small`. Equal indexes share a rank.

### 7.14 History, trends and forecasting — `sim/history.ts`, `forecast/`

History is a **modelled** daily series: a mean-reverting walk with a weekly rhythm, built
backwards from today's live value so it cannot contradict the figure beside it, seeded per
date. Network rates are computed from summed counts, never a mean of depot rates. Available
buses never exceed the fleet: the history view passes the fleet as a ceiling, every point of
the series (and the forecast with both band edges) is clipped to it, and each point carries
it as `ceiling`.

Trend words compare a week and four weeks (`FOUR_WEEK_DAYS = 28`), and "steady"
is judged against the series' own variation (`STEADY_QUANTILE = 0.8`).

Forecasts (`forecast/config.ts`): seasonal-naive is the baseline; Holt-Winters replaces it
only when its backtest error over the displayed horizon beats it by `METHOD_MARGIN = 0.05`.
Backtest over `BACKTEST_DAYS = 28`; the band h days ahead is the `BAND_QUANTILE = 0.8`
quantile of that method's h-step errors, pooled when fewer than `MIN_BAND_SAMPLES = 10`. No forecast from fewer than `MIN_HISTORY_DAYS = 28` days; horizon default
`DEFAULT_HORIZON_DAYS = 14`, max 28. Because the history is modelled, so is every forecast.

### 7.15 One route's day hour by hour — `service/`, `sim/hourlyDemand.ts`, `live/routeHourlyView.ts`

For one route and the feed's operating date, every hour from 00:00 to 23:00 side by side:
buses deployed, buses scheduled, passengers modelled, buses needed, and the gap.
Recommendation only: nothing is dispatched or reassigned, and no person is named or scored.

**Data path.** Every new snapshot the analysis builds is offered to the hour store
(`offerServiceSnapshot` in `live/serviceHold.ts`). The newest snapshot in each 5-minute slot
of feed time (`SLOT_MINUTES = 5`, 288 slots a day) records, per route, the buses carrying
its name with their states, delays and operating depots, and per depot its standing buses
inside its yard and its buses on the road with no route name. The feed's own journeys
(journey id, route, scheduled start and end, actual start, delay) go into a journey ledger.
The feed clock is the only clock; the saved sample never writes. The view
(`buildRouteHourlyResponse` in `live/routeHourlyView.ts`, composed in
`live/routeHourlyBody.ts`) reads the route's row from the snapshot's route table, the store
through `getServiceRepositories()`, a modelled day of the route's own buses (below), and
the shared modelled operating day of each depot running the route (`operatingDayFor`, the
one the duty, crew, fuel and revenue pages read: the route length and the depot's idle
buses for a proposal's source), then runs the engine in `src/lib/depot/service/`. The body
is held per snapshot, route and route-catalogue revision (`queryMemo`); the feed envelope
is built per request.

**Three layers, each saying what it is.**

1. **Deployed** (DERIVED): the mean, over an hour's samples, of the route's buses in
   service or on the road, the buses running it (`observeHours.ts`); the same definition
   holds for the current hour and the modelled hours. Standing buses that carry the route
   name stay in the state mix only and are said once on the page ("N standing now carry
   this route's name"). An hour needs at least
   `MIN_SLOTS_FOR_AN_HOUR = 6` of its 12 samples to count as observed. The feed clock's own
   hour takes the snapshot's figure. Any other hour comes from a modelled day anchored to
   the route's own buses (`modelledRouteHours` in `modelledDeployment.ts`, MODELLED): each
   bus carrying the route name in the snapshot (the route row's `buses`, whatever their
   state) works one day on it (`drawRouteBusDay`): it starts as the duty roll starts a
   duty (`drawDutyStart` in `sim/duties.ts`: the morning triangle, or spread over the day)
   and works a seeded `ROUTE_BUS_DAY_MIN` = 6 to 10 hours, or a round trip (out and back) plus
   `LAYOVER_MIN` when that is longer (the journey known from the feed's schedule or the
   profile), at most `ROUTE_BUS_DAY_MAX_MIN` = 16 hours, clipped at 24:00
   (`sim/hourlyDemandConfig.ts`); seeded by route and date. An hour's figure is the minutes
   those days overlap it, over 60. A bus works a shift of trips, not one round trip, so a
   short route peaks near its fleet (about four fifths on average: a third of the starts
   spread through the day). The depot duty board keeps its own rule (out and back plus a
   layover, else 4 to 10 hours). So the observed and modelled hours are one route on
   one scale, and no hour runs more buses than the feed shows on the route. **This page's
   modelled day is drawn from the buses the feed shows on the route, while the depot pages'
   modelled day is drawn per depot** (the depot's peak requirement dealt round-robin over
   its routes), so the two can differ for the same route. The chart draws a modelled hour
   hatched ahead of now and as an empty outline before it ("not observed").
2. **Scheduled** (DERIVED, partial): bus-hours, the minutes each known trip overlaps the
   hour, over 60 (`journeyLedger.ts`, `scheduledSupply.ts`). Trips are the journeys the feed
   reports on its rows (about one bus in five carries one) and the trips of bus days looked
   up from the schedule service; a trip known both ways counts once. Coverage is the buses
   whose whole day is recorded, of the buses seen on the route that date (a journey the
   feed reports is one trip of a bus, never its day). With no trip known, every hour says
   no scheduled trip is known, rather than zero. When the server had no timetable for the
   date and answered with an earlier one, the page says "Timetable of 5 Oct 2026 used for
   6 Oct 2026."

   **Loading the full timetable** (`service/timetableLoader.ts`, `hooks/useTimetableLoader.ts`):
   a person presses "Load this route's full timetable" in the chart section; nothing loads
   by itself and nothing crawls. One lookup per bus seen on the route (`busesOnRoute`),
   skipping buses already recorded for the date and buses answered this visit, at most
   `TIMETABLE_LOAD_CAP = 20` buses a press, one at a time, in order, waiting out a 429's
   `Retry-After` and asking the same bus again (the route-details loader's own sequencing,
   `runProfileLoader`), cancellable. A press asks for up to 20 buses × up to 4 calls = up to
   80 calls to the schedule server, which at a person's 20 calls a minute is 1–4 minutes of
   that person's allowance (a bus whose operating date answers costs one call, so 20 buses
   take one minute; one that needs every fallback date costs four). Repeat presses continue
   with the buses left; the scheduled line and the coverage legend update on the next poll.
3. **Demand** (MODELLED): the day's boardings on the route come from the same buses
   (`routeDayBoardings` in `service/routeDayBoardings.ts`): the trip model's trips per day
   on them (`modelTripsPerDay`, the Routes table's "trips/day"), times the class's seats in
   the modelled fleet master, times the route's modelled load factor
   (`modelLoadFactor` in `sim/ridership.ts`), by the revenue model's rule (`dayBoardings`
   in `sim/ridershipFigures.ts`: two legs a trip, each carrying seats times load factor over
   the average ride share), so the same route, date and trips give the revenue page's
   figure. The journey time given to the trip model is the one the deployment uses (the
   feed's schedule, else the profile, else none). The day's boardings are spread over the
   hours the route runs by a reference hour-of-day shape per service class (`sim/hourlyDemand.ts`):
   ordinary and city peak at 08:00 and 18:00, express leans to a morning departure, AC and
   premium are flatter; a route longer than `LONG_ROUTE_JOURNEY_MIN = 240` minutes leans
   `LONG_ROUTE_LEAN = 0.4` of the way to a departure shape. Each hour carries a seeded
   spread of `HOURLY_JITTER = 0.08` and a band of `DEMAND_BAND_SHARE = 0.25` either way. With
   fewer than `MIN_SERVICE_HOURS = 4` running hours the shape falls back to
   `DEFAULT_ACTIVE_HOURS`, 05:00 to 22:00. Until ticketing is connected the day's boardings
   follow the modelled trips of the route's buses, so the gap shows **when** in the day
   buses are short rather than how many are short over the whole day; the page's method
   says so, and that its modelled day can differ from the depot pages'.

**Need and gap** (`need.ts`, `gap.ts`). Trips needed to start in hour k, `f_k`
(`tripsNeededByHour`), are the hour's boardings times the busiest stretch's share, divided
by seats per bus times the target load. A bus is out from a trip's start until its journey
and layover are done, so the buses needed on the road at hour h (`busesNeededByHour`) are
the trips started within the last cycle C = (journey + layover) / 60 hours:
`needed_h = ceil(Σ f_k over k in (h − C, h])`, the oldest hour weighted by the part of it
inside the window, clipped at the start of the day (nothing wraps from the evening before).
On a cycle of an hour or less this is the hour's trips times C; on a steady day it reaches
that round-trip figure once a cycle has passed. A long route's peak is therefore at most
about a cycle's worth of trips, not its busiest hour charged with the whole cycle. Journey time is
the median of the feed's scheduled end less start for the route (DERIVED), else the cached
route profile's scheduled duration (DERIVED), else `TRIP_MODEL_DURATION_MIN = 285`
(MODELLED). Seats come from the class in the modelled fleet master. The gap is needed less
deployed: positive is short, negative is over. Constants (`sim/hourlyDemandConfig.ts`,
REFERENCE, for the owner to set): `TARGET_LOAD = 0.75`, `BUSIEST_STRETCH_SHARE = 0.6`,
`LAYOVER_MIN = 15`.

**Proposals** (`proposals.ts`, `timetableFindings.ts`, `proposalCap.ts`; constants in
`service/proposalConfig.ts`). Consecutive qualifying hours form a band of at least
`MIN_BAND_HOURS = 2`. **A band is split** (`splitOnSteps` in `bands.ts`) wherever the gap
moves from one hour to the next by more than the larger of `SPLIT_STEP_MIN_BUSES = 2` buses
and `SPLIT_STEP_SHARE = 0.5` of the larger of the two gaps, so one proposal never covers a
quiet stretch and a peak with one figure; a piece left shorter than `MIN_BAND_HOURS` joins
the neighbouring piece whose mean gap is nearest. A gap that climbs a bus or two at a time
stays one band, and its add shows the range of its hourly gaps instead ("Add 4 to 19", the
peak hour in the title and the expanded row); a hold stays one figure, the least every hour
can release. Bands that ended before the current hour stay in the list, under one sentence
saying they are notes for the next day's plan.

- **Add buses**: each hour short by at least the larger of `ADD_MIN_BUSES = 2` and
  `ADD_MIN_SHARE = 0.2` of the need; the change is the band's mean gap rounded up. The
  source is the route's main depot: its standing buses in the yard in the hour before the
  band when observed, else the buses its modelled day leaves idle. When neither offers a bus
  (no yard observed and none idle in the day plan) the add names no source, says no source
  was identified, and is tier C. An add is never larger
  than an observed standing pool; when the pool is smaller the reason says so, and a yard
  with no standing bus gives an add of none, with no impact claimed.
- **Hold buses**: each hour over by at least `HOLD_MIN_SURPLUS = 1`, keeping at least
  `HOLD_KEEP_MIN = 1` bus and never fewer than the hour's scheduled bus-hours.
- **From measured data only** (tier A): trips not run (a known scheduled start with no
  actual start `NOT_RUN_AFTER_MIN = 30` minutes on; or a loaded trip the feed never
  reported, `service/loadedNotRun.ts`, counted only when its start is at or after the time
  this server began observing the date and its bus reports its journeys on the feed's rows,
  since most buses report none and their silence says nothing), a service span gap (an hour holding at
  least `SPAN_DEMAND_SHARE = 0.02` of the day's demand before the first or after the last
  known trip), a headway gap (no start for `HEADWAY_GAP_MIN = 60` minutes or more between
  06:00 and 21:00), both read from the feed's journeys and the loaded trips together, and revise running time (`RUNNING_TIME_MIN_HOURS = 3` hours in a row,
  each with at least `RUNNING_TIME_MIN_COVERAGE = 3` delays and a median above
  `LATE_AFTER_MIN = 10`). Span and headway need `MIN_LEDGER_JOURNEYS = 3` known starts.
- **Tier**: A rests on measured data only; B on measured deployment and modelled demand; C
  on the modelled day and modelled demand, and also when the main depot's buses on the road
  with no route name could cover the gap ("may be covered by buses not reporting a route").
- **Impact** (`impact.ts`, MODELLED, each a range of `IMPACT_RANGE_SHARE = 0.25` either
  way): for an add, passengers left behind before less after the change, and revenue at the
  class fare over the average ride; a hold claims no passengers or revenue (it releases only
  buses beyond the need). Bus-km including dead km once per bus moved, and cost at
  `COST_PER_BUS_KM = 50` rupees; a hold's are negative, the saving. The proposals table's
  Impact cell shows passengers for an add and bus-km saved for a hold; the source cell names
  the depot alone, with its standing or idle buses in the title and the expanded row, which
  lists all four ranges.
- Order: more passengers carried first, then the earlier band. Each proposal has a fixed
  one-sentence reason and an id from its date, kind, route and band. The page's table groups
  them instead: "Changes" (add, hold) then "Timetable findings", each by start hour; its
  Deployed, Scheduled and Needed headers say "mean" (band means), Rests on is one word
  (Derived, Mixed, Modelled), and below 800px it shows the band, the change and Rests on
  only, the rest in the expanded row, which also gives the net a day (revenue less cost).

**Punctuality by hour** (`reliability.ts`, DERIVED): median delay and the share later than
`LATE_AFTER_MIN = 10`, per hour of the journeys' scheduled start, with the journeys it rests
on. The feed does not state its delay unit, so the page prints the feed's delay figure as a
plain number (never through the duration formatter) and says the unit is unconfirmed; the
section is closed by default.

**Coverage** (`serviceCoverage.ts`), each fact once where it belongs: the provenance line is
one short MIXED sentence (buses now LIVE; observed hours and scheduled trips DERIVED; other
hours, demand, need and proposals MODELLED; with nothing observed it names no observed
hours); "Observed by this server since HH:MM (N samples)" is the chart section's note; the
buses whose whole day is loaded, of those seen on the route, are on the Scheduled legend entry
("Scheduled (full day loaded for 12 of 40 buses)");
the buses that report a route name, of every bus in the feed (only they are counted), and
the route's standing buses now (not counted as deployed) are in the closing disclosure.

## 8. The copilot

A server route (`POST /api/upsrtc/depot/copilot`) writes briefings, transfer rationales and
answers. In summary (detail, settings and limits in
[`DEPOT_COPILOT_OPERATIONS.md`](DEPOT_COPILOT_OPERATIONS.md)):

- **The question router is closed and deterministic.** A typed question is matched by a
  keyword router (`copilot/router/scriptedRouter.ts`, called from `copilot/service/prepare.ts`)
  that can only return a query from a fixed catalogue, or decline; free text never reaches a
  model. Questions about people are declined.
- **Every figure comes from server facts.** A writer supplies only the wording around them,
  as a draft checked by a token grammar, a closed vocabulary and the wording rules before
  anyone sees it. The vocabulary holds no word that states a
  cause, blames or names a person, or raises an alarm; the rules refuse numbers, units, rates,
  other days, negation and a second noun beside a figure.
- **The scripted writer is the default.** Two providers sit behind the `CopilotProvider`
  interface (`copilot/types.ts`): `scripted`, fixed server templates, always available; and
  `claude-cli`, which runs the locally installed `claude` command and is created only when
  `CLAUDE_BIN` is set to a binary that passes the safety checks and `DEPOT_COPILOT_PROVIDER` is
  unset, `auto` or `claude-cli` (`copilot/service/cliFactory.ts`); any other value, a
  misspelling included, selects scripted and is logged once. Without that, every answer is
  scripted.
- **Data source.** On last-good data or the saved sample the response carries `dataSource`
  (`last_good` or `sample`), the answer says so in the pages' own words, and the footer shows
  "last good data" or "sample data".
- **The command-line writer is for the owner's own machine only.** It uses the owner's
  personal sign-in. A staff-facing deployment needs an API-key provider behind the same
  interface; it does not exist. The wording rules still open on the model path (a later
  sentence denying an earlier one, obligation words, a true figure given a false meaning or
  window) are recorded limits of that owner-only path and must be closed
  before any staff-facing provider is switched on.
- Answer tables carry provenance per column.

## 9. Directory map

`src/lib/depot/`:

| Folder | Holds |
| --- | --- |
| `live/` | Snapshot analysis, aggregation, the held peak on-road shares and peak requirements, the hour store (`serviceHold.ts`, `serviceHoldReads.ts`), the bounded query memo, the feed-time hold of the allocation plan, and one view builder per API route (the route day's in `routeHourlyView.ts` and `routeHourlyBody.ts`) |
| `service/` | One route's day hour by hour (section 7.15): the shared shapes (`types.ts`), sampling and hour roll-ups (`observe.ts`, `observeHours.ts`), the journey ledger and scheduled supply (`journeyLedger.ts`, `scheduledSupply.ts`), modelled deployment and day boardings of the route's own buses (`modelledDeployment.ts`, `routeDayBoardings.ts`), need, gap, proposals and their cap, timetable findings, impact, punctuality, bands, reasons, and the page's wording and models (`serviceWording.ts`, `serviceCoverage.ts`, `servicePageModel.ts`, `proposalChange.ts`, `proposalDetail.ts`, `punctualityModel.ts`, `hourChartModel.ts`) |
| `infer/` | Bus state, location, yard inference and continuity, outshedding |
| `score/`, `stats/` | Efficiency index, peer groups, rolling window; robust statistics (`stats/robust.ts`), the rounding helpers and `clamp` (`stats/rounding.ts`), text ordering (`stats/order.ts`) |
| `exceptions/` | Depot and bus exceptions, paging |
| `optimise/` | Transfers (min-cost flow), what-if, allocation, Hungarian matching, parking |
| `sim/` | Every model: requirement, depot and fleet master, duties, operating day, crew, fuel, ridership, history, yard layout |
| `routes/` | Route catalogue and profiles, the browser's one client for the route-details endpoint (`routeProfileClient.ts`), which stop positions fit the timetable (`timetableFit.ts`), route table, allocation inputs, dead kilometres |
| `crew/`, `fuel/`, `revenue/`, `maintenance/`, `duties/`, `yard/`, `cockpit/`, `roster/`, `league/`, `network/`, `rebalance/` | Per-domain page models and payload types |
| `score/epoch.ts` | The straggler and epoch rule shared by the score window and the yard memory |
| `forecast/` | Trend, seasonal-naive, Holt-Winters, backtest, band, chart models |
| `copilot/` | Facts, grammar, vocabulary, providers, CLI runner, service, client |
| `repositories/` | The data seam and composition root; `getServiceRepositories()` for the hour store (`memoryHourlyObservationRepository.ts`) and the looked-up bus days (`memoryScheduledTripRepository.ts`) |
| `sources/` | The Data sources registry |
| `map/` | The overview map's view model, marker diffs and node styles |
| `shell/` | Shell geometry (`geometry.ts`), the table-width helper (`tableWidth.ts`), the table tiers (`tableTier.ts`) and the figure-band rows (`figureBandLayout.ts`) |
| top level | Unit constants (`units.ts`), formatting and the plural and count helpers (`format.ts`), ids (`ids.ts`), paths and navigation (`nav.ts`, `depotNav.ts`, `shellModel.ts`), labels, provenance line, modelled-day line, feed chip, the page-refresh store (`pageRefresh.ts`), the sign-in redirect (`signInRedirect.ts`), scope states (`scopeState.ts`, with `DEPOT_NOT_FOUND_MESSAGE`), the depot gate, rate limiter, formatting, paging, sorting, table overflow, load errors, the copilot footer words and the payload types |

Outside `src/lib/depot/`:

| Path | Holds |
| --- | --- |
| `src/lib/upsrtc/` | The module's files there: the live snapshot chain (`liveSnapshot.ts`), the depot projection (`depotNormalizer.ts`), the saved sample (`fleetFixture.ts`, `fleetFixtureShape.ts`), the schedule service (`scheduleService.ts`), the bounded TTL cache (`cache.ts`) and `jsonResponse` (`respond.ts`); `normalizer.ts` is the command centre's map projection |
| `src/lib/serverLog.ts` | `logDepotError` and `logDepotNotice`: one bounded server log line each |
| `src/hooks/` | `usePolledJson`, `useFetchedJson`, one `useDepot*` hook per endpoint, `useRouteHourly`, `useRouteProfile`, `useRouteProfileLoader`, `useCopilot`, `useProjectSignOut`, `useDebounced` |
| `src/app/api/upsrtc/depot/` | The route handlers |
| `src/app/(protected)/project/depots/` | The pages and their gates |

`src/components/depot/`: one folder per page (`cockpit`, `roster`, `yard`, `duties`,
`maintenance`, `crew`, `fuel`, `revenue`, `economics`, `league`, `network`, `rebalance`,
`routes`, `exceptions`, `trends`, `sources`, `copilot`) plus `shell` (header, navigation,
provenance line, data states, and the hooks `useWidthTier`, `useTableTier`,
`useBelowDesktop` and `useBaseMap`), `trendChart` (the trend chart, its plot and the
sparkline), `hourChart` (the 24-hour chart of a route's day, its plot, legend and table
form), `service` (the route day page: `RouteHourlyScreen`, `RouteHourlyPage`, the figure
band, proposals, punctuality and the method) and `data`.

## 10. Testing

- **Unit:** Vitest under `src/tests/unit/`, module tests named `depot-<subject>.test.ts(x)`
  (plus the `fleet-fixture-*` tests). On 6 Oct 2026, listing that folder gave 421 test files,
  398 of them named `depot-*` (file counts, not test counts).
- **Guards** (unit tests that scan the module, under `src/tests/unit/depot-guard-*.test.ts`):
  no wall-clock or random read in `src/lib/depot` outside three named files that inject a
  clock (engine purity); every depot API route answers 401 without a session, `no-store`
  always, fixed error bodies that never carry the thrown message, and a fixed 400 that
  reflects nothing for a malformed path segment or query (API routes); every depot page and
  layout reaches the session gate (page gates); no view builder or route except the route
  lookup calls the upstream (no upstream); and "simulated" never appears in the module's text
  or rendered pages, nor a raw `YYYY-MM-DD` date on screen (banned word). Each has an
  exception list that is empty today. Run one with
  `npx vitest run src/tests/unit/depot-yard.test.ts`, or all with `npm run test`.
- **Browser, live suite:** `tests/e2e/depot-management.spec.ts`, run with `npm run test:e2e`
  after `npm run build`. It covers the deep link through login, the shell, Back to
  Operations, the banned-wording check, no sideways scroll at 1440, 1024 and 800 px, the
  skip link and a console-error-free load, on the network overview, against whatever feed
  the server has.
- **Browser, sample suite:** `tests/e2e/depot-sample.spec.ts`, run with
  `npm run test:e2e:sample` (`E2E_SUITE=sample`) after `npm run build`. Playwright starts the
  server with `NEXT_PUBLIC_DEMO_MODE=1`, so every figure comes from the saved sample, and a
  fixture fails the run unless the network endpoint reports `source: 'fixture'`. It walks
  every depot route and page found on disk: the 401 and `no-store` answers, bad ids and
  queries, each page's heading, provenance, console and wording, five widths, cockpit links
  into the roster, exceptions totals against the API, keyboard paths, the copilot, and that
  no page, footer or copilot decline calls the sample live, plus a repeated-load check for
  hydration errors on the roster. On 6 Oct 2026 it has no parked (`test.fixme`) tests; the
  only skips are the missing-PIN ones below.
- **What both need:** `E2E_PROJECT_PIN` (without it each suite prints a `SKIPPED:` reason and
  skips; a top-level test fails when `CI` is set and the PIN is missing); optional
  `E2E_PROJECT_NAME`, `E2E_HOST`, `E2E_PORT` (default `localhost:3000`), `E2E_ORIGIN`.
  Playwright starts its own server with the scripted copilot writer
  (`DEPOT_COPILOT_PROVIDER=scripted`); a server already on the port is reused only with
  `E2E_REUSE_SERVER=1`, so a stray server fails the run. The server needs the app's own
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
| Deployed buses by hour | DERIVED from this server's 5-minute samples; MODELLED from the day plan where not observed | A stored history written by a sampler | routeName, slot, buses by state, depotId |
| Scheduled trips by hour | DERIVED, partial: the feed's journeys and looked-up bus days | Timetable master | routeId, tripId, departure, arrival, registration or block |
| Passenger demand by hour, need, proposals | MODELLED | Ticketing with ticket times | routeName, date, hour, boardings |
| Revenue, ridership, economics | MODELLED | Ticketing and ridership | routeName, date, serviceClass, trips, seatCapacity, boardings, revenue, routeLengthKm |
| History, trends, forecasts | MODELLED series ending on a live value | History store and ingestion worker | snapshotAt, depotId, fleet, state counts, reporting, efficiencyIndex |

The corporation must also confirm the meaning and unit of the feed's `distance` field and
of `delayMinutes`, and the meaning of tamper codes other than `C`.
