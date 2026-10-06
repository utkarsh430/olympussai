import { describe, expect, it } from 'vitest';
import { busBasisNote, fewSnapshotsLabel } from '@/lib/depot/exceptions/basisWords';
import type { DepotException } from '@/lib/depot/exceptions/types';

/*
 * Each exception says whether its figure is compared over the rolling window or as of the
 * feed time; a depot scored on fewer snapshots than the network window says so quietly.
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

describe('fewSnapshotsLabel', () => {
  it('says quietly when the depot was scored on fewer snapshots than the window', () => {
    expect(fewSnapshotsLabel(exc({ basis: 'window', samples: 2 }), FULL)).toBe('2 snapshots');
    expect(fewSnapshotsLabel(exc({ basis: 'window', samples: 1 }), FULL)).toBe('1 snapshot');
  });

  it('says nothing for a full window or when the window is unknown', () => {
    expect(fewSnapshotsLabel(exc({ basis: 'window', samples: 30 }), FULL)).toBeNull();
    expect(fewSnapshotsLabel(exc({ basis: 'window', samples: 2 }), undefined)).toBeNull();
  });
});

describe('busBasisNote', () => {
  it('says the bus list is as of the feed time, worst first', () => {
    expect(busBasisNote(NOW)).toBe('As of 14:20, worst first');
    expect(busBasisNote(null)).toBe('As of the feed time, worst first');
  });
});
