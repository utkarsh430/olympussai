import { describe, expect, it } from 'vitest';
import { modelDuties } from '@/lib/depot/sim/duties';
import type { Duty } from '@/lib/depot/duties/types';
import type { DepotSummary } from '@/lib/depot/types';

const depot = { id: 'D-7', name: 'Test' } as unknown as DepotSummary;
const ROUTES = [
  { routeName: 'PUNE_EXP_X', scheduledDurationMin: 120 },
  { routeName: 'AKOLA_ORD_Y', scheduledDurationMin: null },
  { routeName: 'MUM_VOLVO_AC', scheduledDurationMin: 600 },
];
const DATE = '2026-10-06';

describe('modelDuties', () => {
  it('produces exactly peakRequirement duties', () => {
    expect(modelDuties(depot, ROUTES, 17, DATE)).toHaveLength(17);
  });

  it('produces none for zero requirement or no routes', () => {
    expect(modelDuties(depot, ROUTES, 0, DATE)).toEqual([]);
    expect(modelDuties(depot, [], 9, DATE)).toEqual([]);
  });

  it('has stable three-digit ids and is deterministic', () => {
    const a = modelDuties(depot, ROUTES, 12, DATE);
    expect(a).toEqual(modelDuties(depot, ROUTES, 12, DATE));
    expect(new Set(a.map((d) => d.id))).toEqual(
      new Set(Array.from({ length: 12 }, (_, i) => `D-7-${DATE}-${String(i).padStart(3, '0')}`)),
    );
  });

  it('spreads routes round-robin over the sorted names', () => {
    const duties = modelDuties(depot, ROUTES, 7, DATE);
    const counts = new Map<string, number>();
    for (const d of duties) counts.set(d.routeName, (counts.get(d.routeName) ?? 0) + 1);
    expect(counts.get('AKOLA_ORD_Y')).toBe(3);
    expect(counts.get('MUM_VOLVO_AC')).toBe(2);
    expect(counts.get('PUNE_EXP_X')).toBe(2);
    const byId = [...duties].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId.slice(0, 3).map((d) => d.routeName)).toEqual([
      'AKOLA_ORD_Y',
      'MUM_VOLVO_AC',
      'PUNE_EXP_X',
    ]);
  });

  it('rounds starts and durations to five minutes within 04:00-22:00', () => {
    for (const d of modelDuties(depot, ROUTES, 200, DATE)) {
      expect(d.startMin % 5).toBe(0);
      expect(d.endMin % 5).toBe(0);
      expect(d.startMin).toBeGreaterThanOrEqual(240);
      expect(d.startMin).toBeLessThanOrEqual(1320);
      expect(d.endMin - d.startMin).toBeLessThanOrEqual(960);
      expect(d.provenance).toBe('modelled');
    }
  });

  it('uses twice the scheduled duration plus a 30 minute layover when known', () => {
    const d = modelDuties(depot, [{ routeName: 'A_ORD', scheduledDurationMin: 90 }], 5, DATE);
    for (const duty of d) expect(duty.endMin - duty.startMin).toBe(210);
  });

  it('caps a known duration at 16 hours and draws unknown ones within 4-10 hours', () => {
    const long = modelDuties(depot, [{ routeName: 'A', scheduledDurationMin: 900 }], 3, DATE);
    for (const d of long) expect(d.endMin - d.startMin).toBe(960);
    const unknown = modelDuties(depot, [{ routeName: 'A', scheduledDurationMin: null }], 80, DATE);
    for (const d of unknown) {
      expect(d.endMin - d.startMin).toBeGreaterThanOrEqual(240);
      expect(d.endMin - d.startMin).toBeLessThanOrEqual(600);
    }
  });

  it('lets late duties end after midnight', () => {
    const duties = modelDuties(depot, ROUTES, 300, DATE);
    expect(duties.some((d) => d.endMin > 1440)).toBe(true);
  });

  it('takes the service class from the route token, defaulting to ordinary', () => {
    const duties = modelDuties(
      depot,
      [
        { routeName: 'MUM_ORD_VOLVO', scheduledDurationMin: 60 },
        { routeName: 'PLAIN', scheduledDurationMin: 60 },
        { routeName: 'X_EXP', scheduledDurationMin: 60 },
      ],
      3,
      DATE,
    );
    const cls = Object.fromEntries(duties.map((d) => [d.routeName, d.serviceClass]));
    expect(cls).toEqual({ MUM_ORD_VOLVO: 'premium', PLAIN: 'ordinary', X_EXP: 'express' });
  });

  it('sorts by start then id', () => {
    const d = modelDuties(depot, ROUTES, 60, DATE);
    for (let i = 1; i < d.length; i += 1) {
      const p = d[i - 1] as Duty;
      const c = d[i] as Duty;
      expect(p.startMin < c.startMin || (p.startMin === c.startMin && p.id < c.id)).toBe(true);
    }
  });

  it('changes starts but not count or route spread with the date', () => {
    const a = modelDuties(depot, ROUTES, 20, '2026-10-06');
    const b = modelDuties(depot, ROUTES, 20, '2026-10-07');
    expect(b).toHaveLength(a.length);
    const spread = (xs: typeof a): string[] => xs.map((d) => d.routeName).sort();
    expect(spread(b)).toEqual(spread(a));
    expect(b.map((d) => d.startMin)).not.toEqual(a.map((d) => d.startMin));
  });

  it('does not mutate frozen inputs and rejects bad requirements', () => {
    const frozen = Object.freeze(ROUTES.map((r) => Object.freeze({ ...r })));
    expect(() => modelDuties(Object.freeze({ ...depot }), frozen, 4, DATE)).not.toThrow();
    expect(() => modelDuties(depot, ROUTES, -1, DATE)).toThrow(RangeError);
    expect(() => modelDuties(depot, ROUTES, 1.5, DATE)).toThrow(RangeError);
  });
});
