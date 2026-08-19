// Fitting the models every controller above them depends on.
//
// The dwell fit is the one that matters most, and not because dwell times
// are interesting: `1 + beta_h` is the eigenvalue of headway propagation, so
// fitting it is how this system finally says HOW FAST a given corridor comes
// apart. That number decides whether a corridor needs control at all and how
// early the control has to act.
//
// All three fit from `stop_visits`, which fills from the GPS feed already
// running - no UPSRTC archive needed - except the demand model, which needs
// boardings and is asserted here to stay silent until it has them.
import { describe, it, expect } from 'vitest';
import {
  buildDwellObservations,
  expectedDwellSeconds,
  fitDwellModel,
  headwayAmplification,
} from '../src/calibration/dwell.js';
import {
  buildLinkObservations,
  fitLinkTravelTimes,
  istPeakBand,
} from '../src/calibration/linkTravelTime.js';
import { fitDemandModel } from '../src/calibration/demand.js';
import type { StopVisitRecord } from '../src/headway/stopHeadway.js';

const BASE = Date.UTC(2026, 7, 19, 6, 0, 0);

function visit(
  vehicleId: string,
  stopId: string,
  arrivedOffsetSeconds: number,
  dwellSeconds: number,
  routeDirectionId = 'rd-1',
): StopVisitRecord {
  const arrived = BASE + arrivedOffsetSeconds * 1000;
  return {
    vehicleId,
    stopId,
    routeDirectionId,
    arrivedAt: new Date(arrived).toISOString(),
    departedAt: new Date(arrived + dwellSeconds * 1000).toISOString(),
  };
}

describe('buildDwellObservations', () => {
  it('pairs each dwell with the headway that fed it', () => {
    const observations = buildDwellObservations([
      visit('bus-1', 'stop-A', 0, 20),
      visit('bus-2', 'stop-A', 600, 40),
    ]);

    expect(observations).toHaveLength(1);
    // bus-1 departed at t=20, bus-2 at t=640 -> 620s headway, 40s dwell.
    expect(observations[0]!.precedingHeadwaySeconds).toBe(620);
    expect(observations[0]!.dwellSeconds).toBe(40);
  });

  // The first bus at a stop has no predecessor. Pairing it with a guessed
  // headway would put a fabricated regressor into the fit.
  it('drops the first visit at a stop rather than inventing its headway', () => {
    expect(buildDwellObservations([visit('bus-1', 'stop-A', 0, 20)])).toHaveLength(0);
  });

  it('keeps stops and directions apart', () => {
    const observations = buildDwellObservations([
      visit('bus-1', 'stop-A', 0, 20, 'rd-IN'),
      visit('bus-2', 'stop-A', 600, 40, 'rd-OUT'),
    ]);
    expect(observations).toHaveLength(0);
  });
});

describe('fitDwellModel', () => {
  /** dwell = 10 + 0.05 x headway, exactly. */
  function linearVisits(count: number, beta0 = 10, betaH = 0.05): StopVisitRecord[] {
    const visits: StopVisitRecord[] = [];
    let t = 0;
    let previousDeparture = 0;
    for (let i = 0; i < count; i++) {
      const headway = 300 + i * 30;
      t = previousDeparture + headway;
      const dwell = beta0 + betaH * headway;
      visits.push(visit('bus-x', 'stop-A', t - dwell, dwell));
      previousDeparture = t;
    }
    return visits;
  }

  it('recovers the intercept and slope from clean data', () => {
    const models = fitDwellModel(buildDwellObservations(linearVisits(20)));
    expect(models).toHaveLength(1);
    expect(models[0]!.beta0Seconds).toBeCloseTo(10, 4);
    expect(models[0]!.betaHeadway).toBeCloseTo(0.05, 6);
    expect(models[0]!.rSquared).toBeCloseTo(1, 6);
  });

  // The point of the whole module: a positive slope means this stop
  // amplifies headway deviations, so bunching is inevitable without control.
  it('reports an amplification above 1 for a stop where dwell grows with headway', () => {
    const models = fitDwellModel(buildDwellObservations(linearVisits(20)));
    expect(headwayAmplification(models[0]!)).toBeCloseTo(1.05, 6);
    expect(headwayAmplification(models[0]!)).toBeGreaterThan(1);
  });

  // A fit over three points passes through them and means nothing. Below the
  // threshold a stop gets NO model rather than a confident wrong one.
  it('emits no model for a stop with too few observations', () => {
    expect(fitDwellModel(buildDwellObservations(linearVisits(5)), 12)).toHaveLength(0);
  });

  it('emits no model when every observation shared one headway, so the slope is unidentifiable', () => {
    const visits: StopVisitRecord[] = [];
    for (let i = 0; i < 20; i++) visits.push(visit('bus-x', 'stop-A', i * 600, 30));
    expect(fitDwellModel(buildDwellObservations(visits), 5)).toHaveLength(0);
  });
});

describe('expectedDwellSeconds', () => {
  const model = {
    stopId: 'stop-A',
    routeDirectionId: 'rd-1',
    beta0Seconds: 10,
    betaHeadway: 0.05,
    rSquared: 0.8,
    sampleCount: 30,
  };

  it('predicts a longer dwell after a longer gap', () => {
    expect(expectedDwellSeconds(model, 600)).toBe(40);
    expect(expectedDwellSeconds(model, 1200)).toBe(70);
  });

  // A negative expected dwell would make every real dwell look excessive to
  // the denied-boarding detector.
  it('floors at zero rather than extrapolating a fit below its own data', () => {
    expect(expectedDwellSeconds({ ...model, beta0Seconds: -50 }, 100)).toBe(0);
  });
});

describe('buildLinkObservations', () => {
  it('measures a link from one vehicle departing A to arriving at B', () => {
    const observations = buildLinkObservations([
      visit('bus-1', 'stop-A', 0, 20),
      visit('bus-1', 'stop-B', 320, 15),
    ]);

    expect(observations).toHaveLength(1);
    // Departed A at t=20, arrived B at t=320.
    expect(observations[0]!.travelSeconds).toBe(300);
    expect(observations[0]!.fromStopId).toBe('stop-A');
    expect(observations[0]!.toStopId).toBe('stop-B');
  });

  it('never pairs visits by two different vehicles', () => {
    const observations = buildLinkObservations([
      visit('bus-1', 'stop-A', 0, 20),
      visit('bus-2', 'stop-B', 320, 15),
    ]);
    expect(observations).toHaveLength(0);
  });

  // A missed geofence or GPS dropout would otherwise become one enormous
  // traversal, and a single such row dominates the p90 this exists to report.
  it('drops an implausibly long traversal rather than clamping it', () => {
    const observations = buildLinkObservations(
      [visit('bus-1', 'stop-A', 0, 20), visit('bus-1', 'stop-B', 99_999, 15)],
      3600,
    );
    expect(observations).toHaveLength(0);
  });
});

describe('fitLinkTravelTimes', () => {
  function linkVisits(travelTimes: number[]): StopVisitRecord[] {
    const visits: StopVisitRecord[] = [];
    let t = 0;
    for (const [i, travel] of travelTimes.entries()) {
      visits.push(visit(`bus-${i}`, 'stop-A', t, 10));
      visits.push(visit(`bus-${i}`, 'stop-B', t + 10 + travel, 10));
      t += 600;
    }
    return visits;
  }

  it('reports the empirical distribution, not just a mean', () => {
    const times = [280, 290, 300, 300, 310, 320, 330, 900];
    const models = fitLinkTravelTimes(buildLinkObservations(linkVisits(times)), () => null, 8);

    expect(models).toHaveLength(1);
    expect(models[0]!.sampleCount).toBe(8);
    expect(models[0]!.p50Seconds).toBe(300);
    // The tail is where controller robustness lives: p90 is the 900s run,
    // and a mean alone would have hidden it inside 378s.
    expect(models[0]!.p90Seconds).toBe(900);
    expect(models[0]!.samplesSeconds).toEqual([...times].sort((a, b) => a - b));
  });

  it('emits nothing for a link with too few traversals to have a percentile', () => {
    expect(fitLinkTravelTimes(buildLinkObservations(linkVisits([300, 310])), () => null, 8)).toHaveLength(0);
  });

  it('separates time-of-day bands so peak and off-peak are not pooled', () => {
    const observations = buildLinkObservations(linkVisits(Array.from({ length: 20 }, () => 300)));
    const banded = fitLinkTravelTimes(observations, istPeakBand, 2);
    expect(banded.every((m) => m.hourBand !== null)).toBe(true);
  });
});

describe('istPeakBand', () => {
  it('puts the IST morning and evening peaks in their own bands', () => {
    expect(istPeakBand(3)).toBe(0); // 08:00 IST
    expect(istPeakBand(13)).toBe(2); // 18:00 IST
    expect(istPeakBand(8)).toBe(1); // 13:00 IST
  });
});

describe('fitDemandModel', () => {
  // The state today, and the one that must stay honest: no boardings
  // anywhere, so no lambda. Callers fall back to the documented 1/H* proxy;
  // a zero would tell the objective nobody is waiting and suppress every hold.
  it('fits nothing at all when no boardings have been observed', () => {
    const visits = [visit('bus-1', 'stop-A', 0, 20), visit('bus-2', 'stop-A', 600, 20)];
    expect(fitDemandModel(visits, [])).toEqual([]);
  });

  it('fits lambda as total boardings over total elapsed headway', () => {
    const visits: StopVisitRecord[] = [];
    const boardings = [];
    for (let i = 0; i < 12; i++) {
      const v = visit(`bus-${i}`, 'stop-A', i * 600, 20);
      visits.push(v);
      boardings.push({
        stopId: 'stop-A',
        routeDirectionId: 'rd-1',
        vehicleId: `bus-${i}`,
        departedAt: v.departedAt,
        boardings: 10,
      });
    }

    const models = fitDemandModel(visits, boardings, () => null, 5);
    expect(models).toHaveLength(1);
    // 10 boardings per 600s gap = 1/60 pax per second.
    expect(models[0]!.arrivalRatePaxPerSecond).toBeCloseTo(10 / 600, 6);
    expect(models[0]!.meanBoardingsPerVisit).toBe(10);
  });

  // A visit with no ticket record is UNOBSERVED, not empty. Counting it as
  // zero would drag lambda down in proportion to how patchy the feed is.
  it('skips visits with no matching ticket record rather than counting them as zero boardings', () => {
    const visits: StopVisitRecord[] = [];
    const boardings = [];
    for (let i = 0; i < 12; i++) {
      const v = visit(`bus-${i}`, 'stop-A', i * 600, 20);
      visits.push(v);
      // Only half the visits have ticket data.
      if (i % 2 === 0) {
        boardings.push({
          stopId: 'stop-A',
          routeDirectionId: 'rd-1',
          vehicleId: `bus-${i}`,
          departedAt: v.departedAt,
          boardings: 10,
        });
      }
    }

    const models = fitDemandModel(visits, boardings, () => null, 3);
    // Observed visits each carry a 1200s gap from the last observed one, but
    // lambda is computed over the gaps actually paired with a count - not
    // diluted by the unobserved ones.
    expect(models[0]!.meanBoardingsPerVisit).toBe(10);
    expect(models[0]!.arrivalRatePaxPerSecond).toBeGreaterThan(0);
  });
});
