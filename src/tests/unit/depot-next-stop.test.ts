import { describe, expect, it } from 'vitest';
import type { CanonicalStop } from '@/models/canonical';
import { feedTimeOfDay, inferNextStop } from '@/lib/depot/routes/nextStop';

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

describe('inferNextStop by position', () => {
  it('names the first stop for a bus before it', () => {
    expect(inferNextStop(STOPS, at(72.95), null)).toEqual({ stop: A, method: 'position' });
  });
  it('names the stop after the nearest one for a bus past it', () => {
    expect(inferNextStop(STOPS, at(73.02), null)).toEqual({ stop: B, method: 'position' });
  });
  it('names the nearest stop itself for a bus approaching it', () => {
    expect(inferNextStop(STOPS, at(73.08), null)).toEqual({ stop: B, method: 'position' });
  });
  it('mid-route, past the middle stop, names the last stop', () => {
    expect(inferNextStop(STOPS, at(73.12), null)).toEqual({ stop: C, method: 'position' });
  });
  it('has no next stop for a bus at the last stop', () => {
    expect(inferNextStop(STOPS, at(73.2), '08:10')).toBeNull();
  });
  it('has no next stop for a bus beyond the last stop', () => {
    expect(inferNextStop(STOPS, at(73.3), null)).toBeNull();
  });
  it('picks the stop ahead for a bus equidistant between two', () => {
    expect(inferNextStop(STOPS, at(73.05), null)).toEqual({ stop: B, method: 'position' });
  });
  it('does not depend on the order the stops arrive in', () => {
    expect(inferNextStop([C, A, B], at(73.02), null)?.stop).toEqual(B);
  });
  it('skips stops without coordinates', () => {
    const stops = [A, stop(2, null, '08:20:00'), C];
    expect(inferNextStop(stops, at(73.02), null)).toEqual({ stop: C, method: 'position' });
  });
  it('does not mutate its input', () => {
    const input = Object.freeze([...STOPS]);
    expect(() => inferNextStop(input, at(73.02), '08:10')).not.toThrow();
  });
});

describe('inferNextStop by schedule', () => {
  it('names the first stop before the first scheduled time', () => {
    expect(inferNextStop(STOPS, null, '07:00')).toEqual({ stop: A, method: 'schedule' });
  });
  it('names the first stop later than the feed time', () => {
    expect(inferNextStop(STOPS, null, '08:10')).toEqual({ stop: B, method: 'schedule' });
  });
  it('treats a stop at exactly the feed time as already reached', () => {
    expect(inferNextStop(STOPS, null, '08:30')).toEqual({ stop: C, method: 'schedule' });
  });
  it('is null after the last scheduled time', () => {
    expect(inferNextStop(STOPS, null, '09:30')).toBeNull();
  });
  it('falls back to the schedule with fewer than two located stops', () => {
    const stops = [A, stop(2, null, '08:30:00'), stop(3, null, '09:00:00')];
    expect(inferNextStop(stops, at(73.0), '08:10')).toEqual({
      stop: stops[1],
      method: 'schedule',
    });
  });
  it('uses the departure time when a stop has no arrival time', () => {
    const stops = [{ ...A, scheduledArrival: null, scheduledDeparture: '08:05:00' }];
    expect(inferNextStop(stops, null, '08:00')?.stop).toEqual(stops[0]);
  });
  it('skips stops with no usable time', () => {
    const stops = [stop(1, null, null), stop(2, null, 'garbage'), stop(3, null, '10:00:00')];
    expect(inferNextStop(stops, null, '08:00')?.stop.sequence).toBe(3);
  });
});

describe('inferNextStop with nothing to go on', () => {
  it('is null for an empty stop list', () => {
    expect(inferNextStop([], at(73), '08:00')).toBeNull();
  });
  it('is null with no position and no feed time', () => {
    expect(inferNextStop(STOPS, null, null)).toBeNull();
  });
  it('never yields NaN for a non-finite position', () => {
    const result = inferNextStop(STOPS, { latitude: Number.NaN, longitude: 73 }, '08:10');
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
