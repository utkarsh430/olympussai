import { describe, expect, it } from "vitest";
import { DistanceKalmanFilter } from "../src/state-estimation/kalmanFilter.js";

describe("DistanceKalmanFilter", () => {
  it("smooths a noisy sequence of measurements toward the true underlying trend", () => {
    const start = new Date("2026-08-05T08:00:00.000Z");
    // True motion: 10 m/s starting at s=0. Measurements have +/-8m noise.
    const trueSpeed = 10;
    const noise = [8, -6, 5, -8, 6, -4, 7, -5];

    const filter = DistanceKalmanFilter.initialize(noise[0]!, start);
    let lastEstimate = filter.smoothedDistanceMeters;

    for (let i = 1; i < noise.length; i++) {
      const t = new Date(start.getTime() + i * 5000);
      const trueS = trueSpeed * (i * 5);
      filter.update(trueS + noise[i]!, t);
      lastEstimate = filter.smoothedDistanceMeters;
    }

    const finalTrueS = trueSpeed * ((noise.length - 1) * 5);
    // The filter should track the true trend much more closely than the
    // raw noise amplitude (+/-8m) would suggest on its own.
    expect(Math.abs(lastEstimate - finalTrueS)).toBeLessThan(8);
    expect(filter.smoothedSpeedMetersPerSecond).toBeGreaterThan(0);
  });

  it("does not move the estimate when predicting with dt = 0", () => {
    const t = new Date("2026-08-05T08:00:00.000Z");
    const filter = DistanceKalmanFilter.initialize(100, t);
    filter.predict(t);
    expect(filter.smoothedDistanceMeters).toBe(100);
  });

  it("serialize()/reconstruct round-trips to an equivalent filter", () => {
    const t = new Date("2026-08-05T08:00:00.000Z");
    const filter = DistanceKalmanFilter.initialize(100, t);
    filter.update(150, new Date(t.getTime() + 10000));

    const serialized = filter.serialize();
    const restored = new DistanceKalmanFilter(serialized);

    expect(restored.smoothedDistanceMeters).toBeCloseTo(filter.smoothedDistanceMeters, 6);
    expect(restored.smoothedSpeedMetersPerSecond).toBeCloseTo(filter.smoothedSpeedMetersPerSecond, 6);
  });

  it("a filter restored from persisted state resumes with tight covariance instead of resetting to a cold, wide prior", () => {
    const t = new Date("2026-08-05T08:00:00.000Z");
    // Warm up a filter with several consistent measurements so its
    // covariance narrows well below the wide initial prior.
    const warm = DistanceKalmanFilter.initialize(0, t);
    for (let i = 1; i <= 10; i++) {
      warm.update(i * 100, new Date(t.getTime() + i * 10000));
    }
    const warmState = warm.serialize();
    const [[warmPss]] = warmState.p;

    const coldState = DistanceKalmanFilter.initialize(1000, new Date(t.getTime() + 100000)).serialize();
    const [[coldPss]] = coldState.p;

    expect(warmPss).toBeLessThan(coldPss);

    // Restoring from the warm, persisted state must keep that tight
    // covariance rather than resetting it - this is what lets a restart
    // resume without a full new observation cycle.
    const restored = new DistanceKalmanFilter(warmState);
    expect(restored.serialize().p[0][0]).toBeCloseTo(warmPss, 6);
  });
});
