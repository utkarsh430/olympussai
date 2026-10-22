# Incident Response — design spec

Approved by the owner on 2026-10-12 together with the AI Scheduler spec (`2026-10-12-ai-scheduler-design.md`), whose "After approval" section gives the build order for both.

## Context

Nothing in the module reacts to a bus breaking down mid-journey. The feed already carries
two real signals (a raw trip status of **Towing**, and the driver's **emergency** flag, which
is a bus exception today), and the module knows each bus's position, state, route and trip,
the cached route profile's stops, every depot's inferred yard, the spare buses in the
scheduler's plan, dead running between points and a modelled passenger load per route-hour.
The only "incident response" in the repo is a demo scenario in the command centre with
invented candidates (`src/lib/demo-scenarios/breakdownScenario.ts`), outside the depot module
and not reused.

### Decisions made (owner, 2026-10-12)

| Topic | Decision |
|---|---|
| Name and placement | **Incident Response**, a separate feature: a depot page `/project/depots/d/[depotId]/incidents` (depot nav label "Incident Response") and a Headquarters page `/project/depots/incidents` under Intelligence |
| How an incident enters | **Detected** from the feed (a bus in service that has stopped away from any yard or terminal, gone dark mid-route, reads Towing, or raised the emergency flag) **and declared** by a person from the bus drawer |
| "Most efficient replacement" | **Passengers moving soonest first**, then least cost: dead kilometres, then the knock-on to the rest of the day's schedule |
| Sources weighed | A spare in the depot's own yard; a spare in another depot's yard within range; the following bus on the same route picking the passengers up when it has the seats; a bus finishing its scheduler block nearby; and the baseline of waiting for the next scheduled bus. Candidates that cannot carry the passengers are excluded with a reason |
| Crew | The broken bus's crew continue on the replacement when it comes to them; a spare bus needs one available driver slot at its depot to ferry it, else the candidate is marked so |
| Labelling and persistence | As the scheduler: no "modelled" wording or provenance labels on screen; recommendation only; declarations and decisions live in the browser trail; the server computes plans on request |

### Design decisions made in this plan (overridable)

| Topic | Decision | Why |
|---|---|---|
| Work plan seam | Incident Response reads the day's work (spares, each bus's block and its end, buses finishing soon, rest-of-day knock-on) through a `WorkPlanPort` with two adapters: today's shared duty plan first, the AI Scheduler's plan once its views exist | Lets the two features build in parallel; the knock-on figure reads "not available until the schedule plan is built" on the duty-plan adapter and fills in when the schedule adapter is wired |
| Stop duration | A small bounded per-process holder records since when each standing bus away from a yard has stood still (position within jitter), offered one snapshot at a time through the analysis seam like the service hold | Nothing in the module remembers a bus across snapshots; without it "stopped for N minutes" cannot be said, and the page must then say "duration not yet observed" |
| Shared sentences | The same two fixed sentences as the scheduler | One voice across the two features |

## Product

### Depot page `/project/depots/d/[depotId]/incidents`

Header "Incident Response", description "Buses that may have broken down on the road and the quickest way to move their passengers. Recommendation only. Nothing is dispatched or assigned." No provenance line.

1. **Declare**: a registration field and "Plan a replacement"; also reached from the bus drawer with `?bus=`.
2. **Incident list**: one row per suspected or declared bus: bus, route, origin ("Detected" / "Declared"), confidence word, the signals in words ("Under tow", "Emergency flag raised by the device", "Stopped away from any stop", "Not heard for N min on its journey", "Main power off"), stopped minutes or "duration not yet observed", passengers aboard, the recommendation sentence and arrival. Rows expand.
3. **Detail**: passengers aboard, remaining trip (stops, km, minutes to the destination, or "Stop positions for this route are not loaded" with a link to the route page's loader), the ranked **replacement table** (kind in words, bus, arrival, passengers moving in, dead km, seats free, crew note, knock-on, exclusion reason; the recommended row marked by a word and a mark), **rest of day** (how the rest of the block is covered and the day's knock-on, or the not-available sentence, with a link to the AI Scheduler's what-if with that bus out), Approve/Defer/Reject with the trail, and **Why this replacement?** from the AI Engine.
4. **How a breakdown is spotted**: the rule table and the speed and lead-time assumptions in plain words, without "model".
5. Empty state: "No bus of this depot looks broken down on this snapshot. Declare one from the roster's bus drawer or above."

### Headquarters page `/project/depots/incidents`

Header "Incident Response". Band: Buses that may have broken down, High confidence, Declared in this browser, Plans ready ("N of M"). Sortable table: Depot (link), Bus, Route, Confidence, Passengers aboard, Recommended, Arrival.

### Entry points

- **Bus drawer** (`src/components/depot/roster/BusDrawer.tsx`): its first action, "Plan a replacement", linking to the depot's Incident Response page with the bus declared.
- **Cockpit attention line** (`src/lib/depot/cockpit/attention.ts`): "N buses may have broken down on the road" → the page; the calm sentence gains "no bus looks broken down".
- **AI Scheduler uncovered section**: a row for a bus out for a breakdown ends "Out for a breakdown — Incident Response ›"; the incident page's rest-of-day block links to `/schedule?out=<reg>`, which the scheduler reads into its out-of-service what-if.

## Architecture

### Detection (`src/lib/depot/incident/detect.ts`, pure over the snapshot analysis, cached profiles and the stopped-since map)

| Signal | Source | Confidence |
|---|---|---|
| `towing` | the feed's raw trip status word "Towing", case-insensitive (`DepotBusRow.tripStatus`) | high |
| `emergency_flag` | `row.emergency === true` (already the `emergency` bus exception) | high |
| `stopped_on_route` | state `standing` (speed ≤ 3 km/h, heard within 6 h), location `away` from every yard, heard within 30 min, a journey today whose scheduled end is after the feed time, not within 1 km of its yard, and (when the route's profile is cached) not within 150 m of a located stop nor 400 m of a terminal | medium when stopped ≥ 10 min by the holder or main power off, and the route is profiled; otherwise low |
| `not_heard_on_route` | not heard ≥ 30 min or dark, last fix away, a journey today still running | low |
| `power_off` | main power off beside `stopped_on_route`; supporting only | — |

Exclusions, first match wins: off road; in a yard or at another depot's yard; no usable position; no journey today, trip not started, trip ended; moving; near its yard; at a stop; at a terminal. Towing and emergency skip every exclusion but the position annotation. Without a cached profile the stop and terminal tests cannot run, confidence is capped at low and the row says stop positions are not loaded; the feature never fetches a profile (S40). One incident per registration; ordered by confidence, stopped minutes, registration.

The holder (`incident/stoppedSince.ts`): process-wide, one operating date, at most 5 000 buses, never written from the saved sample; an entry is kept while the bus stays within 50 m, reset when it moves, dropped when it drives off. Wired as a write-only analysis store like the service hold; the detector reads a frozen copy.

Declared incidents (`incident/declare.ts`): any bus of the depot may be declared; the plan then carries what is true of it (a bus standing in its yard gets the note "no passengers are stranded on the road"). The declaration lives in the browser trail; the server computes and memoises the plan.

### Replacement engine (`planReplacement(input, params): ReplacementPlan`, pure)

| Candidate kind | How it is costed |
|---|---|
| Spare from the yard | Spares of the work plan standing in the yard and heard recently. Arrival = 10 min lead + road time from the yard; dead km = that leg; seats = the bus's seats; needs one free driver slot at the depot (available drivers minus shifts running now), else marked `no_ferry_driver` and excluded; the broken bus's crew continue on it |
| Spare from another depot | Depots with an established position within 60 km (road) and spares standing in their yard. Lead 15 min; dead km = out and back; knock-on = 60 min when lending leaves that depot below two spares; needs that depot's free driver slot |
| Following bus on the route | Buses in service on the same route. With a profile, "behind" when its nearest-stop sequence is lower than the incident's; without one, direction unknown and kept only within 30 km. Arrival = road time along the line; seats free = seats minus its own passengers aboard; knock-on = its passengers × 5 min; dead km 0; its own crew aboard. Direction-unknown candidates are ranked but never recommended |
| Bus ending its block nearby | Work-plan buses whose block ends within 30 min and that stand within 15 km. Lead 5 min; its own run is over so all seats are free; the broken bus's crew take it over |
| Next scheduled bus (baseline, never excluded) | Headway = cycle ÷ buses on the route now, clamped 5–120 min; arrival = half the headway; seats from the load port; or "No further bus is known on this route today" |

Common arithmetic: road time = straight-line × 1.3 detour ÷ 30 km/h (REFERENCE), arrival rounded up to a 5-min grid, passengers moving = arrival + 5 min transfer. A candidate without the seats for the passengers aboard is excluded `not_enough_seats`. **Ranking** among non-excluded candidates: passengers moving minutes, then dead km, then knock-on minutes, then kind order (own yard, following bus, block-ending bus, other depot, next scheduled), then id. Excluded candidates are listed after with their reasons, at most five per kind.

Output `ReplacementPlan { incident, passengersAboard: Figure, remainingTrip | null, candidates (ranked), recommended | null, baseline, restOfBlock { blockId, remainingPieces, endMin, coveredBy: 'replacement_continues' | 'reassigned' | 'uncovered' } | null, dayKnockOn { blocksWithoutBusDelta, uncoveredBusHoursDelta } | null, clamped: string[], planKey, provenance }` (provenance kept, never shown). Every assumption or gap is a sentence in `clamped`. Constants with their reasoning in `incident/config.ts`; no randomness anywhere; the clock is `feedNow`.

### Ports (`src/lib/depot/incident/ports.ts`)

| Port | Today's adapter | Real feed later |
|---|---|---|
| `PassengerLoadPort` `loadAboard({ routeName, operatingDate, hour, busesOnRouteNow, journeyMinutes }) → Figure` | `repositories/modelledPassengerLoadRepository.ts`: the route page's hourly boardings chain, busiest-stretch share, ÷ buses on the route, clamped to the class's seats | Ticketing with ticket times |
| `RoadTimePort` `travel(from, to) → { km, minutes }` | `incident/straightLineRoadTime.ts`: `roadDistanceKm` ÷ 30 km/h | A routing service |
| `WorkPlanPort` `workFor(analysis, view, depotId, date) → { source, spareBuses, blockOf(reg), blockEndingSoon(min), withBusOut(reg), driverShiftsNow }` | `repositories/dutyPlanWorkRepository.ts` over `dutyPlanFor` (knock-on null) | `repositories/scheduleWorkRepository.ts` over the held `SchedulePlan` and its out-of-service what-if |
| `RouteTimingPort` (shared with the scheduler) | the scheduler's catalogue adapter; until it lands, a thin wrapper over `needInputsFor` + layover | Timetable master |
| `CrewRepository` (exists) | `modelledCrewRepository.ts`; free driver slots = available drivers − driver shifts spanning the feed minute | Roster feed |

`IncidentPorts` bundles them; `repositories/incidentPorts.ts` and `getIncidentPorts()` in `index.ts`. The engine never imports `sim/`, labels or views.

### API and holds

| Route | Purpose |
|---|---|
| `GET /api/upsrtc/depot/[depotId]/incidents` | Suspected incidents with their plans, the detection summary (considered, excluded by reason, routes not profiled), `workSource`. Held per snapshot via `queryMemo`, key `depotId | date | catalogue revision | scheduled-store revision` |
| `POST /api/upsrtc/depot/[depotId]/incidents` | `{ registrationNumber }` (strict zod; `isValidRegistration` added to `src/lib/depot/ids.ts` and reused by the roster's bus param). Rate-limited 30/min per login, 200/min per process; memoised per snapshot and registration (bounded 64). 404 "Bus not in this depot". Listed in the API guard's `NOT_PLAIN_GETS` |
| `GET /api/upsrtc/depot/incidents` | HQ: detection for every depot in one pass (rows and cached profiles only), plans built incrementally for depots with incidents under the same 24-depot / 1 500 ms budget and shared in-flight build as the scheduler roll-up; `{ rows, totals { suspected, high, medium, low }, planned, pending, total }`; the hook polls every 4 s while pending |

Hooks: `useDepotIncidents`, `useDeclareIncident` (one POST), `useIncidentRollup`.

### Decision trail

Audit event types `depot-incident-declared`, `depot-replacement-approved | rejected | deferred`; subjects `IncidentSubject` and `ReplacementSubject` (registration, depot, candidate id and kind, arrival, `planKey`); `parseAnyDecisionEvent` learns them; reducers `declaredIncidentsFor(events, depotId, date)` and `replacementDecisionsFor` keyed on registration + `planKey`. Both pages count "declared in this browser" from the trail.

### AI Engine

- Queries `breakdownSummary { depotId }`, `replacementFor { depotId, registrationNumber }`, `networkBreakdowns {}`; rationale request `{ task: 'rationale', incidentDepotId, registrationNumber }`; `ServiceSources.incidents` loader; facts in `facts/incident.ts`, answers in `facts/answers/breakdowns.ts`, rationale in `facts/replacementRationale.ts`.
- Router: an `INCIDENT` pattern (incident(s), breakdown(s), broken down, replacement(s), under tow, towing) routes to the new kinds; a registration among the scope depot's buses → `replacementFor`; "breakdowns" is removed from the off-road measure pattern in `router/measures.ts` and `scriptedRouter.ts` (no pinned test uses it; the "off road" cases stay green). People questions still refuse first.
- Vocabulary: "incident response" becomes a bound phrase; drafts say "may have broken down", "under tow", "the device's flag is raised", never the refused words incident, suspected, emergency, critical; crew only as "driver slot(s)"; `refuseWords` (model, modelled) as in the scheduler.

### Navigation and tests that pin it

`depotNav.ts`: "Incident Response" after Crew. `nav.ts`: `INCIDENTS_PATH`, Intelligence item "Incident Response" after AI Scheduler, before AI Engine. `depot-nav`, `depot-scope-nav`, e2e `PAGE_HEADING` (both pages, heading "Incident Response") and the `NO_PROVENANCE_LINE` set (both pages, line asserted absent).

## File layout (new unless marked)

```
src/lib/depot/incident/{config,types,ports,detect,stoppedSince,declare,replace,rank,remainingTrip,routePosition,
  ferryDrivers,straightLineRoadTime,routeTiming,incidentWording,incidentDecisionEvents,incidentDecisionReducers,
  incidentDecisionWording,api}.ts; incident/candidates/{spares,following,blockEnding,baseline}.ts
src/lib/depot/repositories/{modelledPassengerLoadRepository,dutyPlanWorkRepository,scheduleWorkRepository,incidentPorts}.ts; index.ts (modified)
src/lib/depot/live/{incidentView,incidentRollupView}.ts; live/analysis.ts (modified: the stopped-since store seam)
src/lib/depot/infer/busState.ts (modified: export isOnScheduledTrip); src/lib/depot/ids.ts (modified: isValidRegistration)
src/app/api/upsrtc/depot/[depotId]/incidents/route.ts (GET + POST); src/app/api/upsrtc/depot/incidents/route.ts
src/hooks/{useDepotIncidents,useDeclareIncident,useIncidentRollup}.ts
src/app/(protected)/project/depots/d/[depotId]/incidents/page.tsx; src/app/(protected)/project/depots/incidents/page.tsx
src/components/depot/incident/{IncidentPage,IncidentHeader,DeclareForm,IncidentList,IncidentRow,IncidentDetail,ReplacementTable,
  CandidateRow,RestOfDay,IncidentDecisionControls,IncidentDecisionTrail,useIncidentDecisions,useDeclaredIncidents,
  IncidentRationale,IncidentMethod,IncidentRollupPage,IncidentRollupBand,IncidentRollupTable}.tsx
src/components/depot/roster/BusDrawer.tsx, src/lib/depot/cockpit/attention.ts, src/lib/depot/depotNav.ts (incidentBusHref) (modified)
src/lib/depot/copilot/{queries,wire}.ts, service/{schema,prepare,serviceData}.ts, router/{scriptedRouter,measures}.ts,
  vocabulary/{judgement,domain,function,verbs}.ts (modified); facts/{incident,replacementRationale}.ts, facts/answers/breakdowns.ts (new)
src/lib/audit/auditLog.ts, src/lib/depot/rebalance/{decisionSubject,proposalDecisionEvents}.ts (modified)
```

Reused as-is: `infer/busState.ts` rules and helpers, `infer/location.ts`, `infer/geo.ts`, `routes/deadKm.ts` (`terminalsOf`, located-stop rule), `routes/depotPositions.ts`, `optimise/rebalance.ts` (`roadDistanceKm`), `service/need.ts`, `service/routeDayBoardings.ts`, `sim/hourlyDemand.ts`, `crew/roster.ts` (`crewShiftsFor`), `live/queryMemo.ts`, `rateLimit.ts`, the proposal decision controls and trail parts, `RationaleButton`.

## Phases

| Phase | Builds | Done when |
|---|---|---|
| **I1 Detection** | `incident/{config,types,detect,stoppedSince,declare}.ts`, the analysis store seam, `isOnScheduledTrip` export | Table tests: at a stop, at a terminal, in a yard, dark in a yard, stopped on road with and without a profile, stopped 3 min, Towing at a terminal, emergency while moving, trip ended, not heard on a journey, duplicate rows, shuffled rows; holder sequence tests (set, keep, reset, drop, new date, sample ignored, cap) |
| **I2 Engine and ports** | `replace.ts` and helpers, candidates, ranking, ports, the load and road-time adapters, the duty-plan work adapter | Ranking equals brute force on small cases; every exclusion reason; direction-unknown never recommended; baseline never excluded; `restOfBlock` per kind; knock-on null on the duty-plan adapter; determinism; adapters equal the route page's chain and `roadDistanceKm ÷ 30` |
| **I3 Views, API, hooks** | `incidentView.ts`, `incidentRollupView.ts`, both routes, three hooks, guard rows, `isValidRegistration` | Held per snapshot and revision; POST memo bounded; 401 / 400 / 404 / 429 / 200 bodies; roll-up budget and shared build; API, page-gate, no-upstream, purity and word guards green |
| **I4 Depot page and entry points** | every depot-page component, wording, trail events and reducers, drawer action, cockpit line, nav and tests | Render tests for every state incl. the declare flow with a mocked POST; wording test (no model/live/simulated); no provenance test ids; drawer link; cockpit line; nav lists; browser walk at 1440/1024/800 |
| **I5 HQ page** | roll-up page, band, table, nav | Progress and sorted table; declared count from the trail; browser walk |
| **I6 AI Engine** | queries, facts, answers, rationale, router, vocabulary, service wiring, rationale panel | Router cases (breakdown questions route; off-road cases unchanged; people questions refuse); every answer renders with no digit and no "model"; bound phrase test |
| **I7 Integration** | `scheduleWorkRepository.ts` wired once S3 exists; the scheduler's uncovered link and `?out=`; e2e; docs; registry `unlocks` | Knock-on equals the scheduler's out-of-service what-if minus its baseline; both e2e suites; docs (`DEPOT_MANAGEMENT.md` §7 and §9, `DEPOT_UI_PATTERNS.md`, `LIVE_VS_PREDICTED.md`, `DEPOT_COPILOT_OPERATIONS.md`, the design spec's amendments) |

I1–I2 own files disjoint from the scheduler's S1–S3 and run in parallel with them; I3 after I2; I4–I6 after I3; I7 after S3 and S4. Gate and reviews as for the scheduler: security review on I3 (POST body, limiter) and I6; design critique on I4 and I5.

## Verification

- Unit: `depot-incident-{detect,stopped-since,replace,ports,view,route,page,rollup,decisions}.test.ts(x)`, `depot-copilot-incident-*.test.ts`; the existing drawer, cockpit-sections, nav and judgement-word tests updated as listed.
- End to end: both pages headed "Incident Response" with no provenance line and the recommendation sentence; the API rows for both routes (401, 400 bad id, 404 unknown depot, 400 `{}` POST); the AI Engine answers "Any breakdowns at <sample depot>?" and declines "Which driver broke down?".
- Manual on `localhost:3000`: open a depot's roster, open a bus drawer, press "Plan a replacement", see the declared incident with its ranked candidates; approve and reload; open the Headquarters page; on the live feed, confirm any Towing or emergency bus appears as high confidence; ask the AI Engine the two questions.

## Risks and recorded limits

1. **False positives** on the proxy signals (an unlisted stop, a traffic jam, a crew break): mitigated by the 10-min floor, the stop and terminal exclusions, confidence words and the method note; a declared incident is always a person's call. Low-confidence detections are counted on the HQ page and listed below a fold.
2. **Profiles load on request (S40)**: on a cold server most detections are low confidence with "stop positions not loaded" and no remaining-trip stops or km; the row links to the route page's loader. Nothing here starts a crawl.
3. **Direction** rests on nearest-stop sequence on a profile sampled from one bus; direction-unknown candidates are never recommended.
4. **Speed and lead times** are reference figures (30 km/h; 10, 15, 5 min); arrival is on a 5-min grid and the method note says so; a routing service replaces the speed through the port.
5. **Declarations and decisions live in one browser** (S64); the HQ page says "declared in this browser".
6. **Cross-depot spares**: the lender's day is not re-planned; the knock-on is a stated reserve rule, not a measured loss.
7. **Passengers aboard** are a busiest-stretch estimate until ticketing, so seat exclusions are conservative.
8. **The stopped-since holder is per process**: after a restart every stopped bus reads "duration not yet observed" until the next sample.
9. **Copilot wording**: incident, suspected and emergency are refused words; drafts are written and tested around them.

