# AI Scheduler — design spec

## Context

The Depot Management module measures the fleet and recommends changes, but nothing in it
builds the day's schedule. The duty list each depot runs today is a placeholder
(`src/lib/depot/sim/duties.ts`: one duty per bus needed at peak, routes dealt round-robin,
seeded 4–10 h lengths) that ignores the hour-by-hour need the Service by the hour engine
already computes per route. Bus-to-duty matching is exact (Hungarian), crew rostering is
greedy, and the two are never optimised together.

The owner wants an **AI Scheduler**: an intelligent system that places buses, drivers and
conductors on the depot's routes so every hour's need is covered with the fewest resources.
It is modelled for demonstration now and goes real-time when the timetable, demand and crew
feeds are connected, with no engine change. As this is a prototype, the scheduler pages
carry **no "modelled" wording or provenance labels** (owner, 2026-10-12).

### Decisions made (owner, 2026-10-12)

| Topic | Decision |
|---|---|
| People scheduled | Drivers and conductors, the two anonymous `CrewSlot` roles that exist. No other depot staff |
| Objective, in order | (1) cover every hour's buses needed per route; (2) fewest buses; (3) fewest crew hours; (4) least dead running. The page shows buses and crew freed against today's plan |
| AI role | The schedule is deterministic TypeScript optimisation. The AI Engine writes the rationale and answers questions about the plan; numbers never come from the model |
| AI and people | The AI Engine may use role words (drivers, conductors, crew, duty, shift, roster) beside server-supplied counts of anonymous slots. Person, blame, performance and cause words stay banned; nobody is named or scored |
| Placement | A per-depot **AI Scheduler** page in the depot workspace, plus a Headquarters **AI Scheduler** page under Intelligence that rolls up every depot |
| Labelling | No MODELLED tag, no provenance line, no "modelled"/"model" wording on either page or in the schedule rationale. Internal `provenance` fields stay for the seam. Two fixed sentences stay: "Recommendation only. Nothing is dispatched or assigned." and, beside crew, "Availability and rostering only. No individual is assessed." |
| Real feeds later | The engine reads only through ports (interfaces). Connecting a timetable, demand or crew feed is a new adapter plus the composition root, nothing else |

### Design decisions made in this plan (overridable)

| Topic | Decision | Why |
|---|---|---|
| Relation to today's duty plan | The schedule is a **recommendation beside today's plan**, compared against it. The Duty board, Crew, Fuel, Revenue and parking pages keep reading the one shared `DutyPlan` (S41/S47). Approving records a decision in the browser trail, as transfers and proposals do | Today's duty count *is* the held peak requirement that also drives Fleet distribution's balances and the network proposals; making the schedule the day would force that model to be rebuilt (a cross-module ruling) and would remove the baseline that "freed" is measured against. The path to "the schedule becomes the day" is one switch (§ Integration) |
| What-if execution | Server-side: `POST …/schedule` with a strict zod body, memoised per snapshot and canonical params, rate-limited per login | The engine's inputs hold Maps and the baseline plan and are not cheap to ship; the module's rule is no bulk rows to the browser; the copilot route is the POST precedent |
| Names | Depot page: nav label **Schedule** (beside Duties, Crew), heading **AI Scheduler** with the depot eyebrow. HQ page: nav label and heading **AI Scheduler**, Intelligence group, between Service by the hour and AI Engine | In depot scope the rail shows both groups at once, so the two labels must differ |

### Constraints that still bind (from the approved module design and its ledger)

- Determinism: pure functions of (depot id, operating date, live anchors, params); randomness only via `SeededRandom`; the clock is `feedNow`. The engine-purity guard walks every file under `src/lib/depot`.
- Anchoring: a bus the feed reports off-road, dark or not heard recently is never assigned; a bus the maintenance hold port returns is never assigned; the schedule and today's plan partition the same live fleet.
- Crew: anonymous slots, 10 h/day, 48 h/week, a block longer than the limit is split into relief shifts (S27), two reserve slots per role (S30), uncovered shifts carry a reason per role (S36). Nothing from telemetry about a person; no slot is scored, ranked or named.
- Recommendation only. No database: holds live in process memory per snapshot; decisions live in the browser trail (S64).
- Files ~200 lines, readonly inputs, immutable data, named constants in `config.ts` with reasoning. Tests first. One commit per small change on `dms`, staged by path so `control-service/`, `.preview-simulator/` and `.claude/` are never included; no co-author line; no push unless asked.
- The word "simulated" is banned on screen; "live" is banned outside provenance components; the module's guard tests enforce both.

## Product

### Depot page `/project/depots/d/[depotId]/schedule`

Header: "AI Scheduler", description "Buses, drivers and conductors placed on the day's routes with the fewest resources. Recommendation only. Nothing is dispatched or assigned." No provenance line.

1. **Plan figures** band: Buses scheduled (lead; caption "of N today · M freed"), Driver slots ("12 of 14 covered"), Conductor slots, Crew hours ("vs N today"), Uncovered bus-hours (critical tone when above zero, else good).
2. **Route coverage by hour**: one row per route, 24 cells "needed/scheduled"; short cells marked by a tick plus hatching, never colour alone; a table view toggle.
3. **Block timeline**: one row per bus, legs coloured by route (hue plus texture; grey with the route code past twelve routes), a "now" marker from the feed clock; a keyboard and screen-reader table beside it (Bus, Block, Legs, Hours, Reason).
4. **Crew shifts**: the people sentence, then Shift, Block, Start, End, Driver slot, Conductor slot, Status ("Covered" or "Short: driver — no slot free at this time").
5. **Uncovered need**: route, hour span, buses, reason; "Every hour of need is covered." when empty.
6. **What-if** panel: demand change % (whole depot or one route), target load, buses out of service, driver and conductor slots unavailable, maximum block length, minimum turnaround, lock a bus to a route; clamp notes; Reset. Every section above shows the what-if plan while one is in force, with a "What-if: …" status line.
7. **Decision**: Approve, Defer, Reject with a note, Undo, and the trail, keyed on the plan's figures so a changed plan reads "No decision on this plan".
8. **Why this plan?**: the AI Engine's rationale (Claude when available, scripted otherwise), with the writer and time only.

### Headquarters page `/project/depots/scheduler`

Header "AI Scheduler", description "Every depot's plan for the day: buses and crew freed, need left uncovered, plans awaiting a decision. Recommendation only. Nothing is dispatched or assigned." Band: Depots planned ("60 of 143"), Buses freed, Crew slots freed, Uncovered bus-hours, Awaiting a decision (caption "in this browser"). A progress line while plans are still being built. A sortable table: Depot (link to its schedule), Buses, Today, Freed, Driver slots, Conductor slots, Uncovered h, Dead km, Decision.

## Architecture

### Pipeline (`planSchedule(input, params): SchedulePlan`, pure)

| Stage | Method | Rests on |
|---|---|---|
| A. Need per route per hour for this depot | The depot's routes are `routeNamesOf(planned.buses)`, the set today's plan uses. Each route's 24 needed values come through the `RouteNeedPort` (today the same chain as the route page: `modelHourlyDemand` → `busesNeededByHour`), after the what-if surge and target load. The route's need is network-wide, so it is **apportioned** to the depot by its share of the route's buses (`routeTableOf` operators), largest remainder per hour, ties to the lower depot id, so operators sum to the route's need | `src/lib/depot/service/need.ts`, `sim/hourlyDemand.ts`, `live/routeInputs.ts` |
| B1. Pieces of work | Level decomposition: for level k = 1..max need, every maximal run of hours with need ≥ k is one piece. Exact and minimal (Σ rises of the step function). A piece is extended to at least one cycle (journey + layover), snapped to a 5-min grid, clipped at 24:00 (lost minutes reported `past_day_end`), and cut into equal parts when longer than the block cap | `RouteTimingPort` |
| B2. Fewest blocks | Interval colouring on pieces padded by the turnaround: greedy by start, best-fit join, cap respected. Exact without the cap; `blockLowerBound` (max concurrent padded pieces) and `blocksOverBound` always reported | — |
| B3. Tie-break | Minimum path cover on the piece DAG through the existing Hungarian solver (`optimise/hungarian.ts` maximises assignments first, then cost): link cost = paid idle × W + dead-running tenths, so crew idle dominates dead km. Chains over the cap are cut; never worse than B2. Skipped above 600 pieces (`refinement: 'skipped'`) | `optimise/hungarian.ts` |
| C. Bus assignment | Holds first (maintenance hold port, what-if out-of-service, locks), then **trim**: when blocks exceed eligible buses, keep the blocks with the most need-minutes and report the rest as uncovered (`fleet_short`, or `buses_held_out` when held buses would have covered it). Then `assignDuties` unchanged, with the shared plan's `PlanNow`, so eligibility reasons and plan mode match the Duty board. Eligibility is extracted into `optimise/eligibility.ts` (pure refactor) so the scheduler can count eligible buses before matching | `optimise/assignDuties.ts` |
| D1. Shifts | Spells split at gaps ≥ 120 min (crew released); a spell over 10 h is cut into the fewest equal shifts, relief snapped to a piece end when both parts fit (`reliefAtPieceEnd`) | `crew/roster.ts` semantics (S27) |
| D2. Fewest crew | Path cover again on shifts (link when a slot can work both within 10 h), then Hungarian over chains × available slots per role with lowest ids first and `Infinity` beyond 48 weekly hours. No half-crewed shift; `ShortfallCause` per role as today | `crew/types.ts` |
| E. Figures and comparison | One `figuresOf` over both plans: buses, slots and hours per role, uncovered bus-hours, dead km as a `Figure` with coverage. **Baseline = today's shared plan** (`dutyPlanFor`) with `rosterCrew` on the crew page's pool; the schedule covers its shifts from that **same pool**. Comparison = baseline − schedule | `live/operatingDayView.ts`, `live/crewView.ts` |

### Ports (`src/lib/depot/schedule/ports.ts`)

| Port | Method | Today's adapter (`src/lib/depot/repositories/`) | Real feed that replaces it |
|---|---|---|---|
| `RouteNeedPort` | `needByHour(routeName, date) → { boardingsByHour[24], need: NeedInputs, neededByHour[24], provenance }` | `modelledRouteNeedRepository.ts`: hourly store journeys → `needInputsFor` → `routeDayBoardings` → `modelHourlyDemand` → `busesNeededByHour` (equals the route page) | Ticketing with ticket times |
| `RouteTimingPort` | `timingFor(routeName, date) → { journeyMinutes, layoverMinutes, cycleMinutes, provenance }` | `catalogueRouteTimingRepository.ts`: cached profile duration, else ledger median, else the trip-model assumption | Timetable master / network blocks |
| `DeadRunningPort` | `deadKmFor(depotId, routeName) → { outKm, inKm } \| null` | `catalogueDeadRunningRepository.ts`: inferred yard to the profiled terminals (`routes/deadKm.ts`) | Depot master + route and stop master |
| `CrewRepository` (exists) | `crewFor(depot, shiftCount, date)` | `modelledCrewRepository.ts` | Crew roster and leave feed |
| `MaintenanceHoldPort` | `holdsFor(depot, buses, date) → BusHold[]` (`job_card_open` \| `service_overdue`) | `modelledMaintenanceHoldRepository.ts`: buses the service model marks overdue (no job-card model exists today) | Maintenance work orders |
| `FleetRepository` (exists, live) | `snapshot()` | `liveFleetRepository.ts` | — |

`SchedulePorts` bundles them; `repositories/schedulePorts.ts` exports `schedulePortsFor(view, services)` and `index.ts` a `getSchedulePorts()` composition root. The engine never imports `sim/`, `labels.ts` or `modelledDayLine.ts`.

### Integration with the shared operating day

- `live/scheduleView.ts` reads `dutyPlanFor(analysis, depotId, date)` for the baseline **and** the anchors: its `buses` (one per trimmed registration), `fleet`, `mode` → `PlanNow`, `yardEstablished`. So the schedule and the day plan partition the same fleet and are in the same `PlanMode`. `operatingDayView.ts` is untouched.
- Hold: one `queryMemo<SchedulePlan | null>` per `SnapshotAnalysis` (bounded, goes with the snapshot), key `depotId | date | routeCatalogueRevision | scheduledStoreRevision | paramsKey`. The HQ page uses the default-params key and `scheduleSummaryFor`, never serialising blocks.
- Path to "the schedule becomes the day", if the owner rules it later: `blocksAsDuties(plan.blocks)` already yields `Duty[]`; `DayPlanInput` gains `duties?`, `planDay` uses them instead of `modelDuties`, and the requirement model is re-based on `blockLowerBound`. Needs an S-ruling because it changes Fleet distribution's balances.

### API

| Route | Purpose |
|---|---|
| `GET /api/upsrtc/depot/[depotId]/schedule` | Baseline plan: `ScheduleResponse` (the plan, depot name, `planKey` = hash of figures + date, `limits` per what-if field, feed envelope). 401 / 400 invalid id / 404 / 503 as the crew route |
| `POST /api/upsrtc/depot/[depotId]/schedule` | What-if: strict zod `scheduleParamsSchema`; `{}` answers the baseline (so the API guard's `{}` row passes). Rate-limited with `createWindowLimiter` + `takeAll` keyed on `requestIdentity`: 20/min per login, 120/min per process; 429 `{ error, retryAfterSeconds }`. Listed in the guard's `NOT_PLAIN_GETS` |
| `GET /api/upsrtc/depot/scheduler` | HQ roll-up: builds plans **incrementally** per snapshot — up to 24 depots or 1 500 ms of monotonic time per request, yielding between depots, one in-flight build shared by concurrent callers; answers `{ depots (planned so far), planned, pending, total, summary }`. The hook polls every 4 s while `pending > 0`. "Awaiting a decision" is counted from the browser trail |

Both routes call `requireUpsrtcAccess()` first; the API-route, page-gate and no-upstream guard tests pick them up by walking the folders.

### Decision trail

New audit event types `depot-schedule-approved | rejected | deferred` in `src/lib/audit/auditLog.ts`; a `ScheduleSubject` in `rebalance/decisionSubject.ts`; `parseAnyDecisionEvent` in `rebalance/proposalDecisionEvents.ts` learns the new events (otherwise the store drops them as skipped). Reducers and wording under `src/lib/depot/schedule/scheduleDecision*.ts`; a `useScheduleDecisions(depotId, date, planKey)` hook modelled on the proposal decisions hook.

### AI Engine

- **Request**: `{ task: 'rationale', scheduleDepotId }` in `copilot/wire.ts` and `service/schema.ts`; `ServiceSources.schedulePlan` loads the held plan.
- **Queries** (`copilot/queries.ts`, names free of crew/driver/conductor because the router test greps them): `scheduleSummary { depotId }`, `scheduleShiftCover { depotId }`, `scheduleUncovered { depotId }`, `scheduleRouteHours { depotId, routeName }`, `schedulerSummary {}`.
- **Facts and answers**: `facts/schedule.ts`, `facts/scheduler.ts`, `facts/answers/schedule.ts`, `facts/answers/scheduler.ts`, `facts/scheduleRationale.ts`. Every figure's noun lives in the fact text ("14 driver slots"); templates put figures after a colon or in a list so the figure window never shares a clause with "shift"; nothing says "model".
- **Router** (`router/scriptedRouter.ts`): `PEOPLE` splits into `PERSON` (still refused: staff, employees, managers, mechanics, salary, driving…) and `ROLE` (crew, drivers, conductors, duty, shifts, roster, blocks, scheduler, uncovered, freed) which routes to a schedule kind unless an individual cue is present (`which/who + driver`, or a judgement word such as late, best, perform, pay, blame beside a role word) → still `PEOPLE_QUERY`.
- **Vocabulary** (`vocabulary/judgement.ts`): no word becomes free; `BOUND_PHRASES` gains "driver slot(s)", "conductor slot(s)", "crew slots" so role words render only inside those phrases. Figure, sentence and window rules are unchanged.
- **Prompt** (`cli/prompt.ts`): the rationale task line mentions a depot's schedule plan; a rules line lists the bound phrases, generated from the list so prompt and validator cannot drift. For schedule kinds the request carries `refuseWords` (model, modelled…) that `service/generate.ts` checks on the rendered Claude text, falling back to the scripted draft.
- **Ask page**: description ends "questions about an individual are not answered."; one suggested question becomes "How many drivers and conductors does <depot> need today?".
- Recorded limit (owner-only Claude path): a bound phrase can still be characterised ("driver slots are weak"); staff-facing providers stay off until closed, as S59 already records.

### Navigation and tests that pin it

- `src/lib/depot/nav.ts`: `SCHEDULER_PATH`, Intelligence item `AI Scheduler` between Service by the hour and AI Engine. `src/lib/depot/depotNav.ts`: `Schedule` after `Crew`.
- `src/tests/unit/depot-nav.test.ts` (network label list), `depot-scope-nav.test.ts` (depot label list and active item), `tests/e2e/depot-sample.spec.ts` `PAGE_HEADING` (both pages, heading "AI Scheduler").
- **Provenance exemption**: the two e2e tests that walk every page for a provenance line (`shows its heading and provenance`, `says the data is the sample, not the live feed`) get an explicit `NO_PROVENANCE_LINE` set holding the two scheduler paths and assert the line is **absent** there, not a weakened check. No unit guard walks pages for a badge. `docs/DEPOT_UI_PATTERNS.md` records the exception.

## Types (the ones every stage shares; full set in `src/lib/depot/schedule/types.ts`)

```ts
interface PieceOfWork { id; routeName; level; startMin; endMin; needMinutes }
interface VehicleBlock { id; depotId; pieces; startMin; endMin; routeNames; mainRouteName;
  serviceClass; workMinutes; paidIdleMinutes; routeChanges }
type BlockHoldReason = Ineligibility | 'job_card_open' | 'service_overdue' | 'out_of_service';
interface BlockAssignment { blockId; registrationNumber: string | null;
  reason: 'assigned' | 'locked' | 'fleet_short' | 'no_eligible_bus'; busStanding }
interface UncoveredNeed { routeName; hour; buses; reason: 'fleet_short' | 'buses_held_out' | 'past_day_end' }
interface ScheduleCrewAssignment extends ScheduleShift { chainId; driverSlot; conductorSlot; shortfalls: RoleShortfall[] }
interface ResourceFigures { buses; busesWithoutBus; crewSlots: Record<CrewRole, number>;
  crewHours: Record<CrewRole, number>; uncoveredBusHours; deadKm: Figure<number | null> }
interface ScheduleParams { demandSurgePercent?; routeSurges?; targetLoad?; busesOutOfService?;
  crewUnavailable?: Partial<Record<CrewRole, number>>; maxBlockMinutes?; minTurnaroundMinutes?;
  locks?: { registrationNumber; routeName }[]; holdForMaintenance? }
interface SchedulePlan { depotId; operatingDate; planMode: PlanMode; params: Required<ScheduleParams>;
  clamped: string[]; routes: DepotRouteNeed[]; routesWithoutNeed; pieces; blocks; blockLowerBound;
  blocksOverBound; refinement: 'hungarian' | 'skipped'; assignment: ScheduleAssignment; uncovered;
  coverageByHour: { hour; needed; covered }[]; crew: ScheduleCrew; figures: ResourceFigures;
  baseline: { source: 'duty_plan'; mode; duties; figures }; comparison: ScheduleComparison;
  provenance: { need; timing; crew; holds; fleet: 'live' } }   // kept for the seam, never shown
```

Clamps (`schedule/params.ts`, mirroring `optimise/scenario.ts`): surge [−50, 100] %, target load [0.5, 1.0], out-of-service ∩ depot buses (≤ 500), crew unavailable [0, available], block cap [240, 960] min on the 5-min grid, turnaround [0, 180], locks one per bus on an operated route. Non-finite values fall back with a note; the clamped params are canonicalised into the memo key.

## File layout (new unless marked)

```
src/lib/depot/optimise/pathCover.ts            minPathCover(count, linkCost) via hungarian
src/lib/depot/optimise/eligibility.ts          eligibilityOf(...) moved out of assignDuties.ts (modified, no signature change)
src/lib/depot/schedule/{config,types,ports,params,need,pieces,blocks,blockLinks,assign,shifts,
  crewCover,figures,baseline,compare,planSchedule,api}.ts
src/lib/depot/schedule/{scheduleWording,schedulePageModel,scheduleBoardModel,scheduleTableLayout,
  whatIf,scheduleDecisionEvents,scheduleDecisionReducers,scheduleDecisionWording,rollupModel}.ts
src/lib/depot/repositories/{modelledRouteNeedRepository,catalogueRouteTimingRepository,
  catalogueDeadRunningRepository,modelledMaintenanceHoldRepository,schedulePorts}.ts; index.ts, types.ts (modified)
src/lib/depot/live/{scheduleView,scheduleHold,schedulerView}.ts
src/app/api/upsrtc/depot/[depotId]/schedule/route.ts (GET + POST); src/app/api/upsrtc/depot/scheduler/route.ts
src/hooks/{useDepotSchedule,useSchedulerRollup}.ts
src/app/(protected)/project/depots/d/[depotId]/schedule/page.tsx; src/app/(protected)/project/depots/scheduler/page.tsx
src/components/depot/schedule/{SchedulePage,ScheduleHeader,ResourceBand,CoverageStrip,CoverageStripRow,ScheduleBoard,
  BlockTimeline,BlockRow,BlockLegend,BlockTable,ShiftTable,UncoveredNeed,WhatIfPanel,WhatIfFields,
  ScheduleDecisionControls,ScheduleDecisionTrail,useScheduleDecisions,ScheduleRationale,
  SchedulerRollupPage,RollupHeader,RollupBand,RollupProgress,RollupTable}.tsx
src/components/depot/duties/TimelineFrame.tsx   axis/grid extracted from DutyTimeline.tsx (modified; render test stays green)
src/lib/depot/copilot/{wire,queries}.ts, service/{schema,prepare,serviceData,generate,interpret}.ts,
  router/scriptedRouter.ts, vocabulary/judgement.ts, cli/prompt.ts (modified);
  facts/{schedule,scheduler,scheduleRationale}.ts, facts/answers/{schedule,scheduler}.ts (new)
src/lib/audit/auditLog.ts, src/lib/depot/rebalance/{decisionSubject,proposalDecisionEvents}.ts (modified)
src/lib/depot/sources/registry.ts (unlocks wording), docs (README, DEPOT_MANAGEMENT, LIVE_VS_PREDICTED,
  DEPOT_UI_PATTERNS, DEPOT_COPILOT_OPERATIONS, the design spec's amendments list)
```

Reused as-is: `hungarian.ts`, `assignDuties.ts`, `crew/roster.ts` (`crewShiftsFor`, `rosterCrew` for the baseline), `need.ts`, `routeDayBoardings.ts`, `hourlyDemand.ts`, `routes/deadKm.ts`, `live/queryMemo.ts`, `rateLimit.ts`, `rebalance/fieldCommit.ts` and the rebalance field components, `duties/dutyBoardModel.ts` bar geometry, `service/heatStyle.ts`, `copilot/RationaleButton.tsx`, `service/Proposal*` trail parts.

## Phases

Each phase: tests first, one commit per small change, and the gate below before the next starts.
Phases S1–S2, S3–S5 and S6 own disjoint files and can run as parallel workstreams in isolated
worktrees merged through `depot-int` into `dms`, as the module was built; S7 integrates.

| Phase | Builds | Done when |
|---|---|---|
| **S1 Engine core** | `optimise/pathCover.ts`, `optimise/eligibility.ts` extraction, `schedule/{config,types,ports,params,need,pieces,blocks,blockLinks}.ts` | Brute-force tests on small cases pass (path cover vs all partitions, pieces cover exactly N(h), blocks equal the padded bound uncapped); existing `depot-assign-duties*` tests unchanged and green |
| **S2 Engine completion** | `schedule/{assign,shifts,crewCover,figures,baseline,compare,planSchedule}.ts` | Property test over 150 seeded depots: determinism, fleet partition, coverage ≥ need where blocks have buses, figures reconcile, `planMode` equals the baseline's; baseline reconciles with the duty board and crew page on the guard view; a 150-bus / 25-route depot plans under the time guard; 600 pieces take the skipped path |
| **S3 Ports, views, API** | the four adapters, `schedulePorts.ts`, `scheduleView.ts` (GET and POST), `scheduleHold.ts`, `schedulerView.ts` (incremental roll-up), both routes, both hooks | Adapter tests equal the route page's need; view held per snapshot and params, bounded; roll-up budget, yield and shared hold tested; API guard (401, 200, `{}` POST, 429 body) green |
| **S4 Depot page** | page models, wording, what-if reducers, decision events/reducers/wording, every component of the depot page, `TimelineFrame` extraction, nav + tests, audit event types | Render tests for every state; wording test proves no "model"/"live" word; absence of provenance test ids; `bannedOnScreen` empty; decisions round-trip through `parseAnyDecisionEvent`; browser walk at 1440/1024/800 on `localhost:3000` |
| **S5 HQ page** | rollup model and the five roll-up components, nav + tests | Progress state, sorted table, awaiting-decision count from the trail; browser walk |
| **S6 AI Engine** | queries, facts, answers, rationale, router split, bound phrases, prompt, `refuseWords`, service wiring, `ScheduleRationale` panel, Ask page text | Every scripted answer renders through `renderDraft` with no digit and no "model" in prose; router tests: schedule questions route, individual questions still refuse; judgement-word tests updated; copilot route test for the schedule rationale |
| **S7 Integration** | e2e additions (`PAGE_HEADING`, `NO_PROVENANCE_LINE`, sentences present, copilot ask/refuse), registry `unlocks` wording, docs, spec amendments entry, final reviews | Full gate below; both e2e suites; seven-area review findings fixed or recorded |

Gate (every phase): `npm run typecheck && npm run lint && npm run test && npm run build`; `npm run test:e2e:sample` on the saved sample and `npm run test:e2e` on the live feed where the PIN is available; pages walked in a real browser on `http://localhost:3000` (the Maps key authorises only that origin); code review each phase, security review on S3 (POST body, limiter) and S6 (vocabulary relaxation, subprocess prompt), design critique on S4 and S5; a short phase report of what ran and what could not be verified.

## Verification

- Unit (vitest, `src/tests/unit/depot-schedule-*.test.ts`, `depot-optimise-path-cover.test.ts`, `depot-copilot-schedule-*.test.ts`): listed per phase above. Existing guards cover the new code automatically: engine purity, page gates, API routes, no upstream calls, banned and live words.
- Existing tests that change on purpose: `depot-nav`, `depot-scope-nav`, `depot-copilot-router` (three people-guard questions move to routed cases), `depot-copilot-judgement-words` (bound words gain driver/conductor/crew), `depot-copilot-facts` (role words allowed only inside bound phrases), `depot-ask-page` (description), `depot-copilot-view` (one suggested question), `depot-guard-api-routes` (`NOT_PLAIN_GETS` entry for the POST).
- End to end (`tests/e2e/depot-sample.spec.ts`): both pages have their heading and no provenance line; both show the recommendation sentence, the depot page the people sentence; no "simulated"; no sideways scroll 390–1440; the API contract rows for both routes; the AI Engine answers "How many drivers does <sample depot> need today?" and declines "Which driver is late?".
- Manual: sign in on `localhost:3000`, open a depot's Schedule, run three what-ifs (surge, slots unavailable, a lock), approve, reload, confirm the trail; open the HQ page and watch it fill; ask the AI Engine the two questions above with `DEPOT_COPILOT_PROVIDER=scripted`, then once with the owner's `claude-cli` on their machine (owner-run, as before).

## Risks and recorded limits

1. **Freed compares two models** until a timetable or ticketing feed is connected: today's duties follow a seeded morning triangle, the schedule follows a demand shape anchored on bus counts. The ports make the swap mechanical; they do not make today's figure real.
2. **Apportioned need**: a route's need is network-wide and split by each depot's bus share, so a depot's need is proportional to its deployment. The page wording says the schedule covers the depot's share of the route's need.
3. **Optimality with caps**: blocks are exact only without the 16 h cap, crew chains only when no slot takes three shifts. Both report a lower bound and the gap; "fewest possible" is said only when the gap is zero.
4. **Dead running** is mostly unknown (profiles load on request, S40); the tie-break then claims no saving and the figure shows its coverage.
5. **No job-card model exists**; buses the service model marks overdue stand in through the hold port. Today's shared plan does not hold them; a separate ruling if it should.
6. **HQ roll-up** fills over several polls on a large network; a new snapshot restarts it (summary rows are carried over when the date and the depot's fleet are unchanged).
7. **Claude path**: bound phrases can be characterised; "model" is refused by a post-render check; both recorded as owner-only limits.
8. **Timeline density** at 150 buses: the table view is the real answer; it is the default below 640 px.


## After approval

1. Commit both specs as `docs/superpowers/specs/2026-10-12-ai-scheduler-design.md` and `docs/superpowers/specs/2026-10-12-incident-response-design.md` (`docs:` commits on `dms`).
2. Write per-phase implementation plans with the writing-plans skill under `docs/superpowers/plans/2026-10-12-scheduler-s1…s7.md` and `2026-10-12-incident-i1…i7.md`.
3. Execute phase by phase in FULL mode with parallel workstreams where the phase tables allow (S1–S2, S3–S5, S6, I1–I2 own disjoint files; I7 waits for S3 and S4), merged through `depot-int` into `dms`, each phase gated as above; record rulings made without the owner in the build ledger; update the project memory (owner decisions of 2026-10-12: the two features, the no-label rule, the Incident Response name).
