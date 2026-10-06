import { describe, expect, it } from 'vitest';
import { diffMarkers } from '@/lib/depot/map/diffMarkers';

const at = { lat: 26, lng: 80 };
const row = (id: string, centroid: typeof at | null = at) => ({ depot: { id, centroid } });

describe('diffMarkers', () => {
  it('adds new positioned depots, updates kept ones and removes the rest', () => {
    const diff = diffMarkers(['a', 'b', 'c'], [row('b'), row('d'), row('c', null)]);
    expect(diff.add.map((r) => r.depot.id)).toEqual(['d']);
    expect(diff.update.map((r) => r.depot.id)).toEqual(['b']);
    expect(diff.remove).toEqual(['a', 'c']);
  });

  it('adds everything on first draw and removes nothing', () => {
    const diff = diffMarkers([], [row('a'), row('b', null)]);
    expect(diff.add.map((r) => r.depot.id)).toEqual(['a']);
    expect(diff.update).toEqual([]);
    expect(diff.remove).toEqual([]);
  });
});
