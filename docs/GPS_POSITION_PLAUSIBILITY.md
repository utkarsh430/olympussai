# A fresh fix is not the same thing as a true one

`GPS_POSITION_PLAUSIBILITY_ENABLED`, default **false**.
Code: `control-service/src/state-estimation/positionPlausibility.ts`.
Wired at `state-estimation/ordering.ts`, `headway/service.ts` (production) and
`rehearsal/deployedControlLaws.ts` (the fleet trial's control path).

## The gap, and why it is not the one the guards already cover

`mpc/safety.ts` refuses to command a vehicle whose reading is STALE.
`state-estimation/confidence.ts` flags one whose map match is weak. Nothing
anywhere refuses a fix that is fresh, well-formed, self-consistent and simply
WRONG — the failure `simulation/types.ts#Disturbance`'s `gps_bias` models, and
the one `AGENTS.md` already records as unguarded.

Priced, in the weak-scenarios report §4: on `blind_slowdown` a constant 22.6 km
along-route offset on a fifth of the fleet costs **4.1 points** of excess-wait
gain on inter-city, 10.5% of all decisions have one end of the pair lied about,
and a hold decided while the deciding bus's own reported position is that wrong
is worth **0.57% per 100 hold-seconds against 3.85% for a hold chosen at
random**.

**It had to be a correction, not a refusal, and that is now measured twice.**
The report measured it once (suppressing every hold on a suspect pair recovers
none of the loss and costs a further 1.9 points). This work measures it again
through a different mechanism — see the `exclude` column below. Dropping a
rejected vehicle from the chain drops it from control too, and it is worse than
doing nothing on five of the nine corridor/scenario cells, unchanged on two,
and **never once better than correcting the position**.

## The instrument

Two pieces, answering two different questions.

**A two-sided CUSUM over unexplained displacement — this DETECTS.** Per sample:
how far the vehicle says it moved, minus how far its own reported speed (or,
when it reports none, the corridor's pace) says it could have, accumulated with
a per-sample noise allowance subtracted. A CUSUM rather than a per-sample jump
test because a drift's per-sample error is inside any honest noise allowance by
construction — `scenarios.ts` sizes `phantom_position` deliberately so.

**A dead-reckoned belief — this CORRECTS, and it is the only thing that can end
a rejection.** Propagated from the vehicle's own reported speed since its last
plausible fix, so it is independent of the quantity under suspicion. A vehicle
stays rejected until its reported fix comes back to agree with the belief.
Without that second half the detector is defeated by `blind_slowdown` by
construction: a constant offset produces one jump and then looks perfectly
stable, which is what the scenario was built around.

**The bound is in SECONDS, not metres.** A metre bound fitted on one corridor is
this repo's commonest error; the presets alone span an order of magnitude of
pace and the real network's headways run 300–12,497 s. So the threshold is
travel time at the corridor's own pace, which is scale-free and is one number to
sweep.

**A sample nobody can judge is PLAUSIBLE, never suspect.** No reported speed and
no corridor pace to borrow, a first sighting, or a gap in the feed too long to
infer across — all re-anchor the belief and reject nothing. That is the
control-side mirror of the null-risk and null-forecast rules already in
`AGENTS.md`: a feed nobody can check has not been caught lying.

## What it is measured to do

Method: the harness's own `runScenario`, driven through a probe that replicates
`runFleetTrial`'s phase-1 loop exactly — same corridor build, same `BUS-nnnn`
counter advanced across every scenario whether or not it is run (vehicle ids
hash into the RNG stream key), same per-scenario seed `spec.seed + index*7919`.
Six paired seeds on the harness's own spacing convention, 2,000 buses/phase,
occupancy-blind. **The probe reproduces the weak-scenarios report's own
inter-city `blind_slowdown` baseline to the digit: 20.77% against its 20.8%, and
the bias ablation lands at 24.86 against its 24.9.**

`ceiling` is the same day with the scenario's `gps_bias` disturbances removed —
the most any estimator fix could recover. `%ceil` is the share of that recovered.
`ag` is seeds agreeing with the sign, and by this repo's own rule a mean whose
seeds disagree is no effect however large.

| corridor | scenario | off | ceiling | `correct` | `exclude` | delta correct | seeds | %ceil | delta guardrail | seeds |
|---|---|---|---|---|---|---|---|---|---|---|
| urban | `blind_slowdown` | 47.87 | 59.40 | 55.13 | 40.25 | **+7.26** | 6/6 | 63% | +0.85 | 6/6 |
| urban | `phantom_position` | 50.34 | 63.96 | 50.34 | 50.34 | **+0.00** | 0/6 | 0% | +0.00 | 0/6 |
| urban | `frozen_feed` | 60.18 | 66.27 | 60.04 | 59.24 | **-0.14** | 3/6 | -2% | +0.04 | 3/6 |
| suburban | `blind_slowdown` | 33.02 | 44.18 | 41.77 | 30.65 | **+8.75** | 6/6 | 78% | +0.56 | 6/6 |
| suburban | `phantom_position` | 42.08 | 57.04 | 42.11 | 42.11 | **+0.03** | 4/6 | 0% | +0.00 | 2/6 |
| suburban | `frozen_feed` | 51.17 | 59.29 | 53.54 | 49.07 | **+2.38** | 4/6 | 29% | +0.12 | 3/6 |
| intercity | `blind_slowdown` | 20.77 | 24.86 | 20.84 | 20.60 | **+0.07** | 4/6 | 2% | +0.03 | 4/6 |
| intercity | `phantom_position` | 23.80 | 29.57 | 23.80 | 23.80 | **-0.00** | 1/6 | -0% | +0.00 | 1/6 |
| intercity | `frozen_feed` | 26.50 | 32.60 | 28.38 | 26.85 | **+1.88** | 6/6 | 31% | +0.08 | 6/6 |

**Read three things off that table.**

**One: the correction works, and it works where control works.** On
`blind_slowdown` it recovers 63% of the ceiling on urban and 78% on suburban,
6/6 seeds on the headline AND 6/6 on the guardrail — total passenger time
improves alongside excess wait, so this is not a trade. On inter-city it
recovers 2%, and the interval spans zero.

**Two: `exclude` is worse than doing nothing.** Dropping a rejected vehicle from
the chain also drops it from control, and that costs 7.6 points on urban against
the 7.3 the correction gains — a 15-point swing between the two shapes of the
same detection, off exactly the same set of rejected vehicles. It is never
better than `correct` on any cell. This reproduces the report's §4d finding by a
different route and is why `correct` is the default and `exclude` is kept only
as the measured comparison.

**Three: it does NOT generalise to `phantom_position`, and that is a negative
result worth carrying.** The scenario's drift is sized by its author to sit
inside the noise the laws already tolerate ("less and the lie is inside the
noise… more and it is so large that a plausibility check nobody has written
would catch it"), and at the shipping bound the check catches none of it and
moves nothing, on any corridor. `frozen_feed` is a real but small effect on
inter-city only (+1.88, 6/6, guardrail +0.08, 6/6); on urban and suburban its
seeds disagree.

## The risk, measured: how many HEALTHY vehicles the bound excludes

This is the reason the flag ships off. A bound set too tight excludes healthy
vehicles from the pace median and the chain ranking, which is a subtler failure
than the one being fixed — a controller measuring honest buses against a chain
missing some of them is harder to notice than one measuring them against a
phantom.

Healthy vehicles excluded at least once, out of every vehicle the scenario did
NOT lie about, pooled over six seeds:

| corridor | 30 s | 60 s | 120 s | 240 s | 480 s |
|---|---|---|---|---|---|
| urban | 38/1542 (2.5%) | 11/1542 (0.7%) | 2/1542 (0.1%) | 1/1542 (0.1%) | 0/1542 (0.0%) |
| suburban | 649/1542 (42.1%) | 45/1542 (2.9%) | 2/1542 (0.1%) | 0/1542 (0.0%) | 0/1542 (0.0%) |
| intercity | 1143/1542 (74.1%) | 623/1542 (40.4%) | 7/1542 (0.5%) | 0/1542 (0.0%) | 0/1542 (0.0%) |

On corridors with no lie in them at all — six paired seeds each of
`steady_variability` and `traffic_shock`, 1,272 healthy vehicle-runs per
corridor:

| corridor | healthy vehicles excluded | cells bit-identical to the flag being off | delta EWT |
|---|---|---|---|
| urban | 3/1272 (0.24%) | 11/12 | -0.26 |
| suburban | 1/1272 (0.08%) | 12/12 | +0.00 |
| intercity | 8/1272 (0.63%) | 11/12 | -0.02 |

**120 s is the knee and that is why it is the default.** Below it the check buys
nothing extra and the false-exclusion rate explodes on the long corridors — at
30 s it excludes 42% of healthy suburban vehicles and 74% of healthy inter-city
ones. Above it, detection collapses: at 480 s the correction is bit-identical to
the flag being off on urban.

**The one false exclusion that mattered is the honest number to quote.** On a
bias-free corridor the check is bit-identical to the flag being off on 34 of 36
seed-cells. It excluded 12 healthy vehicles in 3,816 vehicle-runs, and on
exactly one of those days — urban `steady_variability`, seed 20784467, one
vehicle in 106 — that single exclusion cost **3.1 points of excess wait and 0.21
of guardrail**. That is the subtle failure the flag exists to be careful about,
observed: one healthy bus taken out of the pace median and the chain ranking is
not a rounding error on the day it happens.

## The one lever left, and its price

`maxSampleGapSeconds` (300 s) is what limits inter-city, and it is the one
parameter here that is NOT corridor-scaled. Beyond it the tracker infers nothing
and re-anchors — which, on a fix that is currently lying, adopts the lie.
Inter-city's decisions are further apart than urban's, so most of its samples
re-anchor and the check catches 11–14 of 21 biased buses instead of 21.

| corridor | scenario | delta EWT @ 300 s (seeds) | delta EWT @ 900 s (seeds) | delta EWT @ 3600 s (seeds) | healthy excluded @900 |
|---|---|---|---|---|---|
| urban | `blind_slowdown` | +7.26 (6/6) | +7.26 (6/6) | +7.26 (6/6) | 2/504 (0%) |
| suburban | `blind_slowdown` | +8.75 (6/6) | +9.29 (6/6) | +9.29 (6/6) | 4/504 (1%) |
| intercity | `blind_slowdown` | +0.07 (4/6) | +2.44 (6/6) | +2.31 (6/6) | 52/504 (10%) |

And here is what that costs, measured on the same corridors with no lie in them:

| corridor | healthy excluded @300 s | @900 s | delta EWT on a bias-free corridor @900 s |
|---|---|---|---|
| urban | 3/1272 (0.24%) | 3/1272 (0.24%) | -0.26 (11/12 cells identical) |
| suburban | 1/1272 (0.08%) | 6/1272 (0.47%) | +0.05 (9/12 identical) |
| intercity | 8/1272 (0.63%) | **117/1272 (9.20%)** | **-0.92 (0/12 identical)** |

Raising it to 900 s catches 125 of 126 biased buses on inter-city instead of 73,
and turns +0.07 into +2.44, 6/6 seeds, with the guardrail neutral.

**And it is measured to be a bad trade, not merely a risky one.** The same
change takes inter-city's false-exclusion rate from 0.63% to 9.20% and costs
**0.92 points of excess wait on inter-city corridors with no GPS problem at
all** — where 300 s leaves eleven of twelve of those seed-cells bit-identical,
900 s leaves none of them unchanged and none of them better on balance. So the
2.44 points it buys on the one scenario that lies are paid for out of every
ordinary day, and inter-city runs far more ordinary days than lying ones.

300 s stays. What the number really says is that `maxSampleGapSeconds` is the
one parameter here that is NOT corridor-scaled, and the next move on inter-city
is to derive it from the corridor's own headway rather than to raise a constant
— not to take this trade.

## Reproducing

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"   # AGENTS.md: CI pins 20.x
cd control-service && pnpm install
export CONTROL_SERVICE_DATABASE_URL='postgresql://sim:sim@127.0.0.1:1/simnodb'
export SERVICE_TOKEN_SECRET='0123456789abcdef0123456789abcdef'
export WEBHOOK_HMAC_SECRET='0123456789abcdef0123456789abcdef'

# byte identity at the default, all three presets
pnpm sim:fleet --corridor urban --vehicles 200 --out <dir> --quiet
```

The probe that produced the tables lives under `control-service/experiments/runs/`
(gitignored, derived). It needs `runScenario`, `ScenarioRun` and `scaleInputs`,
which are exported from `fleetTrial/run.ts` for exactly this purpose; the report
the trial publishes still comes from `runFleetTrial`.

## Byte identity at the default

`pnpm sim:fleet --vehicles 200` on all three presets, this branch against
`origin/simulator-preview`: every field of `report.json` identical — `lawCoverage`
and every per-scenario `contrast` included — except `generatedAt` and
`durationMs`, which are wall-clock provenance.

With the flag off no tracker is constructed, no vehicle ever carries
`VehicleOrderingInput.isImplausiblePosition`, and every distance handed to
`computeLeaderFollowerOrder` is the reported one.

## One thing to know before turning it on in production

In `headway/service.ts` the corrected position feeds the whole sweep, so the
BUNCHING DETECTOR sees it too, not only the control laws. That is deliberate and
it is the same argument — a corridor whose incidents are opened against a
phantom leader is measuring the wrong gap — but it means flipping this switch
changes what operators are alerted about as well as what the controller does,
which is the trap `mpc/actionThreshold.ts` records about moving
`warning_threshold_ratio`. The fleet trial cannot see that half: its detector
arm (`fleetTrial/detection.ts`) builds its own chain and is deliberately left
alone here, so every number above is about the control path only.
