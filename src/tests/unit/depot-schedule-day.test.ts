import { describe, expect, it } from 'vitest';
import { normalizeScheduleDay } from '@/lib/upsrtc/scheduleDay';
import { normalizeSchedulePayload } from '@/lib/upsrtc/normalizer';
import scheduleFixture from '@/fixtures/upsrtc-schedule-sample.json';

const REG = 'UP25FT4823';
const DATE = '2026-10-06';

/** One trip of a bus's day as the schedule server lists it: one row per stop. */
function tripRows(
  vjId: number,
  route: string,
  times: readonly string[],
  code: string | null = `RKD${vjId}`,
): Record<string, unknown>[] {
  return times.map((time, index) => ({
    vj_id: vjId,
    atco_code: 14000 + index,
    stop_sequence: index + 1,
    stop_name: `STOP ${index + 1}`,
    RouteName: route,
    vehicle_journey_code: code,
    scheduled_time: time,
    Latitude: 28.3,
    Longitude: 79.4,
  }));
}

/** Nine trips, as a real day often has: out and back on two routes, one past midnight. */
const NINE_TRIPS = [
  ...tripRows(101, 'R_A_OUT', ['05:30:00', '06:10:00', '07:05:00']),
  ...tripRows(102, 'R_A_IN', ['07:30:00', '08:40:00']),
  ...tripRows(103, 'R_A_OUT', ['09:00:00', '10:15:00']),
  ...tripRows(104, 'R_A_IN', ['10:40:00', '11:50:00', '12:05:00']),
  ...tripRows(105, 'R_B_OUT', ['13:00:00', '14:20:00']),
  ...tripRows(106, 'R_B_IN', ['14:45:00', '16:00:00']),
  ...tripRows(107, 'R_A_OUT', ['16:30:00', '17:45:00']),
  ...tripRows(108, 'R_A_IN', ['18:10:00', '19:30:00'], null),
  ...tripRows(109, 'R_A_OUT', ['23:20:00', '00:40:00']),
];

describe('normalizeScheduleDay', () => {
  it('keeps every trip of the bus day, in start order', () => {
    const trips = normalizeScheduleDay(NINE_TRIPS, REG, DATE);
    expect(trips).toHaveLength(9);
    expect(trips.map((t) => t.journeyId)).toEqual(
      ['101', '102', '103', '104', '105', '106', '107', '108', '109'],
    );
    expect(trips[0]).toEqual({
      forDate: DATE,
      answeredDate: DATE,
      registrationNumber: REG,
      journeyId: '101',
      journeyCode: 'RKD101',
      routeName: 'R_A_OUT',
      startTime: '05:30',
      endTime: '07:05',
      stops: 3,
    });
    expect(trips[7]?.journeyCode).toBeNull();
  });

  it('reads the start and end by stop order, so a trip past midnight ends after it starts', () => {
    const late = normalizeScheduleDay(NINE_TRIPS, REG, DATE).find((t) => t.journeyId === '109');
    expect(late).toMatchObject({ startTime: '23:20', endTime: '00:40' });
  });

  it('keeps trips on other routes: the whole day of the bus is recorded', () => {
    const routes = new Set(normalizeScheduleDay(NINE_TRIPS, REG, DATE).map((t) => t.routeName));
    expect([...routes].sort()).toEqual(['R_A_IN', 'R_A_OUT', 'R_B_IN', 'R_B_OUT']);
  });

  it('upper-cases the registration and reads the recorded sample', () => {
    const trips = normalizeScheduleDay(scheduleFixture, 'up25ft4823', DATE);
    expect(trips).toHaveLength(4);
    expect(trips.every((t) => t.registrationNumber === 'UP25FT4823')).toBe(true);
    expect(trips.every((t) => t.stops === 13)).toBe(true);
  });

  it('answers no trips for "not assigned", an empty or a malformed payload', () => {
    expect(normalizeScheduleDay(' Bus Not Assigned!!! ', REG, DATE)).toEqual([]);
    expect(normalizeScheduleDay([], REG, DATE)).toEqual([]);
    expect(normalizeScheduleDay({ nothing: true }, REG, DATE)).toEqual([]);
  });

  it('leaves out a trip with no id, no route name or no readable time', () => {
    const rows = [
      ...tripRows(201, 'R_A_OUT', ['06:00:00', '07:00:00']),
      { RouteName: 'R_A_OUT', scheduled_time: '08:00:00', stop_sequence: 1, reg_num: REG },
      ...tripRows(202, '', ['09:00:00']),
      ...tripRows(203, 'R_A_OUT', ['soon']),
    ];
    expect(normalizeScheduleDay(rows, REG, DATE).map((t) => t.journeyId)).toEqual(['201']);
  });

  it('leaves the single-trip normaliser unchanged', () => {
    const schedule = normalizeSchedulePayload(NINE_TRIPS, REG, DATE, '104');
    expect(schedule?.tripId).toBe('104');
    expect(schedule?.stops).toHaveLength(3);
    expect(schedule?.tripCount).toBe(9);
  });
});
