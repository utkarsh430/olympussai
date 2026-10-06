import { describe, it, expect } from 'vitest';
import type { ModelledBus, ServiceClass } from '@/lib/depot/sim/types';
import {
  ANNUAL_KM_BY_CLASS,
  ANNUAL_KM_VARIATION,
  DUE_SOON_WITHIN_KM,
  SERVICE_INTERVAL_KM,
} from '@/lib/depot/maintenance/config';
import {
  countByGroup,
  modelService,
  serviceGroupOf,
} from '@/lib/depot/maintenance/serviceModel';
import { workshopLoad } from '@/lib/depot/maintenance/workshop';

const CLASSES: readonly ServiceClass[] = ['ordinary', 'express', 'ac', 'premium'];

function bus(reg: string, serviceClass: ServiceClass = 'ordinary', ageYears = 5): ModelledBus {
  return { registrationNumber: reg, serviceClass, ageYears, seats: 50 };
}

const fleet = (n: number): ModelledBus[] =>
  Array.from({ length: n }, (_, i) =>
    bus(`UP32B${String(i).padStart(4, '0')}`, CLASSES[i % CLASSES.length], i % 16),
  );

describe('modelService', () => {
  it('is deterministic for the same bus', () => {
    expect(modelService(bus('UP32A0001'))).toEqual(modelService(bus('UP32A0001')));
  });

  it('differs between buses', () => {
    const odometers = new Set(fleet(40).map((b) => modelService(b).odometerKm));
    expect(odometers.size).toBeGreaterThan(20);
  });

  it('uses the named service interval of the bus class', () => {
    for (const serviceClass of CLASSES) {
      expect(modelService(bus('UP32A0002', serviceClass)).intervalKm).toBe(
        SERVICE_INTERVAL_KM[serviceClass],
      );
    }
    expect(new Set(Object.values(SERVICE_INTERVAL_KM)).size).toBeGreaterThan(1);
  });

  it('anchors the odometer on the modelled age and the class annual distance', () => {
    for (const b of fleet(200)) {
      const { odometerKm } = modelService(b);
      const ceiling = (b.ageYears + 1) * ANNUAL_KM_BY_CLASS[b.serviceClass] * ANNUAL_KM_VARIATION.max;
      expect(odometerKm).toBeLessThanOrEqual(Math.ceil(ceiling) + 100);
      const floor = b.ageYears * ANNUAL_KM_BY_CLASS[b.serviceClass] * ANNUAL_KM_VARIATION.min;
      expect(odometerKm).toBeGreaterThanOrEqual(Math.floor(floor) - 100);
    }
  });

  it('gives an older bus a larger odometer than a new one of the same class on average', () => {
    const mean = (age: number): number => {
      const values = Array.from({ length: 60 }, (_, i) =>
        modelService(bus(`UP32C${i}`, 'ordinary', age)).odometerKm,
      );
      return values.reduce((a, b) => a + b, 0) / values.length;
    };
    expect(mean(12)).toBeGreaterThan(mean(2) * 3);
  });

  it('never services a bus before it existed: last service is within the odometer', () => {
    for (const b of fleet(300)) {
      const s = modelService(b);
      expect(s.lastServiceKm).toBeGreaterThanOrEqual(0);
      expect(s.lastServiceKm).toBeLessThanOrEqual(s.odometerKm);
      expect(s.kmToNextService).toBe(s.intervalKm - (s.odometerKm - s.lastServiceKm));
    }
  });

  it('never returns a negative odometer or a non-finite figure', () => {
    for (const b of [...fleet(300), bus('UP32D0001', 'premium', 0)]) {
      const s = modelService(b);
      for (const value of [s.odometerKm, s.lastServiceKm, s.intervalKm, s.kmToNextService]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(s.odometerKm).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not mutate its input', () => {
    const input = Object.freeze(bus('UP32A0003'));
    expect(() => modelService(input)).not.toThrow();
    expect(input).toEqual(bus('UP32A0003'));
  });

  it('puts some buses in every group across a depot-sized fleet', () => {
    const counts = countByGroup(fleet(400).map(modelService));
    expect(counts.overdue).toBeGreaterThan(0);
    expect(counts.due_soon).toBeGreaterThan(0);
    expect(counts.not_due).toBeGreaterThan(counts.overdue);
    expect(counts.overdue + counts.due_soon + counts.not_due).toBe(400);
  });
});

describe('serviceGroupOf', () => {
  it.each([
    [-1, 'overdue'],
    [-5000, 'overdue'],
    [0, 'due_soon'],
    [DUE_SOON_WITHIN_KM, 'due_soon'],
    [DUE_SOON_WITHIN_KM + 1, 'not_due'],
    [SERVICE_INTERVAL_KM.ordinary, 'not_due'],
  ] as const)('puts %d km to the next service in %s', (km, group) => {
    expect(serviceGroupOf(km)).toBe(group);
  });
});

describe('workshopLoad', () => {
  it('has no queue while off-road buses fit the bays', () => {
    expect(workshopLoad(3, 4)).toEqual({ bays: 4, offRoad: 3, inBays: 3, queue: 0, freeBays: 1 });
  });

  it('queues the buses that exceed the bays', () => {
    expect(workshopLoad(7, 4)).toEqual({ bays: 4, offRoad: 7, inBays: 4, queue: 3, freeBays: 0 });
  });

  it('copes with nothing off the road and with no bays', () => {
    expect(workshopLoad(0, 2).queue).toBe(0);
    expect(workshopLoad(2, 0)).toEqual({ bays: 0, offRoad: 2, inBays: 0, queue: 2, freeBays: 0 });
  });
});
