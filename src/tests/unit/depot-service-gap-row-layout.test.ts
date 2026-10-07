// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  GAP_CELL_MIN_PX,
  GAP_ROW_TIERS,
  gapRowStaggered,
  hourColumnPx,
} from '@/lib/depot/service/gapRowLayout';

const VIEWPORTS = Array.from({ length: (1440 - 320) / 4 + 1 }, (_, i) => 320 + i * 4);
const tierAt = (viewportPx: number): string =>
  GAP_ROW_TIERS.find(([, from]) => viewportPx >= from)?.[0] ?? 'staggered';

describe('the gap row under the hour axis', () => {
  it('stays on one line from 640px, where every hour column holds a signed two-digit gap', () => {
    for (const v of [640, 800, 1024, 1280, 1440]) {
      expect(gapRowStaggered(v)).toBe(false);
      expect(hourColumnPx(v)).toBeGreaterThanOrEqual(GAP_CELL_MIN_PX);
    }
  });

  it('staggers on a phone, every other hour a line lower, so no two gaps touch', () => {
    for (const v of [360, 390]) {
      expect(gapRowStaggered(v)).toBe(true);
      expect(2 * hourColumnPx(v)).toBeGreaterThanOrEqual(GAP_CELL_MIN_PX);
    }
  });

  it('draws one line only where the columns are wide enough, at every viewport', () => {
    for (const v of VIEWPORTS) {
      if (tierAt(v) === 'single') expect(hourColumnPx(v)).toBeGreaterThanOrEqual(GAP_CELL_MIN_PX);
      if (gapRowStaggered(v)) expect(tierAt(v)).toBe('staggered');
    }
  });
});
