# The origin's backward gap, and the objective's second placeholder

Two changes to `mpc/objective.ts`, and what measuring them says about the
objective's sign.

1. **`ORIGIN_BACKWARD_NEUTRAL_ENABLED`**, default **off**. At an origin the
   neutral value substituted for an unobserved bus behind is anchored to the
   leader's departure rather than to the standing vehicle, which is what stops
   an unclamped terminal hold pricing at exactly zero.
2. **A seam for a measured arrival rate.** `PassengerCostInputs.measuredArrivalRatePaxPerSecond`,
   null everywhere, priced as the `1/H*` proxy when absent. Nothing supplies
   one; `oly-calibrate-real` is fitting it.

Read `docs/MULTI_STOP_WAIT_TERM.md` first. It diagnoses both of these and this
file is the follow-through, including the two places where the follow-through
does **not** land where that document expected.

---

## 1. The terminal defect, and the derivation that fixes it

`computePassengerCost` substitutes a neutral `h_bwd` when nothing is observed
behind. The mid-route neutral is `h_bwd = H*`. An unclamped terminal hold is
`d = H* - h_fwd`, so the objective's bracket is

```
d + h_fwd - h_bwd  =  (H* - h_fwd) + h_fwd - H*  =  0,  exactly.
```

Under that substitution the hold does not even the two gaps, it **swaps** them:
`(h_fwd, H*)` becomes `(H*, h_fwd)`, whose second moment is identical.

**The mistake is the anchor, not the value.** Mid-route, `h_fwd` is a closing
time measured from the deciding vehicle and nothing is known about the one
behind, so "one target headway back from where this bus is" applies no pressure
either way and is genuinely neutral. At an origin `h_fwd` is elapsed time since
the leader pulled out — a fixed, already-observed instant that this hold cannot
move — and the bus behind has not departed at all.

Anchored there, the neutral claim is that the departures either side of this one
fall on target, i.e. the next departure lands two target headways after the
leader's:

```
h_bwd = 2 x H* - h_fwd
```

which is the same sentence as "one target headway after where this bus *should*
depart", `H* + (H* - h_fwd)`. Checked against the physics rather than against
itself: the gaps go `(h_fwd, 2H* - h_fwd)` -> `(h_fwd + d, 2H* - h_fwd - d)`,
and at the on-target hold that is `(H*, H*)` — evened, not swapped. Writing
`x = H* - h_fwd`, the second moment falls from `2H*^2 + 2x^2` to `2H*^2`, so the
wait term is `-w_h x lambda x d^2`: a benefit, quadratic in the hold, zero only
for a zero hold. It is also what `optimalHoldSeconds` returns under the same
anchor — `H* - h_fwd`, which is terminal dispatch's own rule, rather than the
half of it the `'vehicle'` anchor gives.

**No fitted constant.** `2 x H*` is the target the law already regulates.
`mpc/actionThreshold.ts`'s docblock records why this codebase declines fitted
coefficients, and the multi-stop horizon declined a fitted decay for the same
reason. The substitution is clamped at 0 — a leader that departed more than two
target headways ago leaves genuinely no slack behind — and it self-polices an
overshoot, because the bracket `d - 2x` turns positive once the hold pushes the
forward gap past what the backward one becomes.

---

## 2. Method

`19 bunching scenarios x 3 seeds (501-503) x 120 vehicles per phase`,
`followerSpeedSource: 'vehicle_state'`, all three corridor presets, both
occupancy phases, the DEPLOYED laws through `rehearsal/deployedControlLaws.ts`.
Base `2a45cc1`.

Candidate-level figures come from a probe that mirrors
`fleetTrial/run.ts#runScenario` on the exported surface and copies the three
internals it does not export (`scaleInputs`, `buildTrialScenario`,
`timetableFromRun`) verbatim — the practice `docs/MULTI_STOP_WAIT_TERM.md`
section 10 already documents. Trial-level figures come from `runFleetTrial`
directly.

A **fitted lambda** column is a probe, not shipped: each candidate's wait term
re-scaled by `lambda_true x H*`, with `lambda_true` the corridor's own modelled
boarding rate (urban 1.2/min, suburban 0.75/min, inter-city 0.38/min). Two
readings of it are reported and section 5 is about why.

Re-pricing off-line is exact here, and that is measured rather than assumed:
**`rankedCandidateCount > 1` on 0 of the decisions in every run**, so no change
to a price can reorder a selection. The mid-route laws are mutually exclusive,
terminal dispatch has absolute priority, and the two knobs that would let a
price gate anything (`SELF_HARM_CHECK_ENABLED`, `COST_OPTIMAL_SELECTION_ENABLED`)
are off.

**Not comparable to `docs/MULTI_STOP_WAIT_TERM.md`'s absolute levels**, in two
specific ways a reader should not trip over.

- That document was measured at `31ed5e1`, before `2a45cc1` scoped the headline
  to the scenarios control can affect. `phase.contrast` is now a different pool,
  so guardrail and headline levels here are lower and the two sets of numbers
  should not be differenced. Every comparison below is before/after **within**
  this base.
- Its section 4 objectiveCost figures appear to exclude the punctuality term.
  On urban, occupancy-blind, one-stop, this probe measures a mean wait term of
  **-24.20** and a mean punctuality term of **+37.88** against a mean net of
  **+13.67**; the share priced `>= 0` is **27.0%** on the wait term alone and
  **76.4%** on the net. That document reports -14.3 and 35.6%, which sit beside
  the wait-term-only pair and not beside the net. Section 5 is about that term.

---

## 3. The terminal wait term: the zero is real, and the anchor removes it

Terminal candidates, `n` = 204 urban / 208 suburban / 206 inter-city. Identical
in both occupancy phases, because nobody is aboard a bus that has not departed.

Share whose **wait term is exactly 0.0**:

| corridor | anchor off | anchor on |
|---|---|---|
| urban | **43.1%** | 2.5% |
| suburban | **38.9%** | 2.9% |
| inter-city | **46.1%** | 1.9% |

The pathology is confirmed at 39-46% and the anchor removes it. Mean wait term,
one-stop: urban -0.2 -> -2.1, suburban -0.4 -> -3.5, inter-city -0.8 -> -5.3.
The residual 2-3% is rounding: `holdSeconds` is rounded to whole seconds, so
`d = 2x` can still land exactly on the second root of `d(d - 2x)`.

`docs/MULTI_STOP_WAIT_TERM.md` reports 47-49% of terminal candidates scoring
**exactly 0.0 on `objectiveCost`**. This probe never sees that, because the
punctuality term is non-zero on **100%** of terminal candidates here — see
section 5. The zero it identified is real and is in the wait term; the
`objectiveCost` it is netted into is not zero, it is small and positive.

---

## 4. The sign: the anchor alone does not move it, and that is measured

Share of terminal candidates priced `>= 0`:

| corridor | anchor off, one-stop | anchor **on**, one-stop | anchor off, multi-stop | anchor **on**, multi-stop | anchor on, multi-stop + lambda |
|---|---|---|---|---|---|
| urban | 100.0% | **100.0%** | 99.5% | **68.6%** | **12.3%** |
| suburban | 100.0% | **100.0%** | 99.5% | **94.7%** | **29.3%** |
| inter-city | 100.0% | **100.0%** | 99.5% | **97.1%** | **67.0%** |

**On its own the anchor moves the `>= 0` share by nothing at all** — 100.0% to
100.0%, to the digit, on all three corridors. Mean `objectiveCost` falls
(urban +14.5 -> +12.6, suburban +19.7 -> +16.5, inter-city +26.3 -> +21.7) and
not one candidate crosses zero.

The arithmetic says why, and it is exact. Occupancy-blind at an origin the score
is `w_h x lambda x N x d x (d - 2x)` plus `W_LATENESS x d`. Under the anchor the
first is `-lambda x N x d^2` at the on-target hold and the second is `+d`, so a
terminal hold is priced as a benefit only when

```
lambda x N x d  >  1
```

Under the `1/H*` proxy with `N = 1` that needs `d > H*`, and a terminal hold is
bounded by `H* - h_fwd < H*`. **No terminal hold can ever be priced as a benefit
under the deployed objective, whatever the backward anchor is.** The zero was
not the only thing in the way; it was the thing in the way of the horizon and
lambda having anything to multiply.

Which is the complement of `docs/MULTI_STOP_WAIT_TERM.md` section 5's finding.
It observed that a positive multiplier leaves zero at zero, so the horizon could
not fix terminal dispatch. The other half is that the anchor cannot either: it
makes the wait term non-zero, and `lambda x N` is what makes it big enough to
beat a punctuality charge that is linear in the same `d`. **The three are
factors on one term and terminal dispatch needs all three.** With the horizon
the bar is `d > 1/(lambda x N)` = 28s on urban; with a fitted lambda as well it
is 4s.

### Trial outcomes: the anchor is byte-identical, and stays so under the check

`terminal_dispatch` coverage, the guardrail (total passenger time, positive =
passengers saved time) and the headline (excess wait), pooled over three seeds:

| configuration | corridor | phase | terminal_dispatch | terminal holds | guardrail | headline |
|---|---|---|---|---|---|---|
| anchor **off**, check off | urban | blind | 204/8925 (2.3%) | 194 | -5.42% | 45.18% |
| anchor **on**, check off | urban | blind | 204/8925 (2.3%) | 194 | -5.42% | 45.18% |
| anchor **off**, check off | urban | weighed | 206/8925 (2.3%) | 201 | -4.14% | 55.65% |
| anchor **on**, check off | urban | weighed | 206/8925 (2.3%) | 201 | -4.14% | 55.65% |
| anchor **off**, check off | suburban | blind | 208/5355 (3.9%) | 198 | -3.99% | 25.91% |
| anchor **on**, check off | suburban | blind | 208/5355 (3.9%) | 198 | -3.99% | 25.91% |
| anchor **off**, check off | inter-city | blind | 206/3570 (5.8%) | 190 | -2.66% | 17.98% |
| anchor **on**, check off | inter-city | blind | 206/3570 (5.8%) | 190 | -2.66% | 17.98% |

Identical to every digit on all three corridors and both phases, which is what
it must be: `objectiveCost` gates nothing on the deployed defaults, so this is a
pricing change and not a control change.

With `SELF_HARM_CHECK_ENABLED` on — the guard that reads the price:

| configuration | corridor | phase | terminal_dispatch | guardrail | headline |
|---|---|---|---|---|---|
| anchor **off**, check **on** | urban | blind | **0/8925 (0.0%)** | -2.82% | 47.67% |
| anchor **on**, check **on** | urban | blind | **0/8925 (0.0%)** | -2.82% | 47.67% |
| anchor **off**, check **on** | urban | weighed | **0/8925** | -0.00% | 0.01% |
| anchor **on**, check **on** | urban | weighed | **0/8925** | -0.00% | 0.01% |
| anchor **on**, check **on** | suburban | blind | **0/5355** | -2.40% | 24.43% |
| anchor **on**, check **on** | inter-city | blind | **0/3570** | -2.23% | 17.26% |

**A negative result, and it is the deliverable.** The check silences terminal
dispatch completely — 0 of 8,925 decisions on urban, on all three corridors and
in both phases — and correcting the neutral-backward assumption **does not
rescue a single candidate**, because 100% of them are still priced `>= 0` for
the reason section 4 derives. It does not make anything worse either: no
guardrail or headline figure moves in any configuration.

---

## 5. What else is wrong: the punctuality term is lambda in disguise

The brief this work was done under asked, if the sign does not flip, what else
is wrong. This is the answer, it was not on anyone's list, and it changes what
calibrating lambda will do.

`W_LATENESS = 1` is passenger-seconds charged per second of lateness the hold
adds. Its own docblock says what the 1 is: *"the value implied by the same 1/H\*
proxy `arrivalRatePaxPerSecond` uses (one rider accumulates per planned
headway), and it inherits that proxy's calibration debt"*. So `W_LATENESS` is
**riders per departure**, which under the proxy is `lambda x H* = 1`. It is the
same placeholder as the wait term's lambda, wearing a different name, and
nothing scales it.

It is not a rounding detail. On urban, occupancy-blind, one-stop, the mean
punctuality term of a selected candidate is **+37.88** against a mean wait term
of **-24.20** — it is larger than the benefit it is netted against, and it is
what takes the share priced `>= 0` from 27.0% on the wait term alone to 76.4% on
the net. On terminal candidates it is the whole story: mean +14.7 / +20.1 / +27.1
against wait terms of -0.2 / -0.4 / -0.8.

That matters because a measured lambda has two readings and they do not agree:

- **(A) lambda enters the wait term only.** `W_LATENESS` stays 1.
- **(B) lambda enters both.** `W_LATENESS` becomes `lambda x H*` — 7.2 on urban
  — because that is what the constant means.

Share of SELECTED candidates priced `>= 0`, multi-stop horizon on, anchor on:

| corridor | phase | proxy | + lambda (A) | + lambda (B) |
|---|---|---|---|---|
| urban | blind | 27.5% | **13.5%** | **27.5%** |
| suburban | blind | 39.5% | **16.0%** | **39.5%** |
| inter-city | blind | 43.7% | **31.3%** | **43.7%** |
| urban | weighed | 89.6% | **39.1%** | **51.6%** |
| suburban | weighed | 97.6% | **50.1%** | **70.6%** |
| inter-city | weighed | 98.9% | **51.6%** | **64.1%** |

**Under reading (B), occupancy-blind, a measured lambda changes the share by
exactly nothing** — 27.5%, 39.5% and 43.7% to the digit. That is the
positive-multiplier property again, and it now applies to the wait and
punctuality terms *as a pair*: with no onboard term the net is
`lambda x (wait + punctuality)`, and scaling a sum by a positive number cannot
move which side of zero it sits on. Occupancy-blind is the deployed default and
the state of every seeded corridor.

Reading (A) is what `docs/MULTI_STOP_WAIT_TERM.md`'s fitted-lambda probe
measured, and it is the optimistic one. **Which reading is right decides whether
calibrating lambda flips the sign at all on the deployed configuration**, and the
constant's own documentation says (B).

The same question with the one-stop term, occupancy-blind, reading (A) — the
comparison the brief asked for directly:

| corridor | proxy | + lambda (A) | change |
|---|---|---|---|
| urban | 76.4% | 35.4% | **-41.0 pts** |
| suburban | 64.5% | 38.6% | **-25.9 pts** |
| inter-city | 48.2% | 42.8% | **-5.4 pts** |

So: yes, the share falls, and by 41 / 26 / 5 points — **but only under the
reading in which the punctuality term keeps a placeholder the wait term has just
had corrected.** Under the consistent reading it does not fall at all.

---

## 6. Default-off is byte-identical

`lawCoverage` for all five laws and every per-scenario `contrast`, hashed over
19 scenarios x 3 seeds x 120 vehicles on all three presets and both occupancy
phases, against `git archive origin/simulator-preview` with `node_modules`
symlinked:

```
                                 origin/simulator-preview (2a45cc1)   this branch, flags off
urban      weighOccupancy=false  84e455416858991b                     84e455416858991b   identical
urban      weighOccupancy=true   917b345e10de477a                     917b345e10de477a   identical
suburban   weighOccupancy=false  6bd8c12219af3824                     6bd8c12219af3824   identical
suburban   weighOccupancy=true   ef259b24d8a8bafa                     ef259b24d8a8bafa   identical
intercity  weighOccupancy=false  553458cd83998da1                     553458cd83998da1   identical
intercity  weighOccupancy=true   5225c5a950cf9d12                     5225c5a950cf9d12   identical
```

The mechanism, not just the result. With the flag off `terminalDispatch.ts` asks
for the `'vehicle'` anchor, which is the `h_bwd = H*` substitution that was
already there, and no other law asks for the other one. The lambda seam needs no
flag at all: nothing in this service supplies a measured rate, and a null prices
as the proxy. `test/originBackwardNeutral.test.ts` pins both ends.

---

## 7. Where this leaves the knobs

`docs/MULTI_STOP_WAIT_TERM.md` section 9 lists three things the objective still
needs. This work does the second and adds a fourth.

1. **lambda.** Still the whole remaining factor on the wait term, and section 5
   says calibrating `arrivalRatePaxPerSecond` alone is not the job: decide what
   `W_LATENESS` does at the same time, because occupancy-blind the two move
   together or the sign does not move at all.
2. **The neutral backward assumption at an origin.** Done, off by default.
   Necessary and measured **not** sufficient: it removes a wait term of exactly
   zero on 39-46% of terminal candidates and moves the `>= 0` share by nothing
   until the horizon and lambda are on with it.
3. **The dwell and riding terms**, which the objective does not model at all.
4. **The punctuality term at an origin.** A bus at the terminal has not started
   its trip and nobody is aboard, which is exactly why terminal dispatch is the
   cheapest lever in the network — and the objective charges it a full second of
   passenger time per second of hold anyway. It is the largest single term in a
   terminal candidate's price and it is why the self-harm check still declines
   100% of them. Not fixed here: it is a change to what the objective charges
   rather than to what it assumes, and it wants its own evidence.

Flip `ORIGIN_BACKWARD_NEUTRAL_ENABLED`, `MULTI_STOP_WAIT_TERM_ENABLED` and a
calibrated lambda together, or none of them, and re-run all three corridors and
both phases against the tables above.

---

## 8. Reproduction

`experiments/runs/` is gitignored. The three probes:

**a. The digest** (section 6). `git archive origin/simulator-preview` into a
temp directory, symlink `node_modules`, and hash each phase's `lawCoverage`
(sorted by law) plus every scenario's `contrast` at nine decimal places, over
`{urban, suburban, intercity} x {501, 502, 503}` at 120 vehicles per phase.

**b. Candidate prices** (sections 3, 4, 5). Mirror `runScenario` — build the
corridor with `buildFleetCorridor`, run `simulate(config, noControlController)`,
book the timetable from it, then run `simulate` again against
`createDeployedControlLawsController({ ..., corridorStops })` — and read
`controller.decisions[].candidates`. Re-price off-line by scaling
`passengerCost.waitPassengerSeconds` by `lambda_true x targetHeadwaySeconds`
(reading A) or `(wait + lateness)` by the same factor (reading B). Check
`rankedCandidateCount` is 1 everywhere before trusting an off-line re-price.

**c. Trial outcomes** (section 4). `runFleetTrial` with the same spec, reading
`lawCoverage`, `holdCountByActionType`, `contrast.passengerSecondsSavedPercent`
and `contrast.ewtImprovementPercent`. Flags come from the environment and
`loadEnv()` caches, so each configuration needs its own process.
