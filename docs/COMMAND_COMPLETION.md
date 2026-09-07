# The command lifecycle had no terminal success state

`COMMAND_COMPLETION_SWEEP_ENABLED`, default **off**.

Migration `control-service/db/migrations/20260907093000__command_completion.sql`.
Code: `control-service/src/db/commands.ts#sweepCompletedCommands`,
`control-service/src/scheduler/jobs.ts#commandCompletionSweep`.
Trial model: `control-service/src/simulation/commandLifecycle.ts#releaseSlotOnCompletion`.

---

## 1. The defect, and it is worse than previously recorded

`commands_one_active_per_vehicle_idx` is a UNIQUE partial index over
`('proposed', 'awaiting_approval', 'authorized', 'delivered', 'acknowledged', 'executing')`.
A driver who ACCEPTS an instruction moves it to `executing`
(`db/commands.ts#acknowledgeCommand`). Nothing in `control-service/src` ever
wrote `completed`.

The previously recorded consequence — in `AGENTS.md` and in this module's own
comments — was that an accepted command holds its vehicle's slot **for the full
TTL**, 120 s whatever the length of the action. **That is wrong, and it
understates the defect.**

`control_service_expire_commands()` deliberately EXCLUDES `executing`, with a
correct rationale of its own: *"a command already being carried out is not
retroactively expired mid-execution, it runs to completed/failed."* But since
nothing ever wrote `completed`, "runs to completed/failed" was only ever true
for a driver REFUSAL. An accepted command had **no exit from `executing` at
all**, and held its vehicle's slot **indefinitely**.

`listActiveVehicleIds` — the advisory pre-check `mpc/safety.ts` uses — selects
on status with no `expires_at` filter, so it sees such a row forever too. The
lazy `lockAndExpireIfDue` path cannot rescue it either: the only query that
reaches an unacked command by vehicle, `getActiveDeliveredCommandForVehicle`,
filters `status = 'delivered'` and so never touches an `executing` row.

### MEASURED, live control database, 2026-09-06

| status | count | age range |
|---|---|---|
| `expired` | 13 | 23d 21h – 26d 18h |
| `failed` | 6 | 26d 01h – 26d 18h |
| `executing` | **4** | **24d 20h – 26d 18h** |

All four `executing` rows carry `ack_outcome = 'accept'` and are past their own
`expires_at` by 24–26 days. They are the **only** non-terminal rows in that
database past their TTL: the sweep had cleared every other status and
structurally could not clear these. Three are `qa-e2e-*` fixtures; the fourth,
`UP78HT4567`, is a real fleet vehicle, unable to receive any command since
2026-08-13.

### Reproduced and fixed end-to-end on a real Postgres

Against a throwaway `postgis/postgis:16-3.4` with all 19 migrations applied
(the control-service suite mocks the DB by convention, so this was run out of
band rather than added to it):

1. `control_service_expire_commands()` → **0 rows**; the command stays
   `executing` three minutes past its TTL.
2. `INSERT` of a new command for that vehicle → `ERROR 23505 duplicate key value
   violates unique constraint "commands_one_active_per_vehicle_idx"`. The bus is
   blocked.
3. `control_service_complete_finished_commands()` → the row goes to `completed`.
4. The identical `INSERT` now **succeeds**.
5. The append-only audit trigger records `executing → completed` with no
   application-level write, as designed.

---

## 2. What "finished" means — the whole fix

A command in `executing` is finished when **the action it asked for is over**.

| case | finished at | why |
|---|---|---|
| action states its own duration (`parameters.holdSeconds`, written by `EngineRecommendationPanel.tsx`) | `acknowledged_at + holdSeconds`, **capped at `expires_at`** | the action is over when it is over; expiry takes the instruction off the driver's screen mid-action, so it can only ever **shorten** the occupancy, never extend it |
| action states no duration (`speed_guidance`; every command from the manual control-room form, which sends `parameters: {}`) | `expires_at` | nothing in this system measures when such an instruction ends, so its only bound is its own shelf-life. Inventing a duration would put a made-up number under the guardrail this change exists to make honest |

Deliberately **not** part of the definition:

- **Driver acknowledgement.** Ack is when the action STARTS — it is the
  `delivered → executing` edge. Freeing the slot on ack would remove the
  conflicting-command guarantee entirely, which is the one thing the index is
  for.
- **Expiry alone.** `expired` already means "the driver never did it".
  Labelling a served, accepted 20 s hold `expired` at t+120 s would record a
  delivered instruction as undelivered and corrupt every count taken off
  command status.

The arithmetic is total: `control_service_command_finished_at` guards its cast
with `jsonb_typeof(...) = 'number'`, so a string, null, object or absent
`holdSeconds` falls back to `expires_at` instead of aborting the sweep
transaction and stranding every other row in it. Verified for all nine shapes.

**The TTL was not shortened.** That answers a different question — how long an
UNACKED instruction stays on a driver's screen — and shortening it would
truncate long holds on the corridors whose caps already exceed it (240 s
suburban, 600 s inter-city against 120 s). Nothing here touches expiry.

---

## 3. What `cooldown_seconds` actually does once the slot is freed

**MEASURED. At the presets' own operating point: nothing at all. At twice
urban's design density it releases four instructions in nine thousand, and the
cooldown still never fires. There is no behaviour change large enough to size,
and none of it is a regression the flag needs to guard against — but the flag
guards it anyway, because the real network is closer to the boundary than any
preset (§3.3).**

`sim:fleet --command-lifecycle` with and without `--release-on-completion`,
150 buses/phase, 3 seeds × 3 presets (18 runs):

| | |
|---|---|
| runs where any figure differed | **0 of 9 seed×preset pairs** |
| `conflicting_active_command` refusals | **0**, in every run, both settings |
| `cooldown` refusals | **0**, in every run, both settings |

`issued`, `intendedHoldSeconds`, `deliveredHoldSeconds` and `servedHoldSeconds`
are identical to the unit in all nine pairs. Re-run at 500 buses/phase on
urban: still exactly zero of both.

### Why — and it is structural, not a wiring failure

Every station is a control point on all three presets
(`holdingPointCount` is `undefined`, which defaults to `stationCount`), so the
tightest possible gap between two proposals for the same bus is one leg:

| preset | leg | slot held (before fix) | cooldown |
|---|---|---|---|
| urban | **200 s** | 120 s | 60 s |
| suburban | **482 s** | 120 s | 60 s |
| inter-city | **2 286 s** | 120 s | 60 s |

The shortest leg on any preset is 1.7× the slot and 3.3× the cooldown. A
vehicle can only come back inside the old 120 s window when it is delayed far
enough for its stop-to-stop time to more than halve — which needs a crowded
corridor, not merely a busy one. The mechanism itself is live and exercised:
`test/simulation/commandCompletion.test.ts` drives both refusals directly, and
shows the swap from `conflicting_active_command` to `cooldown` at t=30 s after a
20 s hold.

### The positive control: it does engage, at twice the preset's design density

Urban at **1 000 buses/phase** — double `DEFAULT_FLEET_TRIAL_SPEC`'s 500, and
5× the runs above — is the first setting where anything moves at all:

| | proposals | `conflicting_active_command` | `cooldown` | delivered hold-s |
|---|---|---|---|---|
| flag off | 9 072 | **4** | 0 | 441 674 |
| flag on | 9 059 | **0** | **0** | 441 475 |

So four instructions in nine thousand (0.04 %) that the defect refused now get
issued. **`cooldown` is still zero even then**: those four collisions were at
gaps between 60 s and 120 s — inside the old slot, outside the cooldown — so
the guardrail that takes over from the unique index does not, in fact, take
over. On this evidence the cooldown is not merely dominated at the seeded
values; there is no measurable regime on any preset where it binds.

Guardrail effect of those four extra instructions (`passengerSecondsSavedPercent`,
positive means passengers SAVED time), one seed:

| phase | off | on | delta |
|---|---|---|---|
| occupancy-blind | +3.761 % | +3.754 % | −0.007 pts |
| occupancy-aware | +3.673 % | +3.648 % | −0.025 pts |

Both still strongly positive. The direction is slightly negative and it is
flagged rather than welcomed — but this is **one draw at a density outside the
presets' operating point**, and `AGENTS.md` is explicit that a single
`sim:fleet` number is one draw. It is not evidence of harm; it is evidence that
the change is too small to size here.

So `cooldown_seconds` does **not** start refusing holds the system currently
issues, on the presets. That is a negative result, and it is the honest one:
**the presets cannot exercise this defect at all.**

### The real network is closer to the boundary — INFERRED, and worth watching

MEASURED read-only against the live control database: 5 459 observed legs in
`stop_visits` (arrival to previous departure, same vehicle and route-direction).

| p10 | median | p90 | under 120 s | under 60 s |
|---|---|---|---|---|
| 125 s | 720 s | 2 308 s | **8.1 %** | **3.4 %** |

So roughly one real leg in twelve is short enough that a bus could return
within the old 120 s slot, and one in thirty within the 60 s cooldown — against
zero on every preset. INFERRED from there, not measured: on the real network
the cooldown WOULD become reachable for a small minority of legs, where the
presets say it never does. It is a bounded minority and both refusals were
zero everywhere we can currently measure, but the preset result must not be
read as "this flag can never change anything". It should be re-measured on a
real corridor before the flag is turned on in production.

---

## 4. `command_ttl_seconds`: wire it up, do not remove it

The effective 120 s TTL comes from `DEFAULT_TTL_SECONDS = 120`, hardcoded in
**two console files** — `src/components/ops/control-room/ControlRoomCommandForm.tsx`
and `src/components/ops/control-room/console/EngineRecommendationPanel.tsx` —
which put it on the create REQUEST. `route_policies.command_ttl_seconds` (also
120, on all 759 rows) is read by no code in `control-service/src`. Both facts
are true at once: the 120 s is real and the column named after it is not what
produces it.

**Recommendation: WIRE IT UP, in its own task, behind its own flag. Do not
remove it.** Nothing has been done either way here.

The reason is that measurement already says a per-corridor TTL is the dial that
is needed. `AGENTS.md` records that TTL truncation is the mechanism costing
inter-city 14.3 points of excess-wait improvement on 6/6 seeds and suburban
6.7 points: their hold caps are 600 s and 240 s against a 120 s TTL, so a long
hold leaves the driver's screen mid-hold. Urban's cap is exactly 120 and is the
one preset expiry cannot cut. A TTL that varies by corridor is precisely the
fix, and `command_ttl_seconds` is already the column for it. Removing it would
delete the natural home for a change the evidence is already asking for.

It is a separate task because wiring it up changes **when commands expire**,
which is a behaviour change with its own consequences and its own measurement —
exactly the change this task was told not to make in passing.

`ack_timeout_seconds` (30) and `retry_count` (0) are dead for the same reason
and have no comparable evidence behind them; this recommendation does not
extend to them.

---

## 5. Byte-identity at the default

`sim:fleet --vehicles 150 --quiet --out`, this branch vs `origin/simulator-preview`,
all three presets:

- `report.json` **identical** apart from `generatedAt` and `durationMs` (wall
  clock). sha256 of the file with those two lines removed matches exactly.
- `lawCoverage`: 3 blocks per preset, **identical**.
- per-scenario `contrast`: 43 blocks per preset, **identical**.

With the flag off the completion job is not registered, nothing calls the
functions the migration creates, and no command status changes. Applying the
migration alone changes no behaviour at all.
