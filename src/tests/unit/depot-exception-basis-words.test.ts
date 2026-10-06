import { describe, expect, it } from 'vitest';
import { busBasisNote, depotBasisLabel } from '@/lib/depot/exceptions/basisWords';
import type { DepotException } from '@/lib/depot/exceptions/types';

/*
 * Round 2, ruling 4: each exception says whether its figure is compared over the rolling
 * window or as of the feed time, from its own `basis`, in the shared window words; a depot
 * scored on fewer snapshots than the network window says so quietly.
 */
const NOW = '2026-10-06T14:20:00.000Z';
const FULL = { lengthMin: 20, since: '2026-10-06T14:00:00.000Z', samples: 30 };

function exc(over: Partial<DepotException>): DepotException {
  return {
    id: 'off_road_high:1',
    depotId: '1',
    depotName: 'GARH',
    kind: 'off_road_high',
    severity: 'critical',
    value: 0.1,
    peerMedian: 0.01,
    z: 4,
    affected: 6,
    fleet: 60,
    ...over,
  };
}

describe('depotBasisLabel', () => {
  it('words a windowed comparison with the shared window words', () => {
    expect(depotBasisLabel(exc({ basis: 'window', samples: 30 }), FULL, NOW)).toBe('Last 20 min');
  });

  it('says quietly when the depot was scored on fewer snapshots than the window', () => {
    expect(depotBasisLabel(exc({ basis: 'window', samples: 2 }), FULL, NOW)).toBe(
      'Last 20 min · 2 snapshots',
    );
    expect(depotBasisLabel(exc({ basis: 'window', samples: 1 }), FULL, NOW)).toBe(
      'Last 20 min · 1 snapshot',
    );
  });

  it('words a feed-time figure as of the feed time', () => {
    expect(depotBasisLabel(exc({ kind: 'power_cut_cluster', basis: 'feed_time' }), FULL, NOW)).toBe(
      'As of 14:20',
    );
  });

  it('falls back to the kind when an older response carries no basis', () => {
    expect(depotBasisLabel(exc({ kind: 'power_cut_cluster' }), FULL, NOW)).toBe('As of 14:20');
    expect(depotBasisLabel(exc({}), FULL, NOW)).toBe('Last 20 min');
  });
});

describe('busBasisNote', () => {
  it('says the bus list is as of the feed time, worst first', () => {
    expect(busBasisNote(NOW)).toBe('As of 14:20, worst first');
    expect(busBasisNote(null)).toBe('As of the feed time, worst first');
  });
});
