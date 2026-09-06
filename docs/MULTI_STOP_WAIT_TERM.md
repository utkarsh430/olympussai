# The multi-stop wait term

`MULTI_STOP_WAIT_TERM_ENABLED`, default **off**. This file is the evidence
behind it: what it changes, what that is measured to be worth, and — as
importantly — the two things it was expected to fix and does not.

Read `docs/SELF_HARM_CHECK.md` and `HANDOFF.md` section 7 first. This is the
change those two documents name as the precondition for everything else, and
it turns out to be **half** of that precondition.

---

## 1. What it changes

`mpc/objective.ts`'s waiting term was

```
w_h × λ × d × (d + h_fwd − h_bwd)
```

and is now, when the switch is on,

```
w_h × λ × d × (d + h_fwd − h_bwd) × N
```

where **N is the number of stops the held vehicle still has to serve, counting
the one it is standing at**.

### The derivation

Reference architecture 2.2's waiting cost is `SUM_s λ_s h_s² / 2` — a sum over
stops. `objective.ts` evaluated it at one stop, the control point the hold is
issued from, and its own header has always said so. That restriction is the
error.

A hold does not move a headway at one stop. Holding vehicle *i* for `d` seconds
delays its arrival at **every stop it has yet to serve**, so at each of those
stops the gap ahead of it reads `h_fwd + d` and the gap behind it reads
`h_bwd − d`. Both changes land on the same set of stops — the ones the held bus
has left — because at stops it has already passed its arrival is fixed and the
hold changes nothing there. Summing the same second-moment difference over
those N stops gives the expression above.

The perturbation is carried forward **unchanged** between stops. That is a
neutral assumption of exactly the kind this module already makes for an
unobserved backward neighbour, and it is neutral in a specific sense: the
fitted dwell model says a headway deviation GROWS by `1 + β_h` per stop
(`calibration/dwell.ts#headwayAmplification`), while downstream re-regulation
shrinks it. The measurements in section 2 say neither dominates in a way three
corridors agree on.

### Why there is no decay coefficient

`HANDOFF.md` section 7 suggests a geometric decay `(1 − ρᴺ)/(1 − ρ)` and solves
it against three measured ratios to get ρ ≈ 0.94 / 0.88 / 0.65. It also says
not to ship those numbers. Two further measurements say the same thing much
more strongly.

**1. The residual `ratio ÷ N` does not keep its ordering across measurements
of it.** Three independent estimates of the same quantity:

| corridor | HANDOFF §7 (whole-arm, 10 scenarios) | per-hold marginal, 10 scenarios | per-hold marginal, 19 scenarios |
|---|---|---|---|
| urban | 0.80 | 0.58 | 1.71 |
| suburban | 0.72 | 0.51 | 0.52 |
| inter-city | 0.50 | 0.88 | 2.14 |

All O(1) — which is the finding, and it is what justifies `× N`. But the
*ordering across corridors* is different in all three, and a decay constant is
exactly a claim about that ordering. The per-hold marginal is the cleaner
object of the two methods (suppress exactly one hold in an otherwise identical
run under common random numbers, and diff the engine's own waiting figure)
and it disagrees with itself between scenario sets.

**2. The mechanism a decay would need does not behave like one.** Measuring how
much of a hold's headway correction survives, stop by stop — the held bus's
arrival-time shift against the suppressed-hold run, which *is* the surviving
perturbation because its leader is ahead and unaffected:

| stops downstream | urban | suburban | inter-city |
|---|---|---|---|
| +1 | 1.03 | 1.01 | 0.96 |
| +2 | 0.67 | 0.56 | 0.68 |
| +4 | 0.29 | 0.35 | 0.80 |
| +6 | 0.16 | 0.21 | **1.28** |
| +8 | 0.13 | 0.31 | **1.78** |

Inter-city's correction does not decay at all past +3; the dwell feedback
amplifies it. Yet inter-city is the corridor the trial says the controller does
least for. Whatever sets the residual, it is not the correction decaying, so a
geometric decay fitted to it would be a coincidence with a physical-sounding
name.

Fitting ρ to three points that swap rank is the error `mpc/actionThreshold.ts`'s
docblock records rejecting. So N carries no coefficient: the term is the sum
the architecture already specifies, over the stops that are left.

---

## 2. Method

All figures below: the fleet-trial corridors, **19 bunching scenarios × 3 seeds
(501–503), 120 vehicles per phase**, `followerSpeedSource: 'vehicle_state'`, the
DEPLOYED laws through `rehearsal/deployedControlLaws.ts`, base commit `4ec2ef8`.
The scenario set includes the nine adversarial scenarios, which is why the
controller's measured benefit is smaller here than in `docs/FLEET_TRIAL.md` and
negative on two corridors — that is the adversarial set doing its job, not this
change.

"measured" always means the controlled arm against the uncontrolled arm on the
same seed, with total passenger time counting all four terms (kerb wait, dwell,
hold, riding) — `fleetTrial/run.ts#passengerOutcome`.

**Two things this method does NOT measure**, and neither should be read into it:
excess wait (the trial's headline — `docs/SELF_HARM_CHECK.md`'s finding that the
check costs 2.5–4.3 points of it is not re-tested here), and seed spread beyond
the three pooled seeds.

A **fitted λ** column appears throughout. It is a PROBE, not shipped: a copy of
the tree with `arrivalRatePaxPerSecond` returning the simulator's own modelled
boarding rate (urban 1.2/min, suburban 0.75/min, inter-city 0.38/min) instead
of the `1/H*` proxy. It is there because the horizon and λ are independent
multipliers on the same term and the report is unreadable without separating
them. Wiring a real λ needs `stop_visits` and `pnpm sim:run --calibrate`; see
`evaluation/calibrate.ts`.

---

## 3. Magnitude: the wait term as a share of the waiting actually removed

| corridor | mean N | one-stop | **multi-stop** | multi-stop + fitted λ |
|---|---|---|---|---|
| urban | 13.50 | 1.32% | **16.31%** | 117.4% |
| suburban | 9.08 | 1.96% | **13.98%** | 125.8% |
| inter-city | 6.52 | 3.04% | **15.54%** | 177.2% |

The horizon is worth 12.4× / 7.1× / 5.1× — i.e. the mean stops downstream,
which is the check the form had to pass. λ is worth a further 7.2× / 9.0× /
11.4×, which is exactly `λ_true × H*` on each corridor. The two multiply.

**So: the benefit term now accounts for 14–16% of the waiting a hold removes,
against 1.3–3.0% before. It does not account for a realistic share.** The
residual is λ, and with λ as well the same term lands at 117% / 126% / 177% of
the measured truth — the right answer to within the spread of three corridors,
with no fitted constant anywhere in it. That is the strongest statement this
measurement supports: *the form is right and one of its two inputs is still a
placeholder.* (It also overshoots, most on inter-city, which is the next thing
to look at once λ is real.)

---

## 4. Sign

Mean `objectiveCost` of the SELECTED candidate, and the share of selected
candidates the objective prices at `>= 0`:

**Occupancy weighting ON**

| corridor | one-stop | multi-stop | multi-stop + λ | measured total passenger time |
|---|---|---|---|---|
| urban | +1,297.5 (99.7% ≥0) | +1,135.5 (97.8%) | **+42.4 (74.1%)** | **+0.68% (SAVED)** |
| suburban | +2,836.8 (99.2%) | +2,595.9 (98.8%) | +353.9 (78.5%) | −0.31% |
| inter-city | +9,100.7 (99.1%) | +8,278.5 (98.8%) | −2,348.2 (69.1%) | −0.29% |

**The multi-stop term on its own does not fix the sign, and it cannot.** It is
a strictly positive multiplier: it widens a benefit and it widens a cost, and
only the terms the wait term is netted against can flip the net. On urban with
occupancy weighting the onboard term is +25,622 h against a multi-stop wait
term of −3,444 h; thirteen times a number that small is still smaller.

With λ as well it very nearly does. Urban goes from +1,297.5 to +42.4 — a 31×
reduction, essentially break-even against a corridor measured to save 0.68% of
total passenger time — and the remaining gap is fully accounted for by the two
terms the objective models **not at all**: passenger-weighted dwell and riding,
both of which move in the controller's favour and neither of which appears
anywhere in `computePassengerCost`.

**Occupancy weighting OFF** — the deployed default, and the state of every
seeded corridor — the objective already had the right sign, and the multi-stop
term deepens it without moving a single decision across zero:

| corridor | one-stop | multi-stop |
|---|---|---|
| urban | −14.3 (35.6% ≥0) | −176.3 (**35.6%**) |
| suburban | −39.4 (36.7% ≥0) | −280.3 (**36.7%**) |
| inter-city | −199.6 (37.6% ≥0) | −1,021.8 (**37.6%**) |

The ≥0 share is identical to the digit. That is the positive-multiplier
property, and it is the single most useful thing to know about this change.

---

## 5. Terminal dispatch: a DIFFERENT defect, and the multi-stop term does not touch it

Terminal candidates scoring `>= 0`, and scoring exactly `0.0`:

| corridor | ≥0, one-stop | ≥0, multi-stop | exactly 0 (both) |
|---|---|---|---|
| urban | 96.8% | 96.8% | 2,993 of 6,133 (48.8%) |
| suburban | 96.9% | 96.9% | 2,873 of 6,122 (46.9%) |
| inter-city | 97.0% | 97.0% | 2,932 of 6,149 (47.7%) |

Unchanged, on every corridor, under both occupancy phases. This was expected to
be a symptom of the one-stop wait term. **It is not.** The cause is separate and
now measured:

An unclamped terminal hold sets `d = H* − h_fwd` (`mpc/terminalDispatch.ts`).
With no bus observed behind — the ordinary case at an origin — `computePassengerCost`
substitutes the neutral `h_bwd = H*`. The bracket is then

```
d + h_fwd − h_bwd  =  (H* − h_fwd) + h_fwd − H*  =  0,  exactly.
```

Under that substitution the hold does not even the two gaps, it **swaps** them:
`(h_fwd, H*)` becomes `(H*, h_fwd)`, whose second moment is identical. Nearly
half of all terminal candidates score exactly 0.0 for this reason, and `>= 0`
is true of zero, so the self-harm check declines them. A positive multiplier
leaves zero at zero, which is why the horizon changes nothing here.

The neutral backward assumption is right where it came from — `selfEqualizing.ts`
uses it so that an unobserved neighbour neither manufactures a hold nor cancels
one — and it is wrong for *scoring* at an origin, where the bus behind has not
departed and its own departure is regulated by the same law rather than being
squeezed by this hold. Fixing it means giving `computePassengerCost` a way to
say "there is no backward gap to spend", which is a change to the neutral
assumption and not to the horizon. **It is not in this change, and it is the
cheapest remaining item on this objective.**

---

## 6. `cost_optimal` coverage

Candidates GENERATED (`lawCoverage`), same runs:

| corridor | occupancy OFF | occupancy ON, one-stop | occupancy ON, multi-stop | occupancy ON, + λ |
|---|---|---|---|---|
| urban | 46,750 | **1** | **582** | 15,806 |
| suburban | 16,268 | **0** | **54** | 4,238 |
| inter-city | 14,113 | **3** | **68** | 6,389 |

Occupancy-blind coverage is unchanged by the switch, as it must be — that
column never had the silence.

The law is non-silent where it was silent, and by a factor the arithmetic
predicts rather than a comfortable one: it declines on
`w_v·L·d + w_h·λ·N·d·(d + h_fwd − h_bwd) >= 0`, and multiplying only the second
term by N ≈ 6–13 rescues the pairs whose imbalance was already within an order
of magnitude of the load. It does not rescue the rest, because λ is still 7–11×
short. With λ as well, coverage lands within a factor of three of the
occupancy-blind figure on every corridor, which is what "non-silent" should
look like. **At 582 of 46,750 it is not there yet.**

---

## 7. The self-harm check, with the corrected objective

`SELF_HARM_CHECK_ENABLED` on. Its default is unchanged (off); this is the
measurement the flag exists to make, and it is the sharpest available test of
whether the objective is now right.

**Occupancy weighting ON** — holds issued, and total passenger time
(positive = passengers SAVED time):

| corridor | check OFF | check ON, one-stop | check ON, multi-stop | check ON, + λ |
|---|---|---|---|---|
| urban | 70,317, +0.68% | **246, +0.17%** | **3,309, +1.62%** | 18,532, +2.78% |
| suburban | 24,569, −0.31% | 180, +0.08% | 401, +0.20% | 5,837, +0.72% |
| inter-city | 21,803, −0.29% | 168, +0.02% | 289, +0.09% | 6,473, +0.67% |

With the one-stop objective the check does what `docs/SELF_HARM_CHECK.md`
recorded: urban falls from 70,317 holds to 246 — the controller is switched off.
With the multi-stop term the same check leaves **13× more holds standing**
(3,309) and the guardrail reads +1.62% against +0.68% unchecked. On all three
corridors the checked controller now has a better total-passenger-time figure
than the unchecked one.

**Do not read that as "turn the check on."** Three reasons, and they are the
whole caveat: this measures the GUARDRAIL and not excess wait, which is the
trial's headline and the thing `docs/SELF_HARM_CHECK.md` measured the check
spending 2.5–4.3 points of; the objective it is now believing still sees only
16% of the benefit it is supposed to price; and 3,309 of 70,317 is still a
controller that has been mostly silenced, just less catastrophically. The
honest reading is that the check's damage is **proportional to the objective's
error**, which is what you would expect if the error is the whole problem — and
that is the useful result.

**Occupancy weighting OFF** the check behaves *identically* with and without the
switch — urban 44,613 holds and +1.54% both ways, suburban 15,733 / −0.08%,
inter-city 13,724 / −0.16%. That is not a null result, it is the
positive-multiplier property again: with no onboard term the net IS the wait
term, and scaling it by a positive N cannot move which candidates sit on the
wrong side of zero.

---

## 8. Default-off is byte-identical

Every decision's selected action, hold length, `objectiveCost` to nine decimal
places, rationale string and per-law coverage/decline reason, plus the four
whole-day passenger-time terms, hashed over 19 scenarios × 3 seeds × 120
vehicles on all three corridors and both occupancy phases:

```
                                  origin/simulator-preview (4ec2ef8)   this branch, flag off
urban      weighOccupancy=false   f3d4328cd70a4bfe…                    f3d4328cd70a4bfe…   identical
urban      weighOccupancy=true    a88606d5877827b3…                    a88606d5877827b3…   identical
suburban   weighOccupancy=false   7ca916c297500ce9…                    7ca916c297500ce9…   identical
suburban   weighOccupancy=true    3a3716c8918a43c6…                    3a3716c8918a43c6…   identical
intercity  weighOccupancy=false   4215fa245edc7efc…                    4215fa245edc7efc…   identical
intercity  weighOccupancy=true    24357a61ff7e613a…                    24357a61ff7e613a…   identical
```

The mechanism, not just the result: with the switch off neither `mpc/solver.ts`
nor `rehearsal/deployedControlLaws.ts` builds a `downstreamStopsByVehicleId`
entry, every law passes `null`, `waitHorizonStops(null)` is 1, and multiplying
by 1 is the expression that was there before.
`test/multiStopWaitTerm.test.ts` pins that at both ends.

---

## 9. Where this leaves the knobs that wait on it

`COST_OPTIMAL_SELECTION_ENABLED` and `SELF_HARM_CHECK_ENABLED` both wait on
"the objective's predicted benefit matches a measured one". After this change
it matches at 14–16%, against 1.3–3.0% before. **That is not a match**, and
neither knob is earned. In priority order, what is left:

1. **λ.** Worth 7.2–11.4× and it is the whole remaining factor on the wait
   term. `pnpm sim:run --calibrate` already fits it; nothing wires it in.
2. **The neutral backward assumption at an origin** (section 5). Cheap, and it
   is half of terminal dispatch's silence.
3. **The dwell and riding terms**, which the objective does not model at all and
   which move in the controller's favour (`HANDOFF.md` section 7).

Revisit all three knobs together, on all three corridors and both phases across
seeds, against the tables above.

---

## 10. Reproduction

`experiments/runs/` is gitignored, so nothing survives a clone. The four probes
behind this document are sketched below; run them with the env vars from
`HANDOFF.md` section 1 and absolute import paths (tsx will not resolve relative
paths from outside the package).

**a. The evidence sweep** (sections 3, 4, 6, 7). Build a corridor, run the
uncontrolled and controlled arms on the same seed, and read the objective's own
`passengerCost` off `controller.decisions[].candidates`:

```ts
const c = createDeployedControlLawsController({
  policy: corridor.policy, epochMs: REHEARSAL_EPOCH_MS,
  modelledCapacity: inputs.vehicleCapacity, weighOccupancy,
  followerSpeedSource: 'vehicle_state', corridorStops: corridor.stops,
  multiStopWaitTerm,        // the switch under test
  selfHarmCheckEnabled,     // section 7
});
add(controlled, terms(simulate(scen, c).visits));
add(baseline,  terms(simulate(scen, noControlController).visits));
for (const d of c.decisions) for (const cand of d.candidates) { /* objectiveCost, passengerCost */ }
```

with `terms()` copied from `fleetTrial/run.ts#passengerOutcome` — all four
terms, not waiting alone. Sweep `(corridor × weighOccupancy × multiStopWaitTerm
× selfHarmCheckEnabled)`.

**b. The per-hold marginal** (section 1, table 1). Wrap the controller so that
it returns `holdSeconds: 0` the first time a named (vehicleId, stopId) asks,
re-run, and diff. Common random numbers (`simulation/rng.ts#drawStream`) make
the two runs the same day, so the difference is that one hold:

```ts
decide(ctx) {
  const d = inner.decide(ctx);
  if (!done && ctx.vehicleId === target.vehicleId && ctx.stopId === target.stopId && d.holdSeconds > 0) {
    done = true;
    return { holdSeconds: 0, actionType: 'no_control' };
  }
  return d;
}
```

Sample mid-route holds only (`!d.coverage.atTerminal`), and divide the measured
waiting change by the objective's own wait term for that same hold.

**c. Perturbation survival** (section 1, table 2). Same suppression, but track
the held bus's `arrivalSeconds` at every downstream stop in both runs and
divide the difference by the applied hold read off the visit record.

**d. The byte-identity digest** (section 8). `git archive origin/simulator-preview`
into a temp directory, symlink `node_modules`, and run the same hash over
`controller.decisions` and the four passenger-time terms against both trees.
