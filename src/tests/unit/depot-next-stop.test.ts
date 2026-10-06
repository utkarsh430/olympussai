import { describe, expect, it } from 'vitest';
import type { CanonicalStop } from '@/models/canonical';
import { REPORTING_WINDOW_MIN } from '@/lib/depot/infer/thresholds';
import { feedTimeOfDay, resolveNextStop } from '@/lib/depot/routes/nextStop';
import type { BusOpState } from '@/lib/depot/types';
import { VND_1613_STOPS } from './depot-route-vnd-1613.fixtures';

/** Stops spaced 0.1 degrees of longitude apart along one latitude, in sequence order. */
function stop(sequence: number, longitude: number | null, time: string | null): CanonicalStop {
  return {
    id: `s${sequence}`,
    name: `Stop ${sequence}`,
    sequence,
    latitude: longitude === null ? null : 19,
    longitude,
    scheduledArrival: time,
    scheduledDeparture: time,
  };
}
const A = stop(1, 73.0, '08:00:00');
const B = stop(2, 73.1, '08:30:00');
const C = stop(3, 73.2, '09:00:00');
const STOPS = [A, B, C];
const at = (longitude: number) => ({ latitude: 19, longitude });

/** The next stop for a bus whose fix is fresh and in service, so only the geometry decides. */
const infer = (
  stops: readonly CanonicalStop[],
  position: { latitude: number; longitude: number } | null,
  timeOfDay: string | null,
) => resolveNextStop(stops, { position, gpsAgeMin: 0, state: 'in_service' }, timeOfDay).next;

describe('next stop by position', () => {
  it('names the first stop for a bus before it', () => {
    expect(infer(STOPS, at(72.95), null)).toEqual({ stop: A, method: 'position' });
  });
  it('names the stop after the nearest one for a bus past it', () => {
    expect(infer(STOPS, at(73.02), null)).toEqual({ stop: B, method: 'position' });
  });
  it('names the nearest stop itself for a bus approaching it', () => {
    expect(infer(STOPS, at(73.08), null)).toEqual({ stop: B, method: 'position' });
  });
  it('mid-route, past the middle stop, names the last stop', () => {
    expect(infer(STOPS, at(73.12), null)).toEqual({ stop: C, method: 'position' });
  });
  it('has no next stop for a bus at the last stop', () => {
    expect(infer(STOPS, at(73.2), '08:10')).toBeNull();
  });
  it('has no next stop for a bus beyond the last stop', () => {
    expect(infer(STOPS, at(73.3), null)).toBeNull();
  });
  it('picks the stop ahead for a bus equidistant between two', () => {
    expect(infer(STOPS, at(73.05), null)).toEqual({ stop: B, method: 'position' });
  });
  it('does not depend on the order the stops arrive in', () => {
    expect(infer([C, A, B], at(73.02), null)?.stop).toEqual(B);
  });
  it('skips stops without coordinates', () => {
    const stops = [A, stop(2, null, '08:20:00'), C];
    expect(infer(stops, at(73.02), null)).toEqual({ stop: C, method: 'position' });
  });
  it('does not mutate its input', () => {
    const input = Object.freeze([...STOPS]);
    expect(() => infer(input, at(73.02), '08:10')).not.toThrow();
  });
});

describe('next stop by schedule', () => {
  it('names the first stop before the first scheduled time', () => {
    expect(infer(STOPS, null, '07:00')).toEqual({ stop: A, method: 'schedule' });
  });
  it('names the first stop later than the feed time', () => {
    expect(infer(STOPS, null, '08:10')).toEqual({ stop: B, method: 'schedule' });
  });
  it('treats a stop at exactly the feed time as already reached', () => {
    expect(infer(STOPS, null, '08:30')).toEqual({ stop: C, method: 'schedule' });
  });
  it('is null after the last scheduled time', () => {
    expect(infer(STOPS, null, '09:30')).toBeNull();
  });
  it('falls back to the schedule with fewer than two located stops', () => {
    const stops = [A, stop(2, null, '08:30:00'), stop(3, null, '09:00:00')];
    expect(infer(stops, at(73.0), '08:10')).toEqual({
      stop: stops[1],
      method: 'schedule',
    });
  });
  it('uses the departure time when a stop has no arrival time', () => {
    const stops = [{ ...A, scheduledArrival: null, scheduledDeparture: '08:05:00' }];
    expect(infer(stops, null, '08:00')?.stop).toEqual(stops[0]);
  });
  it('skips stops with no usable time', () => {
    const stops = [stop(1, null, null), stop(2, null, 'garbage'), stop(3, null, '10:00:00')];
    expect(infer(stops, null, '08:00')?.stop.sequence).toBe(3);
  });
});

describe('next stop with nothing to go on', () => {
  it('is null for an empty stop list', () => {
    expect(infer([], at(73), '08:00')).toBeNull();
  });
  it('is null with no position and no feed time', () => {
    expect(infer(STOPS, null, null)).toBeNull();
  });
  it('never yields NaN for a non-finite position', () => {
    const result = infer(STOPS, { latitude: Number.NaN, longitude: 73 }, '08:10');
    expect(result).toEqual({ stop: B, method: 'schedule' });
  });
});

describe('feedTimeOfDay', () => {
  it('reads the digits as written, with no timezone conversion', () => {
    expect(feedTimeOfDay('2026-10-06T08:41:12.000Z')).toBe('08:41');
  });
  it('is null when there is no usable feed time', () => {
    expect(feedTimeOfDay(null)).toBeNull();
    expect(feedTimeOfDay('nonsense')).toBeNull();
  });
});

describe('resolveNextStop trust rule', () => {
  interface Bus {
    readonly position: { latitude: number; longitude: number } | null;
    readonly gpsAgeMin: number | null;
    readonly state: BusOpState;
  }
  const fresh: Bus = { position: at(73.02), gpsAgeMin: 5, state: 'in_service' };
  const resolve = (bus: Partial<Bus>, time = '08:10') =>
    resolveNextStop(STOPS, { ...fresh, ...bus }, time);

  it('uses the position for a fresh fix on a bus in service', () => {
    expect(resolve({})).toEqual({ next: { stop: B, method: 'position' }, reason: null });
  });
  it('accepts a bus on the road with no schedule', () => {
    expect(resolve({ state: 'on_road' }).next?.method).toBe('position');
  });
  it('accepts a fix exactly at the reporting window', () => {
    expect(resolve({ gpsAgeMin: REPORTING_WINDOW_MIN }).next?.method).toBe('position');
  });
  it('falls back to the timetable just past the reporting window, and says why', () => {
    const result = resolve({ gpsAgeMin: REPORTING_WINDOW_MIN + 1 });
    expect(result.next).toEqual({ stop: B, method: 'schedule' });
    expect(result.reason).toBe('This bus last reported 31 min ago.');
  });
  it('treats an unknown fix age as stale', () => {
    const result = resolve({ gpsAgeMin: null });
    expect(result.next?.method).toBe('schedule');
    expect(result.reason).toBe("This bus's last report time is unknown.");
  });
  it.each(['standing', 'dark', 'off_road'] as const)('does not trust a %s bus position', (state) => {
    const result = resolve({ state });
    expect(result.next?.method).toBe('schedule');
    expect(result.reason).toBe('This bus is not in service.');
  });
  it('accepts a bus just inside the longest gap between located stops', () => {
    // The gap between neighbouring stops is 0.1 degrees of longitude.
    expect(resolve({ position: at(72.91) }).next).toEqual({ stop: A, method: 'position' });
  });
  it('treats a bus just beyond the longest gap as off the route', () => {
    const result = resolve({ position: at(72.89) });
    expect(result.next).toEqual({ stop: B, method: 'schedule' });
    expect(result.reason).toBe('This bus is away from this route.');
  });
  it('shows no next stop, with the reason, when the fallback has nothing either', () => {
    const result = resolve({ state: 'dark' }, '09:30');
    expect(result.next).toBeNull();
    expect(result.reason).toBe('This bus is not in service.');
  });
  it('says the bus has passed the last stop rather than falling back', () => {
    const result = resolve({ position: at(73.2) });
    expect(result.next).toBeNull();
    expect(result.reason).toBe('This bus has passed the last stop.');
  });
  it('uses the timetable with no reason when the bus has no position at all', () => {
    expect(resolve({ position: null })).toEqual({
      next: { stop: B, method: 'schedule' },
      reason: null,
    });
  });
  it('says so when neither method can answer', () => {
    expect(resolve({ position: null }, '09:30')).toEqual({
      next: null,
      reason: 'No stop is scheduled later than the feed time.',
    });
  });
});

describe('next stop with a stop placed far off its route', () => {
  /** A same-named place about 200 km north, timed between B and C. */
  const FAR: CanonicalStop = { ...stop(3, 73.15, '08:45:00'), latitude: 20.8, name: 'Far off' };
  const LAST: CanonicalStop = { ...C, sequence: 4 };
  const WITH_FAR = [A, B, FAR, LAST];
  const bus = (latitude: number, longitude: number) => ({
    position: { latitude, longitude },
    gpsAgeMin: 0,
    state: 'in_service' as const,
  });

  it('never names the far-off stop as the nearest one, nor counts its gap', () => {
    // Beside the far-off position: without it the bus is far from every stop.
    const result = resolveNextStop(WITH_FAR, bus(20.8, 73.15), '08:35');
    expect(result.next).toEqual({ stop: FAR, method: 'schedule' });
    expect(result.reason).toBe('This bus is away from this route.');
  });

  it('names the next kept stop for a bus on the line', () => {
    expect(resolveNextStop(WITH_FAR, bus(19, 73.12), '08:35').next).toEqual({
      stop: LAST,
      method: 'position',
    });
  });

  it('names MOHANSARAI, not the far-off RAMNAGAR VARANASI, just past ADALHAT on the recorded route', () => {
    const result = resolveNextStop(VND_1613_STOPS, bus(25.15, 83.02), '19:45');
    expect(result.next?.method).toBe('position');
    expect(result.next?.stop.name).toBe('MOHANSARAI');
  });
});
