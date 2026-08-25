// The number that predicts how much good holding can do, and the bands it
// falls into. Shared by both harnesses, so it is tested once here rather than
// through either of them.
import { describe, it, expect } from 'vitest';
import { assessControllability, CONTROLLABLE_BAND } from '../../src/lib/controllability.js';

/** A corridor of `stops` evenly spaced over `km`, at `kmph`, on an `H` second headway. */
function corridor(stops: number, km: number, kmph: number, variation: number, H: number) {
  return assessControllability({
    cumulativeDistanceMeters: Array.from({ length: stops }, (_, i) => (i * km * 1000) / (stops - 1)),
    cruiseSpeedKmph: kmph,
    travelTimeVariation: variation,
    targetHeadwaySeconds: H,
  });
}

describe('controllability', () => {
  it('reproduces the three trial corridors, which is where the bands came from', () => {
    // urban: 25 stops over 24 km at 18 km/h, 18% variation, 6-minute headway.
    expect(corridor(25, 24, 18, 0.18, 360).band).toBe('controllable');
    // suburban: 15 stops over 60 km at 32 km/h, 16%, 12 minutes.
    expect(corridor(15, 60, 32, 0.16, 720).band).toBe('controllable');
    // inter-city: 10 stops over 400 km at 60 km/h, 14%, 30 minutes. Above the
    // band, which is the documented reason it gains least.
    expect(corridor(10, 400, 60, 0.14, 1800).band).toBe('too_disturbed');
  });

  it('calls a corridor that barely varies too regular', () => {
    const calm = corridor(25, 24, 18, 0.001, 360);
    expect(calm.band).toBe('too_regular');
    expect(calm.disturbanceRatio).toBeLessThan(CONTROLLABLE_BAND.low);
    expect(calm.note).toMatch(/barely comes apart/);
  });

  it('calls a corridor whose legs vary more than a hold can remove too disturbed', () => {
    const wild = corridor(25, 24, 18, 2, 360);
    expect(wild.band).toBe('too_disturbed');
    expect(wild.disturbanceRatio).toBeGreaterThan(CONTROLLABLE_BAND.high);
  });

  // Both are real absences rather than zeros dressed up as measurements.
  it('does not divide by a zero headway or a stopped corridor', () => {
    expect(corridor(25, 24, 18, 0.18, 0).disturbanceRatio).toBe(0);
    expect(corridor(25, 24, 0, 0.18, 360).legTimeSigmaSeconds).toBe(0);
  });

  // The ratio is sigma over H*, so halving the headway doubles it - which is
  // why a six-minute service is controllable where a thirty-minute one is not,
  // on legs of the same regularity.
  it('scales with the headway it is protecting', () => {
    const short = corridor(25, 24, 18, 0.18, 360);
    const long = corridor(25, 24, 18, 0.18, 720);
    expect(short.disturbanceRatio).toBeCloseTo(long.disturbanceRatio * 2, 6);
  });
});
