# The self-harm check switches the controller off. It ships DISABLED.

`SELF_HARM_CHECK_ENABLED` (default `false`). Code: `control-service/src/mpc/selfHarmCheck.ts`.

> **The finding, first.** Giving the four unguarded control laws the same
> self-harm check `cost_optimal` has does not trim harmful holds — it stops the
> controller holding at all. With occupancy weighting on, two of three corridors
> issue **zero** instructions on every seed and urban's passenger-time benefit
> falls from **+4.69% to +0.02%**. The `+1,021.4` passenger-second figure that
> motivated this work is real, but it means **the objective is wrong, not that
> the controller is doing harm** — those same holds are measured to save
> passengers time. The check is shipped default-OFF as an instrument and a
> record, not as a fix. The real fix is a multi-stop wait term.

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
| urban | **+1,021.4** passenger-seconds |
| suburban | **+1,874.0** |
| inter-city | **+4,271.4** |

(The brief that prompted this work quoted +1,028.8 / +1,744.6 / +4,008.0, measured
before `warning_threshold_ratio`'s effective mid-route bar moved from 0.5 to 0.6.
The figure is a property of the objective, not of the bar, and it did not move.)

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

| corridor | total pax time (guardrail) | EWT gain | holds issued | seeds worse |
|---|---|---|---|---|
| urban | **+4.69% → +0.02%** | 58.5% → 0.1% | 2,086 → 3 | **3 / 3** |
| suburban | **+1.21% → +0.00%** | 42.6% → 0.0% | 1,304 → **0** | **3 / 3** |
| inter-city | **+0.23% → +0.00%** | 18.0% → 0.0% | 1,011 → **0** | 2 / 3 |

The check does not trim harmful holds. It **stops the controller holding at
all**: two corridors issue literally zero instructions across every seed, and
urban issues two or three. Every measured benefit — excess wait, bunching,
incidents avoided — goes to zero with them. `lawCoverage` on urban: `two_way`
3,325 → 3 generating decisions, `self_equalizing` 172 → 0.

Inter-city's third seed is the only cell in the whole matrix where the check
does not lose, and it is not a win: that seed's controlled arm was fractionally
negative (−0.10%) and the check moved it to exactly 0.00% by doing nothing at
all. Inter-city sits at `controllability` 0.19, `too_disturbed`, where AGENTS.md
says a working controller correctly reports no effect.

### Occupancy weighting OFF — a real trade, and the wrong way round

| corridor | total pax time | seeds worse | EWT gain (headline) | holds |
|---|---|---|---|---|
| urban | +4.20% → **+4.53%** | 0 / 3 | **55.8% → 53.4%** | 1,839 → 868 |
| suburban | +0.97% → **+1.24%** | 0 / 3 | **43.3% → 39.0%** | 1,102 → 440 |
| inter-city | +0.27% → +0.32% | 2 / 3 | 24.9% → 24.6% | 871 → 426 |

Reported plainly because it does not go the way the rest of this document goes:
on urban and suburban the guardrail **improves**, by +0.34 and +0.27 points, and
all three seeds agree on the sign. Inter-city's seeds disagree, so that column is
no effect.

It is still the wrong trade, for two reasons.

1. **The guardrail is a constraint, not the objective.** AGENTS.md: EWT is the
   headline and total passenger time is a GUARDRAIL — it exists to stop a
   setting buying spacing with everybody's time. It was already comfortably
   satisfied at +4.20% / +0.97% without the check. Spending 2.5 and 4.3 points
   of the headline to raise an already-satisfied guardrail by a third of a point
   is optimising the tripwire instead of the target.
2. **It halves the holds to get there.** 1,839 → 868 and 1,102 → 440. That is
   the same shutdown as the occupancy-on column, just not yet complete.

### And it silences Algorithm A completely, in every cell

## The deployed configuration is unchanged

The switch defaults off, and off is a no-op rather than a near-no-op. Proven by
running the fleet trial on all three corridors from the tree BEFORE any of this
landed and from the tree AFTER, at the default setting, and comparing
`lawCoverage`, `contrast`, `holdCountByActionType`, `occupancyContrast` and the
whole report (minus timestamps):

```
urban
  IDENTICAL  lawCoverage
  IDENTICAL  contrast
  IDENTICAL  holdCountByActionType
  IDENTICAL  occupancyContrast
  IDENTICAL  whole report (minus timestamps)
   occupancy_blind  lawCoverage terminal_dispatch=417 two_way=3326 self_equalizing=179 cost_optimal=477 boarding_limit=305
                    totalPaxTime 3.83%  EWT 59.7%
   occupancy_aware  lawCoverage terminal_dispatch=419 two_way=3325 self_equalizing=172 cost_optimal=0 boarding_limit=268
                    totalPaxTime 4.40%  EWT 56.7%

suburban
  IDENTICAL  lawCoverage
  IDENTICAL  contrast
  IDENTICAL  holdCountByActionType
  IDENTICAL  occupancyContrast
  IDENTICAL  whole report (minus timestamps)
   occupancy_blind  lawCoverage terminal_dispatch=421 two_way=1110 self_equalizing=48 cost_optimal=358 boarding_limit=83
                    totalPaxTime 0.79%  EWT 44.5%
   occupancy_aware  lawCoverage terminal_dispatch=420 two_way=1252 self_equalizing=64 cost_optimal=0 boarding_limit=78
                    totalPaxTime 1.55%  EWT 44.0%

intercity
  IDENTICAL  lawCoverage
  IDENTICAL  contrast
  IDENTICAL  holdCountByActionType
  IDENTICAL  occupancyContrast
  IDENTICAL  whole report (minus timestamps)
   occupancy_blind  lawCoverage terminal_dispatch=416 two_way=968 self_equalizing=37 cost_optimal=514 boarding_limit=56
                    totalPaxTime 0.62%  EWT 27.0%
   occupancy_aware  lawCoverage terminal_dispatch=405 two_way=1058 self_equalizing=32 cost_optimal=0 boarding_limit=77
                    totalPaxTime 0.26%  EWT 16.0%

PROOF HOLDS: the deployed configuration is unchanged on all three corridors.
```

Nothing about what the controller does today moves. The only new cost when the
switch is off is one boolean read per solve.

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
