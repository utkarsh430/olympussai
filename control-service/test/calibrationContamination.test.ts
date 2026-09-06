// What has to be thrown away before a fitted lambda means anything.
//
// The dwell model is a model of BOARDING, and `stop_visits` cannot tell a bus
// serving a stop from one laying over at a terminal or parked inside the
// geofence. Pooled, the second and third do not add noise - they add signal
// about a crew roster, and `lambda = beta_h / beta_b` turns that signal into
// a passenger arrival rate nobody arrived at. These tests pin the exclusion,
// and pin that it is OFF by default and off is byte-identical.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VEHICLE_CAPACITY,
  excludeContaminatedDwells,
  excludeContaminatedLinks,
  maxBoardingDwellSeconds,
  describeContamination,
} from '../src/calibration/contamination.js';
import {
  contaminationFilterEnabled,
  CONTAMINATION_FILTER_ENV,
} from '../src/calibration/flags.js';
import { buildDwellObservations } from '../src/calibration/dwell.js';
import { buildLinkObservations } from '../src/calibration/linkTravelTime.js';
import {
  calibrateFromVisits,
  describeCalibration,
  DEFAULT_SECONDS_PER_BOARDING,
} from '../src/evaluation/calibrate.js';
import type { StopVisitRecord } from '../src/headway/stopHeadway.js';

const BASE = Date.UTC(2026, 8, 6, 6, 0, 0);

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

/** A three-stop corridor 1 km between stops, in route order. */
const CORRIDOR = {
  routeDirectionId: 'rd-1',
  stops: [
    { stopId: 'A', cumulativeDistanceMeters: 0 },
    { stopId: 'B', cumulativeDistanceMeters: 1000 },
    { stopId: 'C', cumulativeDistanceMeters: 2000 },
  ],
};

describe('maxBoardingDwellSeconds', () => {
  it('is the arithmetic the dwell model implies, not a percentile of the data', () => {
    // beta_0 overhead + beta_b x capacity. Nothing about the observations
    // enters it, which is what lets it report that it found no contamination.
    expect(maxBoardingDwellSeconds(2.5, 52, 120)).toBe(120 + 2.5 * 52);
    expect(maxBoardingDwellSeconds(2.5, 100, 120)).toBe(120 + 2.5 * 100);
  });

  it('scales with the assumed seconds-per-boarding, like every other derived quantity here', () => {
    expect(maxBoardingDwellSeconds(5, 52, 120)).toBeGreaterThan(maxBoardingDwellSeconds(2.5, 52, 120));
  });
});

describe('excludeContaminatedDwells', () => {
  const observations = buildDwellObservations([
    // Three ordinary service dwells at one stop, 15-minute gaps.
    visit('v1', 'A', 0, 40),
    visit('v2', 'A', 900, 55),
    visit('v3', 'A', 1800, 70),
    // A layover: the same stop, 40 minutes stood still.
    visit('v4', 'A', 2700, 2400),
  ]);

  it('removes a dwell no full vehicle boarding could have produced', () => {
    const bound = maxBoardingDwellSeconds(DEFAULT_SECONDS_PER_BOARDING);
    const { kept, exclusions } = excludeContaminatedDwells(observations, bound);

    expect(observations).toHaveLength(3);
    expect(kept).toHaveLength(2);
    expect(kept.every((o) => o.dwellSeconds <= bound)).toBe(true);
    expect(exclusions[0]!.removed).toBe(1);
    expect(exclusions[0]!.judged).toBe(3);
  });

  it('reports removing nothing when nothing is over the bound, rather than taking a fixed share', () => {
    const { kept, exclusions } = excludeContaminatedDwells(observations, 100_000);
    expect(kept).toHaveLength(observations.length);
    expect(exclusions[0]!.removed).toBe(0);
  });
});

describe('excludeContaminatedLinks', () => {
  it('drops a traversal that spans two legs because a geofence was missed', () => {
    // v1 is recorded at A then C: B was missed, so A->C is not a link of this
    // corridor. `fitLinkTravelTimes` would file its time against the leg into
    // C, which is B->C.
    const observations = buildLinkObservations([
      visit('v1', 'A', 0, 30),
      visit('v1', 'C', 300, 30),
    ]);
    expect(observations).toHaveLength(1);

    const { kept, exclusions } = excludeContaminatedLinks(observations, CORRIDOR);
    expect(kept).toHaveLength(0);
    expect(exclusions[0]!.removed).toBe(1);
  });

  it('keeps a traversal of one real leg', () => {
    const observations = buildLinkObservations([
      visit('v1', 'A', 0, 30),
      visit('v1', 'B', 150, 30),
    ]);
    const { kept } = excludeContaminatedLinks(observations, CORRIDOR);
    expect(kept).toHaveLength(1);
  });

  it('drops a stationary vehicle map-matched between two stops it never drove between', () => {
    // 1 km in 3 seconds is 1,200 km/h. The observed network distribution
    // reaches 1,346 km/h, so this is the real artefact and not a hypothetical.
    const observations = buildLinkObservations([
      visit('v1', 'A', 0, 0),
      visit('v1', 'B', 3, 30),
    ]);
    expect(observations).toHaveLength(1);

    const { kept, exclusions, impliedSpeedChecked } = excludeContaminatedLinks(observations, CORRIDOR);
    expect(impliedSpeedChecked).toBe(true);
    expect(kept).toHaveLength(0);
    expect(exclusions[1]!.removed).toBe(1);
  });

  it('says it judged nothing on speed when the corridor supplied no leg distances', () => {
    // A silent pass would read exactly like a corridor with no artefacts.
    const observations = buildLinkObservations([
      visit('v1', 'A', 0, 0),
      visit('v1', 'B', 3, 30),
    ]);
    const geometryless = { stops: [{ stopId: 'A' }, { stopId: 'B' }, { stopId: 'C' }] };
    const { kept, impliedSpeedChecked } = excludeContaminatedLinks(observations, geometryless);

    expect(impliedSpeedChecked).toBe(false);
    expect(kept).toHaveLength(1);
    expect(describeContamination({
      dwell: { kept: 0, considered: 0, exclusions: [], maxBoardingDwellSeconds: 250 },
      link: { kept: kept.length, considered: 1, exclusions: [], impliedSpeedChecked },
    }).join(' ')).toContain('judged NOTHING');
  });
});

describe('the contamination filter as a switch on calibrateFromVisits', () => {
  /**
   * A corridor whose SERVICE dwells carry a modest beta_h, plus a layover at
   * one stop whose length tracks the dispatch interval steeply - which is what
   * a terminal layover really does, because both come from one timetable.
   */
  function contaminatedLog(): StopVisitRecord[] {
    // Generated in DEPARTURE order at one stop, because that is the order
    // `buildDwellObservations` differences: each visit's dwell is set from the
    // gap since the previous DEPARTURE, so the relationship the fitter looks
    // for holds exactly rather than approximately.
    const visits: StopVisitRecord[] = [];
    let departure = 0;
    for (let i = 0; i < 60; i++) {
      const headway = 600 + (i % 7) * 150;
      departure += headway;
      const isLayover = i % 2 === 1;
      // Service: 30s + 0.02 x h, a real boarding slope. Layover: 20 minutes
      // plus half the interval - steeper, and not one passenger of it is
      // boarding. Both are positive slopes, so the contaminated fit does not
      // fail for an unrelated reason.
      const dwell = isLayover ? 1200 + 0.5 * headway : 30 + 0.02 * headway;
      visits.push(visit(`${isLayover ? 'lay' : 'svc'}-${i}`, 'A', departure - dwell, dwell));
    }
    return visits;
  }

  it('is OFF by default and off leaves the fit exactly as it was', () => {
    const log = contaminatedLog();
    const withoutOption = calibrateFromVisits(CORRIDOR, log);
    const explicitlyOff = calibrateFromVisits(CORRIDOR, log, DEFAULT_SECONDS_PER_BOARDING, {
      excludeContamination: false,
    });

    expect(withoutOption.stops).toEqual(explicitlyOff.stops);
    expect(withoutOption.contamination.filterApplied).toBe(false);
  });

  it('counts what it WOULD have removed even with the filter off, so a report can say so', () => {
    const calibration = calibrateFromVisits(CORRIDOR, contaminatedLog());
    const dwell = calibration.contamination.dwell;

    expect(calibration.contamination.filterApplied).toBe(false);
    expect(dwell.considered).toBeGreaterThan(0);
    expect(dwell.considered - dwell.kept).toBeGreaterThan(0);
  });

  it('excludes the layover from the fit when switched on, and the fitted lambda falls', () => {
    const log = contaminatedLog();
    const off = calibrateFromVisits(CORRIDOR, log, DEFAULT_SECONDS_PER_BOARDING, {
      excludeContamination: false,
    });
    const on = calibrateFromVisits(CORRIDOR, log, DEFAULT_SECONDS_PER_BOARDING, {
      excludeContamination: true,
    });

    expect(on.contamination.filterApplied).toBe(true);
    expect(on.contamination.dwell.kept).toBeLessThan(on.contamination.dwell.considered);

    const lambdaOff = off.lambdaPassengersPerSecond;
    const lambdaOn = on.lambdaPassengersPerSecond;
    expect(lambdaOff).not.toBeNull();
    expect(lambdaOn).not.toBeNull();
    // The layover's slope is the whole difference: it is steeper than the
    // service dwell's and it is not boarding.
    expect(lambdaOn!).toBeLessThan(lambdaOff!);
  });

  it('publishes lambda in the units mpc/objective.ts uses, per second not per minute', () => {
    const calibration = calibrateFromVisits(CORRIDOR, contaminatedLog());
    const stop = calibration.stops[0];
    expect(stop).toBeDefined();
    expect(calibration.lambdaPassengersPerSecond).toBeCloseTo(stop!.boardingRatePerMinute / 60, 12);
  });

  it('says whether a removal was excluded or left in, because the same count means opposite things', () => {
    const log = contaminatedLog();
    const off = describeCalibration(
      calibrateFromVisits(CORRIDOR, log, DEFAULT_SECONDS_PER_BOARDING, { excludeContamination: false }),
    );
    const on = describeCalibration(
      calibrateFromVisits(CORRIDOR, log, DEFAULT_SECONDS_PER_BOARDING, { excludeContamination: true }),
    );

    expect(off).toContain('LEFT IN the fit');
    expect(on).toContain('EXCLUDED before fitting');
  });
});

describe('describeCalibration on a corridor that fitted no demand', () => {
  it('still reports the dispersion it measured, because the two need different amounts of data', () => {
    // Two traversals of one link measure dispersion; thirteen visits at one
    // stop are needed to fit dwell. Measured on the live network, 45 corridors
    // have a dispersion figure and 19 have a fitted stop, so the common case
    // is exactly this one.
    const visits = [
      visit('v1', 'A', 0, 30),
      visit('v1', 'B', 200, 30),
      visit('v2', 'A', 900, 30),
      visit('v2', 'B', 1130, 30),
      visit('v3', 'A', 1800, 30),
      visit('v3', 'B', 2010, 30),
    ];
    const calibration = calibrateFromVisits(CORRIDOR, visits);

    expect(calibration.stops).toHaveLength(0);
    expect(calibration.dispersion.pooledCoefficientOfVariation).not.toBeNull();

    const described = describeCalibration(calibration);
    expect(described).toContain('MODELLED');
    expect(described).toContain('Corridor dispersion');
  });

  it('says dispersion was NOT measured rather than reporting zero when no link repeated', () => {
    const described = describeCalibration(
      calibrateFromVisits(CORRIDOR, [visit('v1', 'A', 0, 30), visit('v1', 'B', 200, 30)]),
    );
    expect(described).toContain('Corridor dispersion NOT measured');
  });
});

describe('contaminationFilterEnabled', () => {
  it('is false when unset, so a fit is never quietly a different measurement', () => {
    expect(contaminationFilterEnabled({})).toBe(false);
  });

  it('accepts only true and 1', () => {
    expect(contaminationFilterEnabled({ [CONTAMINATION_FILTER_ENV]: 'true' })).toBe(true);
    expect(contaminationFilterEnabled({ [CONTAMINATION_FILTER_ENV]: '1' })).toBe(true);
  });

  it('reads a typo as off rather than as on', () => {
    expect(contaminationFilterEnabled({ [CONTAMINATION_FILTER_ENV]: 'TRUE ' })).toBe(false);
    expect(contaminationFilterEnabled({ [CONTAMINATION_FILTER_ENV]: 'yes' })).toBe(false);
    expect(contaminationFilterEnabled({ [CONTAMINATION_FILTER_ENV]: '' })).toBe(false);
  });
});

describe('DEFAULT_VEHICLE_CAPACITY', () => {
  it('matches the fleet the modelled inputs already assume, so the bound does not smuggle in a new bus', () => {
    expect(DEFAULT_VEHICLE_CAPACITY).toBe(52);
  });
});
