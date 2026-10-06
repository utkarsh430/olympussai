# Depot Management System — design spec

## Context

The command centre's **Fleet Distribution** button opens a templated overlay whose depot
figures are random. The transport department's existing depot software is dated and thin.
This plan replaces that button with **Depot Management**: a full module for UPSRTC's fleet
that measures how the fleet is distributed today, finds the inefficiency in each depot and
route, and recommends concrete changes. It uses real data where it already flows and a
modelled layer for everything else, built so each modelled domain turns real the day its
feed is supplied.

Reference is `main` only (`dms` is the same commit, `f2f240b`). Unmerged depot work on
`trial`, `crewban/*` and the untracked `control-service/`, `.preview-simulator/`,
`.claude/` is ignored and never staged.

### Decisions made

| Topic | Decision |
|---|---|
| Release type | Production-track architecture; missing data modelled behind swappable interfaces |
| Users | HQ planners and depot managers through an in-module **scope switcher** on the existing PIN. Real accounts come later |
| Real data now | The GPS feed and the UPSRTC route-details API (stops on a bus's route, sequence, scheduled times, next stop). Everything else is modelled for the demonstration until supplied |
| Persistence | **No database in this plan.** Real figures come from the current snapshot; history and trends are modelled behind a history interface |
| LLM | Claude through the Claude Code CLI (`claude -p`) on the owner's Max subscription for as long as it works; scripted AI responses whenever it does not. A Claude or OpenAI API key can be added later behind the same interface |
| Out of scope | EV charging and range planning, autonomous execution, scoring of individual drivers |

### What the data can and cannot support

Measured on the 400-row sample fixture; the full feed is measured in P1 and shown live on
the Data Sources page.

| Field | Populated | Consequence |
|---|---|---|
| `home_depot`, `depot_name`, `vehicle_status`, power, tamper, ignition | 100% | **Strong.** Fleet strength, status mix, off-road, GPS and device health per depot are real |
| Position, speed, GPS time | 100% | **Strong.** Where each bus physically is, depot yard inference, buses away from home |
| `distance` (odometer) | 49% | Unit is undocumented (median 160,033). Calibrate before any km feature |
| `routename`, scheduled start/end | 18% | **Thin.** Roughly 7.5% of buses carry a schedule for the feed date |
| `actual_start_time` | 12% | Often stale (not reset between trips). Needs a geofence-exit cross-check |
| `delay` | 17% | Minutes, measured at the previous stop; noisy (−1,337 to +1,021). Trust only for today's trips |

Other findings that shape the design:

- The "143 depots" include non-depots: `ENFORCEMENT_*`, `KAISERBAGH HIRED`,
  `NOIDA ELECTRIC`. Each needs a `kind`; enforcement units stay out of league tables.
- Two status vocabularies exist (`status`, `vehicle_status`) and disagree. The depot view
  carries `vehicle_status` separately instead of the merged `rawStatus`.
- The feed has no region field. `zone_name` is a street address.
- Every derived figure is shown with its coverage ("based on 31 of 412 buses").

## Product

Every figure carries a provenance tag: **LIVE** (from the feed), **DERIVED** (computed
from live data), **MODELLED** (generated), or **REFERENCE** (curated static data). The
on-screen word is MODELLED because `main` bans the word "simulated" in the interface
(e2e test 21, README section 25).

### A. Network Command (HQ scope)

1. **Network overview** — KPI band and a map of Uttar Pradesh with depots as nodes sized
   by fleet and coloured by efficiency. *Derived.*
2. **Depot league table** — a composite **Depot Efficiency Index** benchmarked against a
   peer group of similar size and kind, not the whole network. *Derived.*
3. **Fleet distribution and rebalancing** — supply against requirement, surplus and
   deficit, optimiser-recommended transfers between depots with before/after impact, a
   what-if sandbox, and an approve/reject trail. *Supply derived; requirement modelled.*
4. **Route-to-depot allocation** — which depot should run which route to minimise dead
   kilometres within capacity. *Terminals are real, from the route-details API;
   trip frequency is modelled.*
5. **Route efficiency** — real stop list and terminals per route, buses deployed against
   requirement, delay pattern, load and earnings per km. *Mixed.*
6. **Exception centre** — depots behaving abnormally against peers: GPS blackouts,
   off-road spikes, buses far from home, power-cut and tamper alerts. *Derived.*

### B. Depot Workspace (depot scope)

1. **Cockpit** — fleet status board, outshedding tracker, exceptions, AI briefing.
2. **Fleet roster** — every bus with state, route, last ping, health flags, and a drawer
   showing its real timetable.
3. **Yard** — which buses are physically inside the depot now, occupancy, and a night
   parking order matching the morning departure sequence.
4. **Duty board** — buses against duties on a timeline with auto-assignment. *Modelled.*
5. **Maintenance** — off-road list (live), preventive maintenance by odometer, workshop
   load. *Mixed.*
6. **Crew** (availability and rosters only), **fuel and cost**, **revenue and
   ridership**. *Modelled.*

### C. AI layer

- **Optimisers** in pure TypeScript: transfers, route-to-depot allocation, bus-to-duty
  matching, reserve sizing.
- **Inference from real GPS**: depot boundaries learned from where each depot's buses
  park, an operational state per bus, anomaly scoring against peers.
- **Forecasting** on the history interface (modelled now, real later, same code).
- **Claude copilot**: briefings, a rationale per recommendation, question answering.

### D. Data Sources registry

Each feed listed as LIVE, DERIVED or MODELLED, with measured coverage and the schema
expected for the real version.

## Architecture

### Routing and shell

```
src/app/(protected)/project/depots/
  layout.tsx                    session gate + DepotShell (scrolling, no zoom)
  page.tsx                      network overview
  league/  rebalance/  exceptions/  routes/  sources/
  region/[regionId]/page.tsx    gated on the region list (see Data needed)
  d/[depotId]/layout.tsx        validates id (^\d{1,4}$), depot sub-nav
  d/[depotId]/page.tsx          cockpit
  d/[depotId]/roster/  yard/  duties/  maintenance/  crew/  fuel/  revenue/
```

- **Scope lives in the URL.** Deep-linkable, testable, and the enforcement point when
  real accounts arrive. The switcher is only a navigator. Depot id is `home_depot`.
- **Button** (`src/components/command-center/TopCommandBar.tsx:107-115`): becomes
  `<Link href="/project/depots" data-testid="open-depot-management">` labelled "Depot
  Management", matching the Bunching link beside it. `src/hooks/useFleetDistribution.ts`
  is deleted. The old demand overlay stays reachable from the bus drawer, Scenario Lab and
  Pitch Mode, which e2e test 8 already covers.
- **Login redirect** (`src/lib/auth/redirect.ts:18`): replace the single prefix with an
  allowlist of `/project/upsrtc`, `/project/bunching`, `/project/depots`. This also closes
  the known Bunching deep-link gap in README lines 344-356.
- **Middleware**: no change. `/project/:path*` and `/api/upsrtc/:path*` already cover the
  new pages and APIs. Each page and API still re-checks the session, as `main` does.
- **Shell** (`src/components/depot/shell/`): `DepotShell`, `DepotNav`, `ScopeSwitcher`,
  `ProvenanceBadge`, `DataTable`. Dark HUD tokens with flat `depot-*` classes in
  `globals.css`; no scan overlays or `zoom: 1.18` on scrolling data pages.

### Live data path

- **One fetch, two projections.** New `src/lib/upsrtc/liveSnapshot.ts` owns the cache,
  single-flight dedupe and the live → cache → last-good → fixture chain, and returns both
  `CanonicalLiveBus[]` and `DepotBusRow[]`. `src/app/api/upsrtc/live/route.ts` becomes a
  thin caller with an identical response. Without this, a depot route would download the
  11.6 MiB payload a second time.
- **A second schema**, `src/models/depotLive.ts`, not optional fields on
  `CanonicalLiveBus`, which ships 9.6k buses to the browser every 15 seconds.
- **Aggregate on the server.** `GET /api/upsrtc/depot/network` (about 60-90 KB) and
  `GET /api/upsrtc/depot/[depotId]` (about 20-40 KB), memoised per snapshot, polled every
  60 seconds by `useDepotNetwork` and `useDepotDetail`.
- **Route catalogue from the route-details API.** I take this to be the endpoint already
  wired on `main` as `/api/upsrtc/schedule` (`getScheduledBusInfo.php`: stops, sequence,
  coordinates, scheduled times, ETA per bus). If you mean a different endpoint, it becomes
  one more adapter behind the same interface. A new `getRouteProfile(routeId)` picks a
  live bus on that route from the snapshot, fetches its stops once, and caches the
  profile for the operating day: stop list, both terminals, scheduled trip duration.
  It fills on demand as routes and depots are opened, so there is no bulk crawl. Stops
  with `0,0` coordinates are flagged, and routes with no assigned bus today stay
  "profile unavailable". Served by `GET /api/upsrtc/depot/route/[routeId]`.
- **Time basis**: "due by now" logic uses `feedNow = max(receivedTime)`, never
  `Date.now()`.
- **Fixture**: a slim full-fleet fixture built with the existing redaction in
  `scripts/inspect-upsrtc-api.ts`; the current one has 3 buses per depot.

### Domain model and the real/modelled seam

```ts
type Provenance = 'live' | 'derived' | 'modelled' | 'reference';
interface Figure<T = number> { value: T; provenance: Provenance;
  coverage?: { n: number; of: number }; note?: string }
```

- One repository interface per domain (`FleetRepository`, `DepotMasterRepository`,
  `TimetableRepository`, `HistoryRepository`, then maintenance, crew, fuel, revenue as
  their phases arrive) and **one composition root**,
  `src/lib/depot/repositories/index.ts`. Swapping in a real feed or a database is a new
  adapter plus that file.
- **Anchoring.** The modelled world is seeded by depot id and operating date and built
  from real anchors: depot ids, per-depot fleet counts, route sets, status mix. Modelled
  counts partition the real fleet count; off-road is never below the live figure. Unit
  tests enforce these invariants so modelled and real numbers cannot contradict.
- **Layout**: `src/lib/depot/{types,labels}.ts` and `live/ infer/ optimise/ sim/
  repositories/ reference/ copilot/`; `src/components/depot/<page>/`. Pure functions,
  readonly inputs, files under about 200 lines.

### Algorithms

All pure TypeScript, run on the server; the what-if sandbox re-runs the rebalancer in the
browser on the 143-row summary.

| Algorithm | Method | Rests on |
|---|---|---|
| Yard inference | 150 m grid, densest cell plus neighbours, centroid and p90 radius. Needs 6+ parked buses and 50% in-cluster, otherwise "yard unknown". Merged with a seed file to stop jitter; shared yards attributed by home depot | Live |
| Bus state | Ordered rules over `vehicle_status`, speed, ignition, power, GPS age, in-yard, trip date | Live |
| Outshedding | Departed if actual start is within a window of schedule, or the bus has left the yard and is moving | Live, low coverage |
| Depot Efficiency Index | Reporting rate, utilisation, assigned share, off-road rate, device health; robust z-score (median/MAD) within peer group, scaled 0-100. Modelled cost and revenue go in a separate labelled index | Live |
| Anomaly scoring | Robust z per peer group with top reasons. Per depot, never per driver | Live |
| Rebalancing | Min-cost flow by successive shortest paths over 143 depots | Modelled requirement |
| Route-to-depot | Regret-greedy assignment plus swap local search; dead km from inferred yard to the route's real first and last stop | Live terminals, modelled frequency |
| Bus-to-duty | Hungarian matching per depot | Modelled duties |

### Claude copilot through `claude -p`

Checked against the installed CLI (2.1.291) and the Claude Code docs.

```
claude -p --output-format json --json-schema <schema> --system-prompt <fixed prompt>
       --tools "" --restricted --strict-mcp-config --no-session-persistence --model <env>
```

- Spawned with an argument array and no shell; prompt on stdin; empty temporary working
  directory; hard timeout; output cap; concurrency of two with a short queue.
- `--tools ""` removes every built-in tool. `--restricted` and `--strict-mcp-config` keep
  this repo's own Claude settings and MCP servers out of the subprocess.
- **`--bare` cannot be used** (it reads only an API key, never the subscription token),
  and `--max-turns` is absent from this CLI, so neither is relied on.
- Auth: `claude setup-token` gives a one-year token, passed as `CLAUDE_CODE_OAUTH_TOKEN`.
  The child gets only `PATH`, a dedicated `HOME` and that token; never
  `ANTHROPIC_API_KEY` (which would silently switch to API billing) or the app's secrets.
- **Numbers never come from the model.** The server sends named facts; the model writes
  prose with `{{fact:id}}` placeholders; the server substitutes values and rejects any
  reply containing a stray digit, falling back to the template.
- **Question answering without tools.** The model maps the question to one of about ten
  typed queries (zod-validated); the server runs it against the engine. User text is only
  ever delimited data and none of the queries expose crew data.
- **Provider seam.** `CopilotProvider` is vendor-neutral. `DEPOT_COPILOT_PROVIDER`
  defaults to `auto`: use `claude-cli` while it is available, otherwise `scripted`.
  - `claude-cli` — the subscription path above.
  - `scripted` — deterministic AI responses written from the same engine facts. Always
    available, needs no key, and covers briefings, rationales and the typed questions,
    so every copilot screen demonstrates fully without the CLI.
  - `anthropic-api` and `openai-api` — added later when a key is supplied; a new
    adapter and an environment variable, no change to callers.
- **Falling back.** A missing CLI, failed sign-in, usage limit reached, timeout or
  invalid output switches that request to `scripted`. After a failure the CLI is skipped
  for a cool-down period so a rate-limited subscription is not hammered. The UI labels
  which provider wrote each text.
- Briefings are cached and generated on request, not on every poll, since calls draw on
  the same Max limits as the owner's own Claude Code sessions.
- **Limits.** The CLI path runs on a machine where Claude Code is signed in, not on
  Vercel, where `auto` resolves to `scripted`. The Agent SDK docs say Anthropic does not
  allow developers to offer claude.ai login or rate limits in their products without
  prior approval, so the subscription path fits the owner's own development and demos;
  an instance used by department staff should run on the API-key provider.

## Phases

Each phase is its own cycle: spec in `docs/superpowers/specs/`, implementation plan,
tests first, review, verification report.

| Phase | Builds | Demoable at the end |
|---|---|---|
| **P0 Entry and shell** | Button, redirect allowlist, depots layout and shell, CSS, e2e 22, docs | Button opens a gated dark shell; deep link survives login |
| **P1 Live depot path** | `liveSnapshot`, depot schema and normaliser, two depot APIs, hooks, repository seam, Data Sources page, full-fleet fixture, odometer calibration script | Registry with measured coverage; live network KPIs |
| **P2 Network Command** | Bus state, depot kind, DEI, peer groups, anomalies, map, league table, exception centre | League of real depots on live data |
| **P3 Depot Workspace** | Yard inference, outshedding, cockpit, roster with a drawer showing the bus's real route, stops and next stop, yard page, route catalogue (`getRouteProfile`) | A single depot's cockpit on live data |
| **P4 Fleet distribution** | Modelled world, requirement model, min-cost flow, what-if, approve/reject trail (extends `auditLog`), modelled trend series | Transfer plan with before/after |
| **P5 Copilot** | Provider seam, scripted and CLI providers with `auto` fallback, briefing, rationale, then Q&A | Briefing written by Claude locally; scripted everywhere else |
| **P6 Route intelligence** | Route efficiency on real stops and terminals, route-to-depot allocation | Dead-km savings per route |
| **P7 Depot operations** | Duty board, maintenance, night parking order | Auto-assigned duty timeline |
| **P8 Resources and economics** | Crew availability, fuel and cost, revenue and ridership | Full modelled capability |
| **P9 Trends and forecasting** | Forecasts on the history interface | Forward view per depot |
| **Later** | Postgres and ingestion worker, real accounts, API-key provider, real feeds | |

P1 needs P0; P2 and P3 need P1; P4 and P5 need P2; P6-P9 need P4.

**Approval covers all phases, P0 through P9, built end to end in order.** A phase is not
left until it passes its gate; the next phase does not start on a failing one.

Phase gate (every phase):

1. `npm run typecheck`, `npm run lint`, `npm run test` and `npm run build` all pass.
2. `npm run test:e2e` passes, including the new depot spec, where `E2E_PROJECT_PIN` is
   available; anything that could not be run is stated in the phase report.
3. Every page the phase adds is walked in a real browser, with screenshots checked for
   layout, empty, loading, stale and error states.
4. Review findings (code review each phase; security review on P0 and P5; design
   critique on UI phases) are fixed or explicitly recorded.
5. A short phase report: what was built, what ran and passed, what could not be verified.

**Commits.** One commit per small logical change (a test, the function that makes it
pass, a component, a doc update), with `feat:` / `fix:` / `test:` / `refactor:` / `docs:`
messages. All on `dms`, staged by explicit path so the untracked `control-service/`,
`.preview-simulator/` and `.claude/` are never included. No push or pull request until
asked.

The route catalogue fetches one route at a time as pages are opened; a bulk pre-fetch of
all 1,194 routes would be about 1,200 calls to the UPSRTC server and is not part of this
plan unless you ask for it.

### Files touched in P0 and P1

Modified: `src/components/command-center/TopCommandBar.tsx`, `src/lib/auth/redirect.ts`,
`src/lib/auth/server.ts`, `src/app/api/upsrtc/live/route.ts`, `src/app/globals.css`,
`tests/e2e/command-centre.spec.ts` (test 22), `src/lib/alerts/alertEngine.ts` (comment),
`README.md`, `docs/LIVE_VS_PREDICTED.md`, `docs/PRESENTATION_GUIDE.md`,
`docs/DEMO_SCRIPT.md`. Deleted: `src/hooks/useFleetDistribution.ts`.

Created: `src/app/(protected)/project/depots/**`, `src/app/api/upsrtc/depot/**`,
`src/models/depotLive.ts`, `src/lib/upsrtc/{liveSnapshot,depotNormalizer}.ts`,
`src/lib/depot/**`, `src/components/depot/{shell,network,sources}/**`,
`src/hooks/{useDepotNetwork,useDepotDetail}.ts`, `src/tests/unit/depot-*.test.ts`,
`tests/e2e/depot-management.spec.ts`, `scripts/{build-depot-fixture,calibrate-odometer}.ts`.

### Reused from `main`

- `src/components/shared/hud.tsx` (`HudPanel`, `Badge`, `CountUp`, `ConfidenceRing`,
  `Readout`), `FooterDisclaimer`, `ProjectSignOut`
- `src/lib/maps/loader.ts` `getMapsLoader()`, `MAP_DARK_STYLE`, `MapFallback`, and the
  canvas technique in `src/components/map/fleetCanvasLayer.ts`
- `src/lib/upsrtc/{client,cache,respond}.ts`, `requireUpsrtcAccess()`
- `src/lib/simulation/seededRandom.ts`, `src/lib/audit/auditLog.ts`, `src/lib/formatters`
- `useLiveFleet` polling pattern; `useSchedule` and `/api/upsrtc/schedule` for the drawer
- Recharts, and the Radix dialog/select/tabs/tooltip packages already installed but unused

## Verification

Per phase: `npm run typecheck && npm run lint && npm run test && npm run build`, then
`npm run test:e2e` (needs `E2E_PROJECT_PIN`).

Unit tests written first, in `src/tests/unit/depot-*.test.ts`:

- **P0** redirect allowlist, including traversal and `//` cases.
- **P1** depot normaliser ("None" sentinels, delay clamp, stale actual start, dual status,
  malformed timestamps); single-flight in `liveSnapshot`; existing normaliser tests green.
- **P2** state classifier table, MAD of zero, index monotonicity.
- **P3** yard clusters (split, sparse, shared), outshed window.
- **P4** flow conservation, optimality on small cases, determinism, anchor invariants.
- **P3** also: route profile from a schedule payload (terminals, `0,0` stops, "Bus Not
  Assigned" response), cached once per route per day.
- **P5** argument builder, environment allowlist, placeholder validator; `auto` falls
  back to `scripted` on missing CLI, usage limit and timeout (mocked subprocess), and
  honours the cool-down; scripted output is deterministic for the same facts.

End to end, new `tests/e2e/depot-management.spec.ts`: button navigation, unauthenticated
deep-link round trip, provenance badge and footer on every depot page, scope switching,
API 401 without a cookie. Manual: run the app, sign in, walk each page in a browser with
screenshots, and run one briefing with `DEPOT_COPILOT_PROVIDER=claude-cli`.

Review gates: security review on P0 (redirect) and P5 (subprocess); code review each
phase; design critique on each UI phase.

Cannot be verified without the live feed or credentials: full-feed coverage, the
`distance` unit, yard inference quality at 9.6k buses, Vercel cache behaviour, and Google
Maps rendering in e2e.

## Data needed from you (none blocks P0-P5)

| Data | Unlocks |
|---|---|
| Depot → region list | The region scope |
| Depot master: coordinates, parking capacity, bays | Replaces inferred yards and modelled capacity |
| Network timetable or blocks | Real requirement, so real surplus and deficit; real duties |
| Route and stop master | Routes with no bus assigned today, and stops the API returns as `0,0` |
| A Claude or OpenAI API key | The copilot on a deployed, staff-facing instance |
| Fleet master: type, age, seats | Vehicle compatibility in transfers |
| Maintenance, crew, fuel, ticketing | Each modelled page turns real |
| Meaning of `distance` and `delay` | Odometer and adherence features |

## Risks

1. **Thin schedule signal.** Coverage shown on every figure; outshedding is not a
   headline number until the timetable arrives.
2. **Modelled figures read as real.** Per-figure provenance, anchor invariants, a
   separate modelled index.
3. **Upstream load on serverless.** Per-instance caches can each refetch 11.6 MiB.
   Shared snapshot module, single-flight, 60-second depot polling; a shared cache comes
   with the database.
4. **Copilot reach.** The CLI is local only and shares the subscription's limits. `auto`
   falls back to scripted responses, and an API key slots in later.
5. **No enforced permissions.** Any PIN holder can open any depot; stated in the UI.

---

## Amendments made during the build

Added 6 Oct 2026 after the build; brought up to ruling S63 the same day. The approved text above is unchanged; where it and this
list disagree, this list and the code win. Rulings are numbered as in the build's decision
ledger (S-numbers) and the P0 phase ledger. Process-only rulings (S1, S2, S4, S8, and the
dispatch rulings of P0 and P1) are left out. The module as built is described in
[`docs/DEPOT_MANAGEMENT.md`](../../DEPOT_MANAGEMENT.md).

**Shell and tests**

- P0 Ruling 1: the depot top bar has its own sign-out control at 11 px or larger; the sign-out behaviour moved into `src/hooks/useProjectSignOut.ts`.
- P0 Ruling 2: the shared `FooterDisclaimer` is reused unchanged on depot pages; the 11 px floor binds new depot components only.
- S5: the two unreachable steps of command-centre e2e test 21 (Diagnostics and Audit buttons removed on `main`) are dropped; its wording assertions stay.
- S14/S15: the e2e host and port are configurable and the default host is `localhost`, the origin the Maps key authorises.
- S23: the bus drawer is a hand-built modal with scroll lock and a focus trap, not a Radix dialog.
- S24: "unit" means any home-depot value in the feed, "operating depot" a unit of kind `depot`; the feed chip never says `CACHE` (it reads `LIVE` or `STALE`, `FIXTURE` on the saved sample, and `CHECK CLOCK` from S56c).
- S44 (amends the plans' "every figure carries a provenance tag"): each page declares its default provenance once, under its header, as one tag and one fixed-formula sentence; only what differs carries its own tag; no "Modelled" in titles, column headers or cells of an all-modelled page. Amended by S51.
- S51 (amends S44): a section or column where a generated figure or status sits beside a real, named bus, depot or route carries one tag on every page, all-modelled pages included; a generated band on a mixed or derived page carries its tag; every page's provenance line is pinned by a test through the real component.
- S53 (wording, in part): "in the yard" means every bus of the depot inside the yard circle whatever its state, and a standing subset is called "standing in the yard"; the cockpit's emergency line links to the exceptions page filtered by kind and depot, which honours both on entry; the modelled day being recomputed from each snapshot is accepted and worded "as of the feed time".
- S60: one state vocabulary on screen, the classified states; the network figures (on road, standing, dark, off road) are sums of the classified states, DERIVED, and partition the fleet, instead of sums of the feed's own status field.

**Live path and inference**

- S10: the shared snapshot's arrays are read-only, and its concurrent-failure path is tested before anything consumes it.
- S3: `summariseOutshed` takes an injected `stateOf(row)` rather than importing the bus-state classifier.
- S6: outshedding order is ended, departed on actual time, upcoming (even when dark), unknown, departed by location, due, overdue.
- S13, S16, S19 (each superseded by S25): the grid-based yard rules tried in rounds 2 to 4. From S19 the yard radius survives: the largest member distance plus padding, not the 90th percentile.
- S25 (replaces the spec's "150 m grid, densest cell plus neighbours, centroid and p90 radius ... 50% in-cluster"): yard inference is distance-linked density clustering (150 m link, 4 points for a core), with a share floor of one quarter; minimum 6 buses and 1.5x dominance stay.
- S43 (replaces the spec's "merged with a seed file to stop jitter"): yard continuity in process memory; an established yard is kept while at least six of the depot's standing buses are in it, for up to twelve hours. No seed file exists. Refined by S50c: the held circle stays fixed, a repeat feed time returns the remembered yard, and only buses heard recently keep a hold.
- S9: when the MAD is zero, the robust z falls back to the mean absolute deviation around the median (factor 1.2533).
- S42: the Depot Efficiency Index and the peer-comparison depot exceptions are computed from counts summed over a rolling 20-minute window of snapshots held in process memory, not from one snapshot. Refined by S50b, S56b and S56c.
- S46 (refines S25): groups of parked buses whose nearest buses stand within 300 m (twice the link distance) are one place, merged largest first while the place stays within the 1.5 km span, before the size, share, dominance and span tests; the yard rule sentence says so.
- S50 (in part replaced by S56): (b) an in-window out-of-order sample is inserted in order, a repeated feed time with new rows replaces its sample, and responses carry `coveredMin` and per-depot sample counts; (c) see S43; (d) "in service" also accepts an overnight trip still running at the feed time, and each exception states whether it is compared over the window or as of the feed time. Its part (a), a percentile clock guard, was replaced by S56a.
- S56 (replaces S50a and the epoch part of S50b): (a) the feed clock is the newest receive time not later than the snapshot's fetch time read in Indian time plus 5 minutes, rows beyond it ignored for the clock and counted; (b) a sample more than one window behind the newest is scored alone and never touches the window or the yard memory.
- S56c (amends S56b): a new epoch needs three stragglers, each later than the one before and within one window of it, spanning at least 3 minutes of feed time; the start-up count of yard decisions is not sent for the saved sample or the unassigned group; the saved sample's clock has no upper limit; 1% or more of a response's rows (at least 20) ahead of the clock turns the feed chip to `CHECK CLOCK`.
- S57: freshness, not the path, decides `stale` on the depot pages: last-good data younger than 90 s is not stale; the saved sample always is.
- S52 (amends the spec's offline fallback): the fallback is a full-fleet saved sample, gzip-compressed, allowlisted keys only, read lazily on first fallback and memoised; a missing or bad file falls back to the small sample. Built by `npm run build:depot-fixture`.

**Fleet distribution and routes**

- S7: excluded depots stay in before/after totals and their deficit is reported as uncovered with reason `excluded`; only units of kind `depot` give or receive buses.
- S20: an allocation swap is accepted when the swap as a whole saves the minimum, not each leg.
- S21: unchanged routes gain the reasons `over_capacity` and `move_limit`, with a fixed precedence.
- S22: a route's per-trip kilometres are the sum of the rounded outbound and inbound figures.
- S40 (amends the spec's route efficiency and allocation inputs): no background crawl of the route details API; profiles are fetched one route at a time on a user's action. The ruling also approved a user-initiated, bounded per-depot loader; it is built (`src/lib/depot/routes/profileLoader.ts`: one lookup at a time, at most 40 routes a press, never by itself).

**Modelled domains**

- S11: modelled rate series scale their daily variation with the level (sqrt(p(1-p)) with a floor).
- S41: crew, fuel, revenue and the duty count all derive from one modelled operating day per depot and date. Extended by S47.
- S47: the day decides which bus runs each duty once: one plan per snapshot, depot and operating date (the day's route lengths also per route-catalogue revision), shared by the duty board, crew, the night parking order, fuel, revenue and economics, from one matcher (`assignDuties`). A bus in service or on the road is eligible; cost tiers keep on-road buses in the day, then a bus reporting the duty's route, then class, then time fit.
- S48: the economics sentence says a depot's per-kilometre figures weight its routes by distance; the operating-date fallback reads the fetch time in Indian time; day wording is dated and tense-neutral; a real route length under a named floor is treated as not known; capacity is the seats offered.
- S55 (refines S47): a later day's plan ignores how buses stand now; every bus must be heard recently to be eligible; in service ranks above merely moving; an unassigned duty's reason no longer names a class; the spare sentence says where spare buses stand.
- S62 and S62b (extend S55): until the first duty of the feed's own date has started, the day has not begun: no time fit, buses standing in the yard take the earliest duties and buses still out the ones after, and the night parking order plans the feed's own date from that same plan; from the first duty on it plans the next date. A repeated registration keeps the most recently heard row.
- S63: the requirement model reads each depot's on-road share, and the peer median, over the rolling score window instead of the single snapshot.
- S27: crew are rostered against shifts derived from duties (a duty longer than the daily limit is split), and required crew is the shift count.
- S30: each crew role gets a fixed reserve of two slots on top of the ratio.
- S36: an uncovered shift carries a reason per role, and the page says a shortfall is an outcome of the model.
- S28, S31: a bus's fuel variance is measured against its peers excluding itself (at least two), and it is flagged only when that peer median is supported.
- S32: revenue per leg is seats x load factor x length x fare per km, two legs per trip, with boardings from a seat-turnover figure.
- S33 (replaced by S39): the economics index's coverage gate.
- S39: modelled earnings per kilometre do not depend on route length, so every operating depot is ranked on economics when its peer group is large enough; a route without a real profile uses a modelled typical length for revenue totals.

**Trends and forecasting**

- S34: the forecast method is chosen, and its error reported, over the displayed horizon; the band is the 80th percentile of empirical h-step errors (pooled when thin); values are clipped to the metric's range before the band is built.
- S35: the long trend window is 28 days ("over 4 weeks"), and "steady" is judged against the series' own variation.

**Copilot**

- S12 (superseded by S26): model prose validated by an allowlist of characters.
- S17: the CLI has its own hourly and daily call cap and a breaker on rejected drafts.
- S18: no instruction-word deny-list; "describe, never instruct" is enforced by the system prompt and by presenting briefings as advisory.
- S26: model prose is validated by a token grammar and a closed vocabulary, so it cannot contain a quantity.
- S38: further rules on what the model may write next to a figure (refines S26).
- S29, S37: limits key on a session identity (a random session id claim added to the session token) plus the client address when a trusted header is configured; scripted answers have a high process ceiling; Claude work is bounded by a per-identity allowance and the process budget.
- S45: a worded relation between two true figures is accepted as a residual risk.
- S49: the wording guard reads two words either side of a figure and refuses rate makers, day-shift words and negation there; words the scripted writer never needs are removed from the vocabulary; an IPv6 caller is keyed on its /64.
- S59: the two wording rules still open on the model path (a later figure-less sentence denying an earlier one; obligation words and the noun-use opener) are recorded limits of the owner-only command-line writer, to be closed before any staff-facing provider is switched on.
- S61: person, cause, blame and alarm words are removed from the closed vocabulary (kept only inside fixed phrases); what remains of a true figure given a false meaning is a recorded limit of the owner-only path.

**Differences from the text above with no ruling found in the ledger**

- Depot Efficiency Index components: the code uses on-road share, off-road rate, dark rate, schedule coverage and device integrity (`src/lib/depot/score/config.ts`), not "reporting rate, utilisation, assigned share, off-road rate, device health".
