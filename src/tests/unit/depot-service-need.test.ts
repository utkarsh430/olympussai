// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hourOf, minuteOfDay, spanMinutes } from '@/lib/depot/service/feedMinutes';
import {
  busesNeeded,
  journeyMinutesFromLedger,
  needInputsFor,
  serviceClassOfRoute,
  TRIP_MODEL_DURATION_MIN,
} from '@/lib/depot/service/need';
import type { LedgerJourney, NeedInputs } from '@/lib/depot/service/types';
import { SEATS_BY_CLASS } from '@/lib/depot/sim/config';
import {
  BUSIEST_STRETCH_SHARE,
  LAYOVER_MIN,
  TARGET_LOAD,
} from '@/lib/depot/sim/hourlyDemandConfig';

function journey(over: Partial<LedgerJourney>): LedgerJourney {
  return {
    operatingDate: '2026-10-06',
    journeyId: 'J1',
    routeName: 'R1',
    registrationNumber: 'UP32AB1234',
    scheduledStart: '07:00',
    scheduledEnd: '08:40',
    actualStart: '07:05',
    delayMinutes: 5,
    lastSeen: '07:30',
    ...over,
  };
}

describe('feed minutes', () => {
  it('reads HH:MM, refuses malformed times and spans midnight', () => {
    expect(minuteOfDay('07:30')).toBe(450);
    expect(minuteOfDay('24:00')).toBeNull();
    expect(minuteOfDay('7:30')).toBeNull();
    expect(minuteOfDay(null)).toBeNull();
    expect(hourOf('23:59')).toBe(23);
    expect(spanMinutes('23:30', '00:45')).toBe(75);
    expect(spanMinutes('07:00', null)).toBeNull();
  });
});

describe('busesNeeded', () => {
  const inputs: NeedInputs = {
    routeName: 'R1',
    serviceClass: 'ordinary',
    seatsPerBus: 52,
    journeyMinutes: 105,
    journeyMinutesProvenance: 'derived',
    layoverMinutes: 15,
    targetLoad: 0.75,
    busiestStretchShare: 0.6,
  };

  it('follows the formula on a worked example', () => {
    // 520 boardings x 0.6 on the busiest stretch = 312 seats wanted at once;
    // a trip offers 52 x 0.75 = 39, so 8 trips; each takes 105 + 15 = 120 min,
    // so a bus makes half a trip an hour: 8 x 120 / 60 = 16 buses.
    expect(busesNeeded(520, inputs)).toBe(16);
  });

  it('rounds a part bus up', () => {
    // 100 x 0.6 / 39 = 1.54 trips x 2 = 3.08, so 4 buses.
    expect(busesNeeded(100, inputs)).toBe(4);
  });

  it('needs no bus for no demand or a corrupt figure', () => {
    expect(busesNeeded(0, inputs)).toBe(0);
    expect(busesNeeded(-3, inputs)).toBe(0);
    expect(busesNeeded(Number.NaN, inputs)).toBe(0);
  });
});

describe('needInputsFor', () => {
  it('takes the journey time from the feed schedule first, as a median of the route', () => {
    const ledger = [
      journey({ journeyId: 'a', scheduledStart: '06:00', scheduledEnd: '07:30' }),
      journey({ journeyId: 'b', scheduledStart: '09:00', scheduledEnd: '10:40' }),
      journey({ journeyId: 'c', scheduledStart: '12:00', scheduledEnd: '14:00' }),
      journey({
        journeyId: 'd',
        routeName: 'OTHER',
        scheduledStart: '06:00',
        scheduledEnd: '12:00',
      }),
      journey({ journeyId: 'e', scheduledEnd: null }),
    ];
    expect(journeyMinutesFromLedger('R1', ledger)).toBe(100);
    const need = needInputsFor({ routeName: 'R1', ledger, profileDurationMin: 300 });
    expect(need.journeyMinutes).toBe(100);
    expect(need.journeyMinutesProvenance).toBe('derived');
  });

  it('falls back to the route profile, then to the trip model', () => {
    const profiled = needInputsFor({ routeName: 'R1', ledger: [], profileDurationMin: 180 });
    expect(profiled.journeyMinutes).toBe(180);
    expect(profiled.journeyMinutesProvenance).toBe('derived');
    const modelled = needInputsFor({ routeName: 'R1', ledger: [], profileDurationMin: null });
    expect(modelled.journeyMinutes).toBe(TRIP_MODEL_DURATION_MIN);
    expect(modelled.journeyMinutesProvenance).toBe('modelled');
    const corrupt = needInputsFor({ routeName: 'R1', ledger: [], profileDurationMin: -4 });
    expect(corrupt.journeyMinutesProvenance).toBe('modelled');
  });

  it('takes seats from the class and the planning constants', () => {
    const need = needInputsFor({ routeName: 'LKO_DEL_AC', ledger: [], profileDurationMin: null });
    expect(need.serviceClass).toBe('ac');
    expect(need.seatsPerBus).toBe(SEATS_BY_CLASS.ac);
    expect(need.layoverMinutes).toBe(LAYOVER_MIN);
    expect(need.targetLoad).toBe(TARGET_LOAD);
    expect(need.busiestStretchShare).toBe(BUSIEST_STRETCH_SHARE);
  });

  it('reads an unnamed class as ordinary, as the modelled day does', () => {
    expect(serviceClassOfRoute('R1')).toBe('ordinary');
  });

  it('the trip model duration is the one its unknown-duration factor implies', () => {
    expect(TRIP_MODEL_DURATION_MIN).toBe(285);
  });
});
