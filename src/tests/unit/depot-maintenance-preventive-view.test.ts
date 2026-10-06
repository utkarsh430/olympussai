import { describe, expect, it } from 'vitest';
import { preventiveView } from '@/lib/depot/maintenance/preventiveView';
import type { ModelledService, ServiceGroup } from '@/lib/depot/maintenance/serviceModel';

const bus = (group: ServiceGroup, km: number): ModelledService =>
  ({
    registrationNumber: `UP${group}${km}`,
    group,
    kmToNextService: km,
    serviceClass: 'ordinary',
    odometerKm: 1,
    ageYears: 1,
  }) as unknown as ModelledService;

const many = (group: ServiceGroup, n: number, from: number): ModelledService[] =>
  Array.from({ length: n }, (_, i) => bus(group, from + i));

describe('preventiveView', () => {
  const buses = [...many('due_soon', 28, 10), ...many('overdue', 18, -400)];

  it('orders overdue before due soon and each group nearest-due first, five rows a group', () => {
    const view = preventiveView(buses, new Set());
    expect(view.rows).toHaveLength(10);
    expect(view.rows.slice(0, 5).every((row) => row.group === 'overdue')).toBe(true);
    expect(view.rows.slice(5).every((row) => row.group === 'due_soon')).toBe(true);
    expect(view.rows[0]?.kmToNextService).toBe(-400);
  });

  it('counts every group in full, not only the rows shown, and lists the capped groups', () => {
    const view = preventiveView(buses, new Set());
    expect(view.totals).toEqual({ overdue: 18, due_soon: 28, not_due: 0 });
    expect(view.cappable).toEqual(['overdue', 'due_soon']);
  });

  it('opens one group without touching the others, and does not mutate its input', () => {
    const before = [...buses];
    const view = preventiveView(buses, new Set<ServiceGroup>(['due_soon']));
    expect(view.rows).toHaveLength(5 + 28);
    expect(buses).toEqual(before);
  });

  it('leaves a group of five or fewer without a Show all', () => {
    expect(preventiveView(many('overdue', 5, 0), new Set()).cappable).toEqual([]);
  });
});
