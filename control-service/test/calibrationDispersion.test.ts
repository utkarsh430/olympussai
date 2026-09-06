// Measuring the input every headline figure is most sensitive to.
//
// `travelTimeVariation` is the CV of ONE LEG's running time, and the shipped
// 0.18 is invented. It is also routinely confused with the headway CV, which
// is an OUTCOME of dispersion rather than a measure of it - a network headway
// CV of 1.78 does not mean a leg's running time varies by 178%. These tests
// pin the estimator, pin that it is not starved the way the eight-traversal
// one is, and pin that the two quantities are reported apart.
import { describe, it, expect } from 'vitest';
import {
  headwayDispersionDiagnostic,
  measureDispersion,
  MIN_TRAVERSALS_FOR_VARIANCE,
} from '../src/calibration/dispersion.js';
import type { LinkObservation } from '../src/calibration/linkTravelTime.js';

function traversals(
  toStopId: string,
  seconds: readonly number[],
  fromStopId = 'A',
): LinkObservation[] {
  return seconds.map((travelSeconds) => ({
    routeDirectionId: 'rd-1',
    fromStopId,
    toStopId,
    travelSeconds,
    hourOfDay: 9,
  }));
}

/** Sample (n-1) coefficient of variation, written out so the expectation is not the implementation. */
function sampleCv(values: readonly number[]): number {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) / mean;
}

describe('measureDispersion', () => {
  it('recovers a single link"s own coefficient of variation', () => {
    const seconds = [280, 300, 320, 340, 360];
    const measurement = measureDispersion(traversals('B', seconds));

    expect(measurement.linksPooled).toBe(1);
    expect(measurement.pooledCoefficientOfVariation).toBeCloseTo(sampleCv(seconds), 10);
  });

  it('uses the sample standard deviation, not the population one fitLinkTravelTimes reports', () => {
    // At n = 3 the population estimator is sqrt(2/3) = 0.816 of the sample
    // one, so a dispersion read off fitLinkTravelTimes understates the spread
    // by 18% exactly where the data is thinnest.
    const seconds = [280, 300, 320];
    const measurement = measureDispersion(traversals('B', seconds));
    const mean = 300;
    const populationCv = Math.sqrt(((20 * 20 + 0 + 20 * 20) / 3)) / mean;

    expect(measurement.pooledCoefficientOfVariation).toBeCloseTo(sampleCv(seconds), 10);
    expect(measurement.pooledCoefficientOfVariation!).toBeGreaterThan(populationCv);
  });

  it('measures a corridor no link of which reaches the eight-traversal fit', () => {
    // The starvation this estimator exists for: measured on the live network,
    // six links out of 687 reach fitLinkTravelTimes' minimum, so the estimator
    // eligibility.ts uses today answers "nothing" on almost every corridor.
    const observations = [
      ...traversals('B', [280, 300, 320]),
      ...traversals('C', [580, 600, 620], 'B'),
      ...traversals('D', [880, 900, 920], 'C'),
    ];
    const measurement = measureDispersion(observations);

    expect(measurement.eligibilityStyleLinks).toBe(0);
    expect(measurement.eligibilityStyleMean).toBeNull();
    expect(measurement.linksPooled).toBe(3);
    expect(measurement.pooledCoefficientOfVariation).not.toBeNull();
  });

  it('weights a link by its degrees of freedom, so one thin link cannot set the answer', () => {
    // A calm link seen many times and a wild link seen twice. An unweighted
    // mean of the two CVs would land halfway; the pooled one stays near the
    // link that was actually observed.
    const calm = traversals('B', [295, 300, 305, 298, 302, 299, 301, 300, 303, 297]);
    const wild = traversals('C', [100, 900], 'B');
    const measurement = measureDispersion([...calm, ...wild]);

    const unweightedMean =
      measurement.perLink.reduce((s, l) => s + l.coefficientOfVariation, 0) /
      measurement.perLink.length;

    expect(measurement.pooledCoefficientOfVariation!).toBeLessThan(unweightedMean);
    expect(measurement.degreesOfFreedom).toBe(10);
  });

  it('reports the per-link spread it pooled over, because the pooling assumes that spread is modest', () => {
    const measurement = measureDispersion([
      ...traversals('B', [295, 300, 305]),
      ...traversals('C', [100, 600, 1100], 'B'),
    ]);
    expect(measurement.perLink).toHaveLength(2);
    expect(measurement.medianCoefficientOfVariation).not.toBeNull();
    const cvs = measurement.perLink.map((l) => l.coefficientOfVariation);
    expect(Math.max(...cvs) / Math.min(...cvs)).toBeGreaterThan(5);
  });

  it('measures nothing rather than zero when no link was traversed twice', () => {
    // Zero dispersion is a claim - it says this corridor is perfectly regular.
    // One traversal per link says nothing at all, and the two must not read
    // the same, exactly as an uncalibrated target headway does not read as 0.
    const measurement = measureDispersion([
      ...traversals('B', [300]),
      ...traversals('C', [600], 'B'),
    ]);

    expect(MIN_TRAVERSALS_FOR_VARIANCE).toBe(2);
    expect(measurement.linksPooled).toBe(0);
    expect(measurement.pooledCoefficientOfVariation).toBeNull();
    expect(measurement.medianCoefficientOfVariation).toBeNull();
  });
});

describe('headwayDispersionDiagnostic', () => {
  it('is a different number from the leg-time CV and is not interchangeable with it', () => {
    // Buses 60s and 3,000s apart on a corridor whose legs are metronomic. Leg
    // dispersion is near zero; headway CV is above 1. Substituting one for the
    // other is how a 1.78 network headway CV becomes a claim about roads.
    const legs = measureDispersion(traversals('B', [300, 300, 301, 299, 300, 300]));
    const headways = headwayDispersionDiagnostic([60, 3000, 60, 3000, 60, 3000]);

    expect(legs.pooledCoefficientOfVariation!).toBeLessThan(0.01);
    expect(headways.coefficientOfVariation!).toBeGreaterThan(0.9);
  });

  it('declines to report a CV from a single gap', () => {
    expect(headwayDispersionDiagnostic([900]).coefficientOfVariation).toBeNull();
  });

  it('ignores the zero and negative gaps a stationary vehicle produces', () => {
    const withArtefacts = headwayDispersionDiagnostic([900, 0, 910, -5, 890]);
    expect(withArtefacts.count).toBe(3);
  });
});
