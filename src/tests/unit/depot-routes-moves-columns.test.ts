import { describe, expect, it } from 'vitest';
import { MOVES_COLUMNS, MOVES_FRAME_1440_PX, MOVES_TABLE_PX } from '@/lib/depot/routes/movesColumns';

describe('the recommended-moves columns', () => {
  it('uses the short headers, SAVING KM/DAY named in full', () => {
    expect(MOVES_COLUMNS.map((c) => c.label)).toEqual([
      'Route', 'From', 'To', 'Trips/day', 'Dead km now', 'After', 'Saving km/day', 'Note',
    ]);
  });

  it('carries no MODELLED pill in a header: the section label has it; DERIVED only where it differs', () => {
    expect(MOVES_COLUMNS.filter((c) => c.tag).map((c) => [c.key, c.tag])).toEqual([
      ['now', 'derived'],
      ['after', 'derived'],
    ]);
  });

  it('fits the 1440 frame uncut', () => {
    expect(MOVES_TABLE_PX).toBe(1152);
    expect(MOVES_TABLE_PX).toBeLessThanOrEqual(MOVES_FRAME_1440_PX);
  });
});
