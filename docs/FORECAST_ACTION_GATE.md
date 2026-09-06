# The forecast-admission gate

`FORECAST_ACTION_GATE_ENABLED` — **off**, and this document is why.

Code: `mpc/actionThreshold.ts` (the predicate), `state/store.ts` (the field it
reads), `rehearsal/deployedControlLaws.ts` (how the trial fits the forecast),
`fleetTrial/run.ts` (`forecast_action_gate` policy study).

---

## 1. The gap this closes, which is real and is now closed

`headway/riskForecast.ts` has projected every leader/follower pair's forward
headway since the predictive detection tier shipped. `headway_states.
forecast_h_fwd_seconds` is written on every row. And until this change the
value reached **detection and stopped there**: `HeadwayStateRow` — the shape
every control law reads — had no field for it, `scheduler/headwayCompute.ts`
dropped it when projecting a compute result onto that shape, and
`db/rehydrate.ts` did not select the column at all. The system could predict a
corridor coming apart and had no way to act on the prediction.

That carry-through is now in place regardless of the flag, and
`test/forecastCarryThrough.test.ts` pins it at both ends.

## 2. Why a gate rather than a looser bar

Acting earlier *indiscriminately* is measured and it costs. Loosening the
mid-route bar from 50% to 75% of H\* moved excess wait 51% → 56% and spent
total passenger time 3.3% → 1.9%. A bar reads the current gap and nothing
else, so it cannot tell a pair heading for a bunch from a pair that is merely
a little early and would have re-spaced on its own; it admits both and charges
the second group's holds to everyone aboard.

`MID_ROUTE_ACTION_RATIO = 1.2` already took the half of that trade which did
*not* spend the guardrail — 12 out-of-sample paired seeds, effective bar 0.5 →
0.6 of H\*. So there is no more timing to be had by moving a bar, and a
forecast is the only mechanism in this codebase that could tell the two groups
apart.

**Everything below is measured against the CURRENT 0.6 bar.** Comparing the
gate against the old 0.5 bar would credit it with a win that is already
shipped.

## 3. The predicate

`forecastAdmitsEarlyAction` admits a pair the ordinary bar declines when, and
only when, **both** hold:

- **deteriorating** — the projected gap is strictly smaller than the measured
  one. `computeBunchingRisk` reports an *opening* gap calmly rather than
  refusing, so "has a forecast" and "is coming apart" are different questions.
- **reaching the bar** — the projected gap lands at or below the same bar
  `isWorthActingOn` uses. A pair closing steadily from 1.5 to 0.8 of H\* is
  genuinely closing and still will not be in trouble at the horizon.

Three properties make it safe to widen a bar with, each pinned by test:

1. **A null forecast never admits.** `computeBunchingRisk` returns null under
   four samples, under 150 s of observation, r² below 0.5, or a closing rate
   beyond what a stationary leader could produce. Null is "the forecaster
   declined to speak", never "no risk" — the same distinction
   `headway/bunching.ts` is pinned on. A gate reading absence as permission
   would act earliest on the corridors whose data is worst.
2. **It only ever widens.** `ordinary OR forecast`, never `AND`. A reassuring
   forecast cannot veto a measured deviation, for the reason
   `headway/service.ts` already settles for detection: an observation outranks
   an extrapolation.
3. **Off is a true no-op.** With the flag off the forecast is not read at all,
   and in the trial adapter the sweep never runs.

Terminal dispatch is not gated (it never was — nobody is aboard yet).
`boarding_limit` is not gated either: it does not consult the mid-route bar,
it has its own `bunchedThresholdRatio` guard.

## 4. How the trial gets a forecast, and why not the obvious way

In production the forecast a law reads was computed by the **headway sweep**
(60 s) and stored on the row the law later reads out of `stateStore` — so it
is up to one sweep old and was fitted from samples taken on that cadence.

`rehearsal/deployedControlLaws.ts` reproduces both halves: a per-pair sample
history appended once per sweep interval, and a **stored** projection the
decision path reads and never recomputes. Re-fitting the trend at every
decision point would have handed the laws a fresher and denser series than
`headway_states` ever contains — the way this adapter has flattered the
deployed system before.

One subtlety worth keeping: a pair whose `h_fwd` is momentarily unmeasurable
keeps its earlier samples. Production writes the row and simply has one fewer
point to fit. Discarding the history there would have made the forecaster
refuse far more often in the trial than it does live, on the ~9% of pairs that
report a null `h_fwd`.

## 5. What it measures

19 scenarios × 250 vehicles/phase × 3 internal seeds, at **12 paired base
seeds** per corridor — 36 internal seeds per arm. Both rows run the identical
corridor and the identical 0.6 action bar; the only difference is the gate.
Differences are paired by seed with 95% bootstrap intervals over the
seed-level differences, and an interval spanning zero is no effect however
large the mean.

| corridor | σ_leg/H\* | excess wait (headline) | total passenger time (**guardrail**) | holds |
|---|---|---|---|---|
| urban | 0.096 | **+0.23 pp** [−0.24, +0.73] — **spans zero**, 6/12 | **−0.24 pp** [−0.27, −0.20], 12/12 | +4.4% |
| suburban | — | **+2.12 pp** [+1.53, +2.72], 12/12 | **−0.37 pp** [−0.41, −0.34], 12/12 | +22.5% |
| inter-city | 0.19 | **+2.64 pp** [+2.19, +3.06], 12/12 | **−0.16 pp** [−0.18, −0.14], 12/12 | +18.9% |

Positive excess wait is better; positive passenger time means passengers saved
time, so a **negative** guardrail figure is a **cost**.

### The guardrail cost is not an artefact of a saturated scenario

`runPolicyStudy` pools every scenario it is given, `oversaturated` included,
which the trial headline deliberately excludes — and AGENTS.md is explicit
that a scenario built to lose dilutes an effect rather than averaging it. Re-run
over each corridor's own `headlineScope` set, 12 paired seeds:

| corridor | excess wait | guardrail | holds |
|---|---|---|---|
| urban | **+0.04 pp** [−0.37, +0.49] — **spans zero**, 5/12 | **−0.08 pp** [−0.12, −0.04], 9/12 | +4.6% |
| suburban | **+2.99 pp** [+2.67, +3.30], 12/12 | **−0.34 pp** [−0.38, −0.30], 12/12 | +26.5% |

The cost survives on both. On suburban it is essentially unchanged (−0.34
scoped against −0.37 pooled). On urban it shrinks to −0.08 pp, still with an
interval clear of zero — and dropping `oversaturated` also moves urban's
absolute guardrail level from −1.14 to **+0.54**, i.e. scoped, the controller
genuinely saves passengers time on urban and the gate takes a little of that
back for no headline gain.

Inter-city was not re-run scoped. The scoped check exists to ask whether the
guardrail cost is an artefact of a saturated scenario; two corridors answer
that with no, and inter-city has the smallest cost of the three, so a third
run would not change the reading.

## 6. The reading

**The mechanism works.** The gate is genuinely reachable — it buys 4% to 22%
more holds — and those holds are real spacing gains on two of three corridors.

**It is not free, and that is what decides it.** Total passenger time worsens
on **every corridor, with 12/12 seed agreement**. Under this harness's own
decision rule — excess wait is the headline, total passenger time is a
GUARDRAIL, and a proposal that worsens the guardrail is not an improvement —
suburban's and inter-city's real headline gains do not qualify. So the flag
ships off.

**On urban it buys nothing at all.** The corridor where holding demonstrably
works, and which sits mid-band at σ_leg/H\* = 0.096, gets a headline effect
indistinguishable from zero with seeds splitting 6/12 — while still paying the
guardrail. Whatever the gate is doing, it is not helping where the controller
is most effective.

**The corridor ordering is the opposite of the expected one, and worth
recording.** The prior guess was that a forecast is worth least where a
corridor is `too_disturbed`. Measured, inter-city — σ_leg/H\* = 0.19, the most
disturbed of the three and the one that gains least from control overall — is
where the gate buys the *most* headline. The likely mechanism is that high
dispersion produces more pairs closing fast enough for the least-squares fit
to clear r² 0.5 and reach the bar inside the horizon, so the gate simply
reaches more decisions there. That is a hypothesis this measurement does not
test; what it does establish is that the expected ordering is wrong.

**How this compares to the loosening that was rejected.** The 50% → 75% bar
change bought roughly +5 pp of excess wait for −1.4 pp of guardrail, about
3.6:1. The gate on inter-city buys +2.64 pp for −0.16 pp, about 16:1 — a
materially better trade of the same shape. It is still a trade, and the
guardrail is written down here as a constraint rather than as a term in a
ratio, so the constraint decides. **Whether that constraint should become a
ratio is a service-policy question and not a simulation result** — if it is
ever relaxed, this is the first mechanism to revisit.

## 7. Reproducing it

    pnpm --dir control-service sim:fleet --corridor urban --vehicles 500

and read the `forecast_action_gate` row pair in `policyStudies`. The
paired-by-seed figures in section 5 come from running `runFleetTrial` at 12
base seeds per corridor and differencing the two rows of that study, which
share a seed set and therefore pair exactly.

`sim:fleet` needs `CONTROL_SERVICE_DATABASE_URL`, `SERVICE_TOKEN_SECRET` and
`WEBHOOK_HMAC_SECRET` set to any syntactically valid values; nothing connects.

## 8. What would change the answer

- **A lower action bar.** The gate's reachable population is the band between
  the bar and what the forecast can see; a tighter bar widens it. The gate was
  measured *on top of* 0.6, and 0.6 was itself selected as the peak of an
  inverted U.
- **A forecaster that speaks more often.** It declines on r², sample count and
  window today, and passes no dwell model — `computeBunchingRisk` would
  steepen closing trends on corridors measured to amplify them, but
  `fitDwellModel` has never had its samples. See the `stop_visits` note in
  AGENTS.md.
- **Relaxing the guardrail from a constraint to a ratio**, per section 6.
