import { describe, expect, it } from 'vitest';
import { DEPOT_EXCEPTION_KINDS, BUS_EXCEPTION_KINDS } from '@/lib/depot/exceptions/config';
import { exceptionKindMeaning, isLeadFigure, PLAN_FIGURE_MEANING } from '@/lib/depot/figureTones';

const SEVERITIES = ['critical', 'warning', 'info'];

describe('exception figure tones', () => {
  it('colours every exception kind, depot and bus alike, by a severity', () => {
    for (const kind of [...DEPOT_EXCEPTION_KINDS, ...BUS_EXCEPTION_KINDS]) {
      expect(SEVERITIES, kind).toContain(exceptionKindMeaning(kind));
    }
  });

  it('makes too many buses off the road critical and the other depot kinds warnings', () => {
    expect(exceptionKindMeaning('off_road_high')).toBe('critical');
    expect(exceptionKindMeaning('dark_share_high')).toBe('warning');
    expect(exceptionKindMeaning('on_road_low')).toBe('warning');
    expect(exceptionKindMeaning('power_cut_cluster')).toBe('warning');
  });
});

describe('lead figures', () => {
  it('names one headline figure per band page by its key', () => {
    expect(['fuel', 'revenue', 'off_road', 'covered'].every(isLeadFigure)).toBe(true);
    expect(isLeadFigure('cost')).toBe(false);
    expect(isLeadFigure('empty')).toBe(false);
  });
});

describe('the plan figures', () => {
  it('keeps the empty running a plain count, teal being money and energy only', () => {
    expect(PLAN_FIGURE_MEANING.empty).toBe('count');
    expect(PLAN_FIGURE_MEANING.covered).toBe('better');
  });
});
