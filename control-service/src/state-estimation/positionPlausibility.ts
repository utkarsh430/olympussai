// Position plausibility: is this fresh, well-formed fix TRUE?
//
// ─── THE GAP THIS FILLS ────────────────────────────────────────────────
//
// `mpc/safety.ts` refuses to command a vehicle whose reading is STALE, and
// `confidence.ts` flags one whose map match is weak. Nothing anywhere
// refuses a fix that is fresh, well-formed, self-consistent and simply
// WRONG - the failure `simulation/types.ts#Disturbance`'s `gps_bias` models
// and `AGENTS.md` records as unguarded ("nothing anywhere refuses a fresh,
// well-formed, self-consistent fix that is half a kilometre wrong").
//
// MEASURED cost of that gap on the `blind_slowdown` fleet-trial scenario
// (six paired seeds, 2,000 buses/phase - `docs/GPS_POSITION_PLAUSIBILITY.md`
// and the weak-scenarios report §4): a constant 22.6 km along-route offset
// on 20% of the fleet costs 4.1 points of excess-wait gain, and 10.5% of all
// decisions are taken with one end of the pair lied about. A hold decided
// while the deciding bus's own reported position is that wrong is worth
// 0.57% per 100 hold-seconds against 3.85% for a hold chosen at RANDOM.
//
// ─── WHY THIS IS A CORRECTION AND NOT A REFUSAL ────────────────────────
//
// Refusal was measured and it is the wrong fix: suppressing every hold on a
// pair with any bias in it recovers NONE of the 4.1 points and costs a
// further 1.9 (§4d). The loss is not concentrated in the lied-about holds -
// the lie also corrupts `headway/metrics.ts#corridorPaceKmph` (a median over
// reported positions), the chain ranking in `ordering.ts`, and the h_fwd of
// every honest bus whose nearest leader is a phantom. So the remedy has to
// take the bad POSITION out of the quantities every other pair is measured
// against, while leaving the vehicle itself controllable.
//
// ─── THE INSTRUMENT ────────────────────────────────────────────────────
//
// Two pieces that answer two different questions, and conflating them is
// how a naive version fails:
//
//   * A two-sided CUSUM over the UNEXPLAINED displacement of each sample -
//     how far the vehicle says it moved, minus how far its own reported
//     speed (or, when it reports none, the corridor's pace) says it could
//     have. This DETECTS. A CUSUM rather than a per-sample jump test
//     because `phantom_position` is a drift whose per-sample error is inside
//     any honest noise allowance, and `scenarios.ts` sizes it deliberately
//     so ("less and the lie is inside the noise the laws already tolerate").
//
//   * A DEAD-RECKONED belief, propagated from the vehicle's own reported
//     speed since its last plausible fix. This CORRECTS - it is the fallback
//     position - and it is also the only thing that can end a rejection: a
//     vehicle stays suspect until its reported fix comes back to agree with
//     the belief. Without that second half the detector is defeated by
//     `blind_slowdown` by construction, because a CONSTANT offset produces
//     one jump and then looks perfectly stable ("a snapped fix is wrong by
//     the same amount for as long as the vehicle is on that stretch of
//     road, so it looks perfectly stable to anything watching for a jump").
//
// ─── THE BOUND IS IN SECONDS, NOT METRES ───────────────────────────────
//
// A metre bound fitted on one corridor is the commonest error in this repo
// (`AGENTS.md`: "a value fitted on one corridor and shipped for all"). The
// same physical error means different things at 300 s and 12,497 s of
// headway, and the presets alone span an order of magnitude of pace. So the
// threshold is expressed as TRAVEL TIME: reject when the unexplained
// displacement exceeds what this corridor covers in `residualBoundSeconds`.
// That is scale-free, it is the same currency the control laws think in,
// and it is one number to sweep.
//
// ─── ABSENCE OF EVIDENCE IS NOT EVIDENCE ───────────────────────────────
//
// A sample the tracker cannot judge - no reported speed and no corridor
// pace to borrow, a first sighting, or a gap in the feed long enough that
// nothing can be inferred across it - is PLAUSIBLE and re-anchors the
// belief. It is never "suspect by default". This is the same rule the
// predictive detection tier and the forecast action gate already hold (a
// null risk neither opens nor closes an incident; a null forecast never
// admits), applied to the estimator: a feed nobody can check has not been
// caught lying.

/** One vehicle's reported state at one instant, as `vehicle_states` carries it. */
export interface PositionSample {
  vehicleId: string;
  /** Reported distance along this route-direction, metres. */
  distanceAlongRouteMeters: number;
  /** Reported ground speed, km/h. Null when the feed does not carry one. */
  speedKmph: number | null;
}

export type PlausibilityReason =
  /** Judged, and consistent with the vehicle's own speed and the corridor's pace. */
  | "plausible"
  /** Nothing to judge against: first sighting, no elapsed time, or a gap too long to infer across. */
  | "unjudged"
  /** No reported speed and no corridor pace - the tracker declines to have an opinion. */
  | "no_reference_speed"
  /** Reported to have moved further than its own speed and the corridor's pace can explain. */
  | "displacement_above_reference"
  /** Reported to have moved less than its own reported speed says it did - the frozen-feed shape. */
  | "displacement_below_reference"
  /** Still rejected: the fix has not yet come back to agree with the dead-reckoned belief. */
  | "awaiting_reacquisition";

export interface PlausibilityVerdict {
  vehicleId: string;
  /** True when this vehicle's reported position must not set the pace or rank the chain. */
  isImplausible: boolean;
  reason: PlausibilityReason;
  /**
   * The dead-reckoned position to use INSTEAD of the reported one, metres
   * along route. Equal to the reported distance whenever the fix is
   * plausible, so a caller may use it unconditionally.
   */
  believedDistanceAlongRouteMeters: number;
  /** Unexplained displacement accumulated so far, metres (the CUSUM's larger arm). */
  residualMeters: number;
  /** The bound `residualMeters` was tested against at this sample, metres. */
  boundMeters: number;
}

export interface PlausibilityConfig {
  /**
   * How much unexplained displacement is too much, expressed as TRAVEL TIME
   * at the corridor's own pace. See the header: a metre bound does not
   * survive a change of corridor.
   */
  residualBoundSeconds: number;
  /**
   * Per-sample noise allowance, as a fraction of the displacement the
   * vehicle could plausibly have made in that sample. Proportional rather
   * than absolute because the quantity it excuses - disagreement between an
   * instantaneous reported speed and an interval-averaged displacement -
   * scales with the interval and the pace.
   */
  speedSlack: number;
  /**
   * Absolute per-sample noise allowance, metres. This one is NOT
   * corridor-scaled: it stands for positioning error, which is a property of
   * the receiver and the street canyon, not of the headway.
   */
  floorMeters: number;
  /**
   * How closely a returning fix must agree with the dead-reckoned belief
   * before the vehicle is trusted again, as travel time at the corridor's
   * pace. Same currency and the same reason as `residualBoundSeconds`.
   */
  reacquireToleranceSeconds: number;
  /**
   * Consecutive agreeing samples required to end a rejection. More than one
   * so a phantom that happens to pass through its own true position - which
   * a drift crossing zero does exactly once - cannot clear itself on that
   * single coincidence.
   */
  reacquireSamples: number;
  /**
   * Beyond this gap between samples the tracker infers nothing and starts
   * again from the new fix. A vehicle whose feed has been away has not been
   * caught lying, and integrating a reported speed across minutes of absence
   * would manufacture a residual out of the absence itself.
   */
  maxSampleGapSeconds: number;
  /**
   * Below this a vehicle is not making progress and does not set the pace.
   * Matches `headway/metrics.ts#STATIONARY_SPEED_KMPH`, and for that file's
   * own reason: two modules that disagree about which buses are moving will
   * measure against two different paces.
   */
  stationarySpeedKmph: number;
  /**
   * Floor under the pace used to size the bound, km/h. Without it a corridor
   * where everything is momentarily stopped would have a bound of zero
   * metres and reject every vehicle on it.
   */
  minReferenceSpeedKmph: number;
}

/**
 * Defaults.
 *
 * `residualBoundSeconds` = 120 is MEASURED, not assumed. Swept over
 * 30/60/120/240/480 s on all three presets against the three scenarios that
 * attack this gap, six paired seeds at 2,000 buses/phase, it is the knee: at
 * 120 s the check still catches every `blind_slowdown` bias on urban and
 * suburban while excluding 0.1% of healthy vehicles, where 60 s excludes 40%
 * of them on inter-city and 240 s catches less than half. Above it detection
 * collapses - at 480 s the correction is bit-identical to the flag being off
 * on urban.
 *
 * `maxSampleGapSeconds` = 300 is the one number here that is NOT
 * corridor-scaled, and it is what limits inter-city (it catches 73 of 126
 * biased buses there against 126 of 126 on urban). Raising it to 900 s fixes
 * that and is MEASURED to be a bad trade anyway: it takes inter-city's
 * false-exclusion rate from 0.63% to 9.20% and costs 0.92 points of excess
 * wait on inter-city corridors with no GPS problem at all. Deriving it from
 * the corridor's own headway is the next move; raising the constant is not.
 *
 * Full tables, including the bias-ablation ceiling each corridor is measured
 * against, in `docs/GPS_POSITION_PLAUSIBILITY.md`.
 */
export const DEFAULT_PLAUSIBILITY_CONFIG: PlausibilityConfig = {
  residualBoundSeconds: 120,
  speedSlack: 0.5,
  floorMeters: 30,
  reacquireToleranceSeconds: 30,
  reacquireSamples: 2,
  maxSampleGapSeconds: 300,
  stationarySpeedKmph: 5,
  minReferenceSpeedKmph: 5,
};

interface VehicleTrack {
  lastSeconds: number;
  lastReportedMeters: number;
  /** Reported speed at the previous sample, km/h, or null. Half of the trapezoid below. */
  lastSpeedKmph: number | null;
  believedMeters: number;
  cusumUp: number;
  cusumDown: number;
  suspect: boolean;
  agreeingSamples: number;
}

/** Counters for the risk this check carries, which is exclusion of the healthy. */
export interface PlausibilityAudit {
  /** Samples the tracker actually formed an opinion on. */
  judgedSamples: number;
  /** Samples it declined to judge (first sighting, no reference speed, feed gap). */
  unjudgedSamples: number;
  /** Samples whose verdict was implausible. */
  implausibleSamples: number;
  /** Distinct vehicles ever rejected. */
  implausibleVehicleIds: ReadonlySet<string>;
  /** Distinct vehicles ever seen. */
  seenVehicleIds: ReadonlySet<string>;
}

const KMPH_TO_MPS = 1 / 3.6;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Stateful across samples, one instance per route-direction, because every
 * quantity here is a comparison against that vehicle's own history. It holds
 * only what it has been shown; nothing here reads a database.
 */
export class PositionPlausibilityTracker {
  private readonly config: PlausibilityConfig;
  private readonly tracks = new Map<string, VehicleTrack>();
  private readonly seen = new Set<string>();
  private readonly rejected = new Set<string>();
  private judged = 0;
  private unjudged = 0;
  private implausible = 0;

  constructor(config: Partial<PlausibilityConfig> = {}) {
    this.config = { ...DEFAULT_PLAUSIBILITY_CONFIG, ...config };
  }

  /**
   * The pace this snapshot is judged against: the median reported speed of
   * the vehicles that are moving and are NOT currently suspect.
   *
   * Excluding the suspect ones is the whole point - a phantom's speed is as
   * untrustworthy as its position, and letting it set the bound every other
   * vehicle is judged by is the corruption this file exists to remove, in
   * miniature. Taken from the PREVIOUS sweep's verdicts, which is the only
   * order that terminates.
   */
  private referencePaceKmph(samples: readonly PositionSample[]): number | null {
    const moving: number[] = [];
    for (const sample of samples) {
      if (this.tracks.get(sample.vehicleId)?.suspect) continue;
      const speed = sample.speedKmph;
      if (speed == null || Number.isNaN(speed)) continue;
      if (speed < this.config.stationarySpeedKmph) continue;
      moving.push(speed);
    }
    return median(moving);
  }

  /**
   * Judge one snapshot of the corridor and return one verdict per sample.
   *
   * `atSeconds` is any monotonically increasing clock; only differences are
   * used, so a simulation's own seconds and a wall clock work equally.
   */
  observe(
    atSeconds: number,
    samples: readonly PositionSample[],
  ): ReadonlyMap<string, PlausibilityVerdict> {
    const paceKmph = this.referencePaceKmph(samples);
    const verdicts = new Map<string, PlausibilityVerdict>();
    for (const sample of samples) {
      this.seen.add(sample.vehicleId);
      const verdict = this.judge(atSeconds, sample, paceKmph);
      if (verdict.reason === "unjudged" || verdict.reason === "no_reference_speed") {
        this.unjudged += 1;
      } else {
        this.judged += 1;
      }
      if (verdict.isImplausible) {
        this.implausible += 1;
        this.rejected.add(sample.vehicleId);
      }
      verdicts.set(sample.vehicleId, verdict);
    }
    return verdicts;
  }

  private judge(
    atSeconds: number,
    sample: PositionSample,
    paceKmph: number | null,
  ): PlausibilityVerdict {
    const cfg = this.config;
    const reported = sample.distanceAlongRouteMeters;
    const prior = this.tracks.get(sample.vehicleId);
    const dt = prior ? atSeconds - prior.lastSeconds : 0;

    const anchor = (reason: PlausibilityReason): PlausibilityVerdict => {
      this.tracks.set(sample.vehicleId, {
        lastSeconds: atSeconds,
        lastReportedMeters: reported,
        lastSpeedKmph: sample.speedKmph ?? null,
        believedMeters: reported,
        cusumUp: 0,
        cusumDown: 0,
        suspect: false,
        agreeingSamples: 0,
      });
      return {
        vehicleId: sample.vehicleId,
        isImplausible: false,
        reason,
        believedDistanceAlongRouteMeters: reported,
        residualMeters: 0,
        boundMeters: 0,
      };
    };

    if (!prior || dt <= 0 || dt > cfg.maxSampleGapSeconds) {
      // Nothing to compare against, or a gap nothing can be inferred across.
      return anchor("unjudged");
    }

    // TRAPEZOID over the interval, not the instantaneous reading. A bus that
    // pulled out of a stop midway through the interval reports a speed at the
    // sample instant that describes none of it, and the disagreement that
    // produces is the single largest source of unexplained displacement on a
    // healthy vehicle - which is to say, of false rejection.
    const nowSpeedKmph =
      sample.speedKmph != null && !Number.isNaN(sample.speedKmph) ? sample.speedKmph : null;
    const ownSpeedKmph =
      nowSpeedKmph != null && prior.lastSpeedKmph != null
        ? (nowSpeedKmph + prior.lastSpeedKmph) / 2
        : nowSpeedKmph;
    const referenceKmph = ownSpeedKmph ?? paceKmph;
    if (referenceKmph == null) {
      // No speed of its own and no corridor to borrow one from. The tracker
      // has no opinion; it must not become a rejection.
      return anchor("no_reference_speed");
    }

    // How far the vehicle SAYS it went, and how far its reference speed says
    // it could have. `expected` uses the vehicle's own speed when it has one
    // because that is the independent sensor the position is being checked
    // against; the corridor pace is a fallback reference and, below, the
    // scale the tolerances are sized on.
    const reportedDelta = reported - prior.lastReportedMeters;
    const expectedDelta = referenceKmph * KMPH_TO_MPS * dt;
    const paceMps = Math.max(paceKmph ?? 0, cfg.minReferenceSpeedKmph) * KMPH_TO_MPS;
    const paceDelta = paceMps * dt;

    // Per-sample noise allowance, and the bound the accumulated residual is
    // tested against. Both sized on the larger of "what this vehicle claims"
    // and "what this corridor does", so neither a stopped bus nor a becalmed
    // corridor collapses the allowance to nothing.
    const envelope = Math.max(Math.abs(expectedDelta), paceDelta);
    const slack = cfg.speedSlack * envelope + cfg.floorMeters;
    const boundMeters = cfg.residualBoundSeconds * paceMps;
    const reacquireToleranceMeters =
      cfg.reacquireToleranceSeconds * paceMps + cfg.floorMeters;

    const unexplained = reportedDelta - expectedDelta;
    const cusumUp = Math.max(0, prior.cusumUp + unexplained - slack);
    const cusumDown = Math.max(0, prior.cusumDown - unexplained - slack);
    const residualMeters = Math.max(cusumUp, cusumDown);

    // The belief is propagated from the vehicle's own reported speed, never
    // from its reported position - that is what makes it independent of the
    // quantity under suspicion, and what makes it usable as a fallback.
    const believedMeters = prior.believedMeters + referenceKmph * KMPH_TO_MPS * dt;
    const disagreementMeters = Math.abs(reported - believedMeters);

    if (prior.suspect) {
      // Already rejected. Only agreement with the belief ends it - a decayed
      // CUSUM must not, because a constant offset stops producing new
      // evidence the moment it has arrived.
      const agrees = disagreementMeters <= reacquireToleranceMeters;
      const agreeingSamples = agrees ? prior.agreeingSamples + 1 : 0;
      const reacquired = agreeingSamples >= cfg.reacquireSamples;
      if (reacquired) {
        this.tracks.set(sample.vehicleId, {
          lastSeconds: atSeconds,
          lastReportedMeters: reported,
          lastSpeedKmph: nowSpeedKmph,
          believedMeters: reported,
          cusumUp: 0,
          cusumDown: 0,
          suspect: false,
          agreeingSamples: 0,
        });
        return {
          vehicleId: sample.vehicleId,
          isImplausible: false,
          reason: "plausible",
          believedDistanceAlongRouteMeters: reported,
          residualMeters: 0,
          boundMeters,
        };
      }
      this.tracks.set(sample.vehicleId, {
        lastSeconds: atSeconds,
        lastReportedMeters: reported,
        lastSpeedKmph: nowSpeedKmph,
        believedMeters,
        cusumUp,
        cusumDown,
        suspect: true,
        agreeingSamples,
      });
      return {
        vehicleId: sample.vehicleId,
        isImplausible: true,
        reason: "awaiting_reacquisition",
        believedDistanceAlongRouteMeters: believedMeters,
        residualMeters,
        boundMeters,
      };
    }

    if (residualMeters > boundMeters) {
      this.tracks.set(sample.vehicleId, {
        lastSeconds: atSeconds,
        lastReportedMeters: reported,
        lastSpeedKmph: nowSpeedKmph,
        // The belief is rolled back to where the vehicle was last believed to
        // be BEFORE this sample's unexplained jump, then advanced by the
        // reference speed alone. Anchoring it on the fix that has just been
        // rejected would adopt the lie as the correction.
        believedMeters: prior.believedMeters + referenceKmph * KMPH_TO_MPS * dt,
        cusumUp,
        cusumDown,
        suspect: true,
        agreeingSamples: 0,
      });
      return {
        vehicleId: sample.vehicleId,
        isImplausible: true,
        reason: cusumUp >= cusumDown ? "displacement_above_reference" : "displacement_below_reference",
        believedDistanceAlongRouteMeters: believedMeters,
        residualMeters,
        boundMeters,
      };
    }

    // Plausible: the belief re-anchors on the fix, which is what keeps
    // integration error from accumulating on a healthy vehicle.
    this.tracks.set(sample.vehicleId, {
      lastSeconds: atSeconds,
      lastReportedMeters: reported,
      lastSpeedKmph: nowSpeedKmph,
      believedMeters: reported,
      cusumUp,
      cusumDown,
      suspect: false,
      agreeingSamples: 0,
    });
    return {
      vehicleId: sample.vehicleId,
      isImplausible: false,
      reason: "plausible",
      believedDistanceAlongRouteMeters: reported,
      residualMeters,
      boundMeters,
    };
  }

  audit(): PlausibilityAudit {
    return {
      judgedSamples: this.judged,
      unjudgedSamples: this.unjudged,
      implausibleSamples: this.implausible,
      implausibleVehicleIds: new Set(this.rejected),
      seenVehicleIds: new Set(this.seen),
    };
  }
}

/**
 * How a rejected fix is handled downstream.
 *
 * `correct` substitutes the dead-reckoned belief for the reported position
 * and keeps the vehicle in the chain - the shape the investigation
 * recommends, because it removes the lie from `corridorPaceKmph` and from
 * the ranking while leaving the vehicle eligible for control.
 *
 * `exclude` drops the vehicle from the chain the way a low-confidence match
 * is dropped. It is the more conservative half of the same correction and is
 * kept because it is the variant the report's §4c suppression measured; it
 * necessarily also removes the vehicle from CONTROL, which is why it is not
 * the default.
 */
export type PlausibilityMode = "correct" | "exclude";

/**
 * A rejected vehicle's SPEED is as untrustworthy as its position - under a
 * frozen feed the two are frozen together by construction
 * (`simulation/types.ts#Disturbance`) - so both call sites keep it out of the
 * pace median. In `exclude` mode `ordering.ts` does that already by ranking it
 * -1, which is what `headway/metrics.ts#corridorPaceKmph` skips on; in
 * `correct` mode the vehicle keeps its rank, so the speed is withheld
 * explicitly where the lookup is built.
 *
 * With ONE deliberate exception: the vehicle currently being decided about
 * keeps its own speed, because that is the divisor its own forward headway is
 * computed with and a null there is a declined hold rather than an exclusion
 * from a median. See `rehearsal/deployedControlLaws.ts` at
 * `speedByVehicleId.set(followerId, ...)` for the measurement.
 */
