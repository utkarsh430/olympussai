import { describe, expect, it } from 'vitest';
import { DEPOT_EXCEPTION_KINDS, BUS_EXCEPTION_KINDS } from '@/lib/depot/exceptions/config';
import { exceptionKindMeaning } from '@/lib/depot/figureTones';

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
