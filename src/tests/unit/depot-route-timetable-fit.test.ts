import { describe, expect, it } from 'vitest';
import {
  MAX_PLAUSIBLE_SPEED_KMH,
  UNTIMED_LEG_ALLOWANCE_KM,
  plausibleLegKm,
  positionsFitTimetable,
  type PlacedStop,
} from '@/lib/depot/routes/timetableFit';
import { isUsablePosition } from '@/lib/depot/infer/geo';
import { VND_1613_MISLOCATED, VND_1613_STOPS } from './depot-route-vnd-1613.fixtures';

/** A stop on a north-running line: 0.1 degree of latitude is about 11.1 km. */
const on = (step: number, time: string | null): PlacedStop => ({
  lat: 25 + step * 0.1,
  lng: 82,
  scheduled: time,
});

/** The same-named place elsewhere: about 220 km east of the line. */
const away = (time: string | null): PlacedStop => ({ lat: 25.3, lng: 84.2, scheduled: time });

describe('plausibleLegKm', () => {
  it('credits the speed cap over the scheduled minutes, never less than the allowance', () => {
    expect(MAX_PLAUSIBLE_SPEED_KMH).toBe(110);
    expect(UNTIMED_LEG_ALLOWANCE_KM).toBe(40);
    expect(plausibleLegKm(60)).toBe(110);
    expect(plausibleLegKm(10)).toBe(40);
    expect(plausibleLegKm(0)).toBe(40);
    expect(plausibleLegKm(null)).toBe(40);
  });
});

describe('positionsFitTimetable', () => {
  it('leaves out exactly the four stops of the recorded route that sit far off its line', () => {
    const located = VND_1613_STOPS.filter(isUsablePosition);
    expect(located).toHaveLength(29);
    const fits = positionsFitTimetable(
      located.map((s) => ({ lat: s.latitude, lng: s.longitude, scheduled: s.scheduledDeparture })),
    );
    const left = located.filter((_, index) => !fits[index]).map((s) => s.name);
    expect(left).toEqual(VND_1613_MISLOCATED);
    expect(fits.filter(Boolean)).toHaveLength(25);
  });

  it('keeps a route whose stops all fit, unchanged', () => {
    const stops = [on(0, '10:00'), on(1, '10:10'), on(3, '10:25'), on(6, '10:45')];
    expect(positionsFitTimetable(stops)).toEqual([true, true, true, true]);
  });

  it('leaves out a misplaced first stop and a misplaced last stop', () => {
    const stops = [away('10:00'), on(1, '10:10'), on(2, '10:20'), on(3, '10:30'), away('10:40')];
    expect(positionsFitTimetable(stops)).toEqual([false, true, true, true, false]);
  });

  it('keeps a good stop between two misplaced ones', () => {
    const stops = [
      on(0, '10:00'),
      away('10:05'),
      on(1, '10:10'),
      away('10:15'),
      on(2, '10:20'),
    ];
    expect(positionsFitTimetable(stops)).toEqual([true, false, true, false, true]);
  });

  it('judges two stops in the same scheduled minute by the allowance alone', () => {
    const near = [on(0, '10:00'), on(3, '10:00'), on(4, '10:10')];
    expect(positionsFitTimetable(near)).toEqual([true, true, true]);
    const far = [on(0, '10:00'), away('10:00'), on(1, '10:10')];
    expect(positionsFitTimetable(far)).toEqual([true, false, true]);
  });

  it('judges a stop with a missing or unreadable time by the allowance alone', () => {
    const near = [on(0, '10:00'), on(2, null), on(4, '10:40')];
    expect(positionsFitTimetable(near)).toEqual([true, true, true]);
    const elsewhere = { lat: 26.5, lng: 80.5, scheduled: 'soon' };
    const far = [on(0, '10:00'), away(null), on(4, '10:40'), elsewhere];
    expect(positionsFitTimetable(far)).toEqual([true, false, true, false]);
  });

  it('runs a leg past midnight on the next day', () => {
    // About 111 km in 75 minutes, across midnight.
    const stops = [on(0, '23:30'), on(10, '00:45'), on(11, '00:55')];
    expect(positionsFitTimetable(stops)).toEqual([true, true, true]);
  });

  it('keeps no stop when no two of them fit together', () => {
    const stops = [
      { lat: 25, lng: 80, scheduled: '10:00' },
      { lat: 25, lng: 82.5, scheduled: '10:05' },
      { lat: 25, lng: 85, scheduled: '10:10' },
    ];
    expect(positionsFitTimetable(stops)).toEqual([false, false, false]);
  });

  it('keeps every stop when the timetable has fewer than two usable times', () => {
    const stops = [on(0, null), away(null), on(20, '10:00')];
    expect(positionsFitTimetable(stops)).toEqual([true, true, true]);
    expect(positionsFitTimetable([on(0, '10:00')])).toEqual([true]);
    expect(positionsFitTimetable([])).toEqual([]);
  });

  it('breaks a tie between equal chains by the shorter length, then the earlier stops', () => {
    // Two rival first stops in the same minute, about 42 km apart, so never both kept;
    // each fits the third stop. The one 35 km away loses to the one 22 km away.
    const west = { lat: 25, lng: 81.65, scheduled: '10:00' };
    const south = on(-2, '10:00');
    expect(positionsFitTimetable([west, south, on(0, '10:05')])).toEqual([false, true, true]);
    // Two rivals 22 km either side of the third stop: equal lengths, the earlier one wins.
    const north = on(2, '10:00');
    expect(positionsFitTimetable([north, south, on(0, '10:05')])).toEqual([true, false, true]);
  });

  it('is deterministic and leaves its input untouched', () => {
    const stops: readonly PlacedStop[] = Object.freeze(
      [on(0, '10:00'), away('10:05'), on(1, '10:10')].map((stop) => Object.freeze(stop)),
    );
    const before = JSON.stringify(stops);
    expect(positionsFitTimetable(stops)).toEqual(positionsFitTimetable(stops));
    expect(JSON.stringify(stops)).toBe(before);
  });
});
