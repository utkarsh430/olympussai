# The self-harm check, and why it ships OFF

`SELF_HARM_CHECK_ENABLED` (default `false`). Code: `control-service/src/mpc/selfHarmCheck.ts`.

## The question

`mpc/costOptimalHold.ts` is the only one of the five control laws that scores its
own proposed action against the passenger-cost objective and refuses to emit one
that objective prices as harmful:

```ts
if (score.objectiveCost >= 0) continue;
```

The other four — `terminal_dispatch`, `two_way`, `self_equalizing`,
`boarding_limit` — price their candidate through the same
`objective.ts#computePassengerCost` and then emit it whatever the answer.

That gap is not hypothetical. With occupancy weighting ON, the mean
`objectiveCost` of the candidates the controller actually **selects** is

| corridor | `occupancyContrast.meanObjectiveCostAware` |
|---|---|
| urban | **+1,028.8** passenger-seconds |
| suburban | **+1,744.6** |
| inter-city | **+4,008.0** |

Those selected candidates are exactly these four laws' holds, because
`COST_OPTIMAL_SELECTION_ENABLED` defaults false, so the one law that *would*
have declined is never selected. On its own reading, the controller is issuing
thousands of instructions it scores as net harmful.

So: give the other four laws the same check. Measured, across all three corridor
presets, both occupancy phases and three seeds each.

## The answer: no. It switches the controller off.

**Total passenger time is the guardrail** (`AGENTS.md`). Positive = passengers
save time. Paired by seed, `sim:fleet` at the default 250 buses/phase.

### Occupancy weighting ON — unanimous, and catastrophic

| corridor | total pax time | EWT gain | holds issued | seeds worse |
|---|---|---|---|---|
| urban | **+4.04% → +0.02%** | 47.1% → 0.1% | 1,560 → 3 | **3 / 3** |
| suburban | **+1.18% → +0.00%** | 35.3% → 0.0% | 1,049 → 0 | **3 / 3** |
| inter-city | **+0.30% → +0.00%** | 14.1% → 0.0% | 888 → 0 | **3 / 3** |

The check does not trim harmful holds. It **stops the controller holding at
all**: two corridors issue literally zero instructions across every seed, and
urban issues three. Every measured benefit of the controller — excess wait,
bunching, incidents avoided — goes to zero with it. `lawCoverage` on urban:
`two_way` 2,110 → 3 generating decisions, `self_equalizing` 60 → 0.

### Occupancy weighting OFF — no guardrail gain, and the headline gets worse

| corridor | total pax time | seeds worse | EWT gain (headline) | holds |
|---|---|---|---|---|
| urban | +3.82% → +4.01% | 1 / 3 | **47.5% → 45.1%** | 1,332 → 656 |
| suburban | +0.88% → +1.09% | 0 / 3 | **36.4% → 33.5%** | 855 → 340 |
| inter-city | +0.23% → +0.23% | 1 / 3 | **20.5% → 20.0%** | 764 → 340 |

The passenger-time means move up slightly, but the seeds **disagree on two of
three corridors**, and `AGENTS.md` is explicit: treat a mean whose seeds disagree
as no effect however large it is. Against that non-effect the check halves the
holds and costs 0.5–2.9 points of excess-wait gain — the headline — on every
corridor, on every seed but one. It is a bad trade even where it is not a loss.

### And it silences Algorithm A completely, in every cell

`terminal_dispatch` holds, base → check, all 18 runs:

```
urban     400/401/394 → 0    aware 408/386/404 → 0
suburban  400/397/391 → 0    aware 404/390/401 → 0
intercity 376/367/363 → 0    aware 373/360/375 → 0
```

**18 of 18, and independent of the occupancy switch.** Terminal dispatch is the
one lever with no punctuality cost at all — the bus has not started its trip and
nobody is aboard to be delayed — and the literature and the CTA pilots both put
it first. The objective still charges `w_c` for standing still at the origin
against a wait term it can barely see, so a terminal hold prices `>= 0`
essentially always. This is the clearest single sign that the check is measuring
the objective's error and not the action's harm.

## Why it fails: the check inherits an objective with the wrong sign

None of this is a surprise, and it is not the check's arithmetic. `HANDOFF.md`
section 7 measured the objective term by term over 20,423 urban holds:

- the **cost** side is accurate to about 17%;
- the **benefit** side sees **1.4%** of the waiting time a hold actually removes
  (10% with a correctly fitted lambda);
- so on urban the objective says control **costs** 7,768 h where it in fact
  **saves** 6,466 h — the wrong sign, on the corridor where the controller works.

The residual after calibration is the **horizon**, not the rate:
`lambda x d x (d + h_fwd - h_bwd)` is a ONE-STOP marginal estimate of a benefit
that accrues along twenty-five downstream stops and to every following bus.

A guard keyed to that number does not decline harmful holds. It declines holds
whose benefit the objective cannot see — which is nearly all of them. The
occupancy-aware phase is worse only because the load term makes the visible cost
larger, not because those holds are worse: measured, they are the holds that
deliver +4.04% of passenger time.

This is the same reasoning `config/env.ts#COST_OPTIMAL_SELECTION_ENABLED` already
records, and the fact that the two knobs fail for one reason is the point. The
argmin of the objective and the sign test on the objective are the same bet.

## `boarding_limit` cannot take this check at all

Its `objectiveCost` is a hardcoded `0` — a documented placeholder, not a netted
figure. Its cost (passengers left standing) needs lambda; its benefit (the dwell
the leader sheds) needs a fitted dwell model no corridor has. Zero there means
*nobody has measured this*.

`>= 0` is true of zero, so applying the predicate would decline **100%** of
alighting-only proposals on every corridor forever — deleting a law on the
strength of a sentinel. That is not the protection `cost_optimal` has; it is a
different thing wearing its name. The law therefore takes no flag, and
`test/selfHarmCheck.test.ts` pins that so a later reader cannot "finish the job".

## What would make this shippable

Not a calibrated lambda — measured, that moves the wait term from 1.4% of the
truth only to 10%. What is needed is a **multi-stop wait term**, so the
objective's predicted benefit matches a measured one. Then re-run all three
corridors, both phases, several seeds, before and after — and flip this knob and
`COST_OPTIMAL_SELECTION_ENABLED` together, since they rest on the same bet.

Until then the honest state is the one this switch records: the controller is
issuing holds its objective calls harmful, the objective is wrong about that, and
we can now measure exactly how wrong by flipping one flag.

## Reproducing

```sh
cd control-service
for c in urban suburban intercity; do
  for s in 101 202 303; do
    SELF_HARM_CHECK_ENABLED=false pnpm sim:fleet --corridor $c --seed $s --out runs/base-$c-$s --quiet
    SELF_HARM_CHECK_ENABLED=true  pnpm sim:fleet --corridor $c --seed $s --out runs/check-$c-$s --quiet
  done
done
```

Read `phases[].contrast.passengerSecondsSavedPercent` (the guardrail),
`phases[].lawCoverage` and `phases[].holdCountByActionType`. Needs no database;
`src/config/env.ts` validates at import, so set `CONTROL_SERVICE_DATABASE_URL`,
`SERVICE_TOKEN_SECRET` and `WEBHOOK_HMAC_SECRET` to any syntactically valid
values — nothing connects.
