# Corridor eligibility: where the controller can work

    pnpm --dir control-service sim:eligibility
    pnpm --dir control-service sim:eligibility --out experiments/runs/eligibility
    pnpm --dir control-service sim:eligibility --travel-time-variation 0.20 --verdict out_of_band
    pnpm --dir control-service sim:eligibility --help

Read-only, alongside `sim:run` and `sim:fleet`. It answers one question per
route-direction — should the controller be deployed on this corridor at all —
and it changes nothing on its own.

## The finding it acts on

The fleet trial runs the SAME laws on three corridor shapes and gets three
different answers (`docs/FLEET_TRIAL.md`, six seeds each):

| corridor | planned headway | total passenger time |
| --- | ---: | ---: |
| urban | 6 min | **+2.9%** ± 0.3 (6/6 seeds positive) |
| suburban | 12 min | **+0.5%** ± 0.3 (6/6) |
| inter-city | 30 min | **0.0%** to within ± 0.5 |

The algorithm is identical on all three. What separates them is
`control-service/src/lib/controllability.ts`'s **sigma_leg / H\***: how much
running-time deviation accumulates between two stops as a fraction of the
headway a hold at either of them is protecting. Below ~0.03 nothing comes
apart; above ~0.16 more accumulates between two stops than a hold at either can
remove. This network's **median planned headway is 1,800 s**, which is the
inter-city regime.

A corridor under active control is not free: it costs dispatcher attention,
driver instructions and control-room load whether the holds help or not. So
running outside the band is full operational effort for no return — and
`DECISION_CYCLE_BATCH_SIZE` is 60 against an eligible set larger than that, so
those slots are taken from corridors that could have benefited. The decision
cycle already logs its own "some corridors wait extra cycles" warning.

## The verdict

Three independent refusals, in `control-service/src/evaluation/eligibility.ts`.
They fail for different reasons and an operator has a different remedy for each:

| verdict | means | remedy |
| --- | --- | --- |
| `uncalibrated` | no measured target headway (`calibration_source` is `none`/`default`) | calibrate H\*; already refused upstream by `MEASURED_POLICY_PREDICATE` |
| `too_few_vehicles` | fewer than 2 live vehicles, so no leader/follower pair | a scheduling fact, not a deployment decision |
| `out_of_band` | outside `CONTROLLABLE_BAND` | **none — this is the finding** |
| `eligible` | calibrated, in band, carrying a pair | control it |

**The band is not defined here.** `CONTROLLABLE_BAND` (0.03–0.16) and
`assessControllability` are imported from `lib/controllability.ts`, where they
were fitted; `test/evaluation/eligibility.test.ts` asserts this module answers
on those exact bounds rather than on a second copy that could drift from them.

## Measured against the seeded network

Snapshot `2026-09-06T09:00:54Z`, live-vehicle window 300 s, modelled inputs
(cruise 35 km/h, variation 0.12). The vehicle-dependent rows move as buses
report, so re-run rather than quoting these.

| verdict | corridors | share | vehicles |
| --- | ---: | ---: | ---: |
| `eligible` | 52 | 6.9% | 274 |
| `out_of_band` | 26 | 3.4% | 125 |
| `uncalibrated` | 561 | 73.9% | 667 |
| `too_few_vehicles` | 120 | 15.8% | 37 |

Of the 198 corridors with a measured H\*: 132 `controllable`, 38 `too_regular`,
28 `too_disturbed`.

### What the gate would exclude

The gate sits inside the decision cycle and sees only corridors that sweep
already accepts, so the **band is the only thing it removes**:

- Corridors the decision cycle reaches today: **78**
- Of those, outside the band: **26 (33.3%)**
- Vehicles on the excluded corridors: **125 of 399**
- Recommendations in the last 720 h that would not have been written:
  **8 of 33 (24.2%)**

Corridor share and recommendation share differ (33.3% against 24.2%) because
the corridors the gate excludes are disproportionately quiet ones. Report both;
neither alone is the answer.

## Read the provenance line before the verdicts

sigma_leg is `meanLeg / cruiseSpeed x travelTimeVariation`. The geometry and
H\* are measured. **The other two are not**, on this network: `stop_visits` is
empty, so nothing has been fitted and both come from
`rehearsal/run.ts#DEFAULT_MODELLED_INPUTS` (35 km/h, 0.12). Every row in the
report carries `inputs_provenance`, and it currently reads `modelled` for all
759.

That matters because the verdict is sensitive to the assumption. From the
report's own sensitivity table on the same snapshot:

| travelTimeVariation | too_regular | controllable | too_disturbed |
| ---: | ---: | ---: | ---: |
| 0.06 | 77 | 121 | 0 |
| 0.09 | 55 | 128 | 15 |
| 0.12 (default) | 38 | 132 | 28 |
| 0.16 | 29 | 111 | 58 |
| 0.20 | 17 | 103 | 78 |
| 0.30 | 10 | 76 | 112 |

The in-band count is fairly stable (103–132 over a 5x span of the assumption)
but WHICH corridors are in it is not, and `too_disturbed` moves from 0 to 112.

`--calibrate` derives both inputs per corridor from that corridor's own fitted
link travel times (`evaluation/calibrate.ts` → `calibration/linkTravelTime.ts`):
cruise speed is total fitted leg distance over total fitted leg time, variation
is the mean of each leg's stddev/mean. A corridor with fewer than half its legs
fitted keeps the modelled inputs and says so — the same bar, and the same
reason, as `calibrate.ts#MIN_CALIBRATED_STOP_SHARE`.

## The gate, and why it ships off

`DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED` (`control-service/src/config/env.ts`),
default `false`. On, `runDecisionCycle` filters the eligible set to in-band
corridors **before the batch is cut** — filtering afterwards would still spend
the batch's 60 slots on corridors holding cannot help.

Three properties, each pinned by `test/decisionCycleEligibilityGate.test.ts`:

- **Off is a true no-op.** With the flag unset the cycle does not merely behave
  the same, it never issues the band query at all.
- **It fails open.** A database hiccup logs and runs on everything, which is
  today's behaviour. A gate that failed closed would silence the controller
  network-wide.
- **It decides nothing about HOW.** No control law is consulted or changed.
  This chooses WHERE the controller runs, not how it decides.

**It is off because the band is currently an assumption.** Turning it on would
stop the controller answering on 26 real corridors on the strength of two
numbers nobody measured. Until `sim:eligibility` reads `measured` provenance for
the corridors it would exclude, treat this as a **rollout priority order** —
control the in-band corridors first — and not a licence to switch corridors off.

Precondition for flipping it: fill `stop_visits` (see `AGENTS.md` on splitting
`gps_approach` from `gps_geofence` first), confirm the report reads `measured`,
and re-read the excluded set by name.
