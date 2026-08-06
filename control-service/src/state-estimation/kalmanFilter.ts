// Constant-velocity Kalman filter smoothing distance-along-route (s) and
// speed (v) for one vehicle. State is [s, v]; process noise is driven by
// an assumed acceleration variance (a "white-noise acceleration" model),
// which is the standard choice for smoothing noisy road-vehicle GPS
// tracks. serialize()/deserialize (via the constructor) round-trip the
// full filter state so a restart can resume from the persisted value
// instead of re-converging from a cold prior (AC: "State persists so a
// restart rebuilds current state without a full new observation cycle").

import type { Covariance2x2, KalmanState } from "./types.js";

export interface KalmanFilterOptions {
  /** Acceleration variance driving process noise, in (m/s^2)^2. */
  processNoiseAccelVariance?: number;
  /** Default GPS fix variance, in m^2, used when a fix doesn't carry its own. */
  measurementNoiseVarianceMeters2?: number;
}

const DEFAULT_ACCEL_VARIANCE = 0.015;
const DEFAULT_MEASUREMENT_VARIANCE_METERS2 = 225; // ~15m stddev, typical consumer GPS
// A freshly map-matched vehicle (no smoothing history yet) is only as
// certain as its single raw fix, and its speed is completely unknown -
// both deliberately wider than the steady-state covariance the filter
// converges to after a few consistent updates, so a cold start is
// genuinely less confident than a warm, persisted one (see
// kalmanFilter.test.ts's "resumes ... instead of resetting to a cold,
// wide prior").
const INITIAL_POSITION_VARIANCE_METERS2 = 400;
const INITIAL_VELOCITY_VARIANCE = 100;

export class DistanceKalmanFilter {
  private s: number;
  private v: number;
  private p: Covariance2x2;
  private updatedAt: Date;
  private readonly accelVariance: number;
  private readonly defaultMeasurementVariance: number;

  constructor(state: KalmanState, options: KalmanFilterOptions = {}) {
    this.s = state.s;
    this.v = state.v;
    this.p = state.p;
    this.updatedAt = new Date(state.updatedAt);
    this.accelVariance = options.processNoiseAccelVariance ?? DEFAULT_ACCEL_VARIANCE;
    this.defaultMeasurementVariance =
      options.measurementNoiseVarianceMeters2 ?? DEFAULT_MEASUREMENT_VARIANCE_METERS2;
  }

  static initialize(
    measuredS: number,
    observedAt: Date,
    options: KalmanFilterOptions = {}
  ): DistanceKalmanFilter {
    return new DistanceKalmanFilter(
      {
        s: measuredS,
        v: 0,
        p: [
          [INITIAL_POSITION_VARIANCE_METERS2, 0],
          [0, INITIAL_VELOCITY_VARIANCE],
        ],
        updatedAt: observedAt.toISOString(),
      },
      options
    );
  }

  get smoothedDistanceMeters(): number {
    return this.s;
  }

  get smoothedSpeedMetersPerSecond(): number {
    return this.v;
  }

  /** Advances the state estimate (and covariance) to `toTime` with no new measurement. */
  predict(toTime: Date): void {
    const dt = Math.max(0, (toTime.getTime() - this.updatedAt.getTime()) / 1000);
    if (dt === 0) return;

    const q = this.accelVariance;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    const dt4 = dt2 * dt2;

    const p00 = this.p[0][0];
    const p01 = this.p[0][1];
    const p10 = this.p[1][0];
    const p11 = this.p[1][1];

    // F = [[1, dt], [0, 1]]; P' = F P F^T + Q, with Q the discretized
    // white-noise-acceleration process noise for this dt.
    const fp00 = p00 + dt * p10;
    const fp01 = p01 + dt * p11;

    const newP00 = fp00 + dt * fp01 + (dt4 / 4) * q;
    const newP01 = fp01 + (dt3 / 2) * q;
    const newP10 = p10 + dt * p11 + (dt3 / 2) * q;
    const newP11 = p11 + dt2 * q;

    this.s = this.s + this.v * dt;
    this.p = [
      [newP00, newP01],
      [newP10, newP11],
    ];
    this.updatedAt = toTime;
  }

  /** Predicts to `observedAt` then assimilates `measuredS` (already loop-unwrapped if applicable). */
  update(measuredS: number, observedAt: Date, measurementVarianceMeters2?: number): void {
    this.predict(observedAt);

    const r = measurementVarianceMeters2 ?? this.defaultMeasurementVariance;
    const p00 = this.p[0][0];
    const p01 = this.p[0][1];
    const p10 = this.p[1][0];
    const p11 = this.p[1][1];

    const innovation = measuredS - this.s;
    const innovationVariance = p00 + r;
    const k0 = p00 / innovationVariance;
    const k1 = p10 / innovationVariance;

    this.s = this.s + k0 * innovation;
    this.v = this.v + k1 * innovation;

    this.p = [
      [(1 - k0) * p00, (1 - k0) * p01],
      [p10 - k1 * p00, p11 - k1 * p01],
    ];
    this.updatedAt = observedAt;
  }

  serialize(): KalmanState {
    return { s: this.s, v: this.v, p: this.p, updatedAt: this.updatedAt.toISOString() };
  }
}
