/**
 * The served-network plausibility gate.
 *
 * Companion to src/tests/unit/normalizer.test.ts, which owns the feed-level
 * `isValidCoordinate`. The division of labour is the point: that gate answers
 * "is this a coordinate", this one answers "is this a coordinate on the
 * network we serve", and the defect that produced this module lived exactly in
 * the gap between the two.
 */
import { describe, it, expect } from 'vitest';
import { isPlottablePosition, partitionPlottable, SERVED_NETWORK_BOUNDS } from '@/lib/maps/plottable';
import { isValidCoordinate } from '@/lib/upsrtc/normalizer';

describe('isPlottablePosition', () => {
  it('accepts positions across the real observed fleet extent', () => {
    // Measured against the production feed on 2026-08-14, 9,188 vehicles:
    // lat 23.837769 to 30.709913, lng 74.64459 to 84.25556.
    expect(isPlottablePosition(26.85, 80.95)).toBe(true); // Lucknow
    expect(isPlottablePosition(28.731026, 77.77132)).toBe(true); // the NCR fringe
    expect(isPlottablePosition(30.709913, 80.1)).toBe(true); // northern extreme
    expect(isPlottablePosition(23.837769, 79.4)).toBe(true); // southern extreme
  });

  // These are genuine UPSRTC interstate workings observed in the live feed,
  // not outliers. A gate that hid them would be a worse defect than the one it
  // was written to fix.
  it('accepts real interstate services well outside Uttar Pradesh', () => {
    expect(isPlottablePosition(26.4691, 74.6446)).toBe(true); // Ajmer, Rajasthan
    expect(isPlottablePosition(26.9245, 75.8001)).toBe(true); // Jaipur, Rajasthan
    expect(isPlottablePosition(28.6139, 77.209)).toBe(true); // Delhi
    expect(isPlottablePosition(30.3165, 78.0322)).toBe(true); // Dehradun
    expect(isPlottablePosition(25.5941, 85.1376)).toBe(true); // Patna, Bihar
  });

  // THE DEFECT. A zeroed latitude with a real longitude.
  it('rejects the zeroed-latitude reading that opened the map on the sea', () => {
    expect(isPlottablePosition(0.0, 77.855354)).toBe(false);
  });

  it('rejects a zeroed longitude with a real latitude', () => {
    expect(isPlottablePosition(28.35, 0)).toBe(false);
  });

  it('rejects exact null island', () => {
    expect(isPlottablePosition(0, 0)).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(isPlottablePosition(Number.NaN, 80)).toBe(false);
    expect(isPlottablePosition(28, Number.NaN)).toBe(false);
    expect(isPlottablePosition(Number.POSITIVE_INFINITY, 80)).toBe(false);
    expect(isPlottablePosition(28, Number.NEGATIVE_INFINITY)).toBe(false);
  });

  it('rejects valid coordinates that are simply not on this network', () => {
    expect(isPlottablePosition(-33.8688, 151.2093)).toBe(false); // Sydney
    expect(isPlottablePosition(51.5072, -0.1276)).toBe(false); // London
    expect(isPlottablePosition(12.9716, 77.5946)).toBe(false); // Bengaluru - right longitude, wrong country half
    expect(isPlottablePosition(90, 80)).toBe(false); // north pole
  });

  it('treats the declared bounds as inclusive', () => {
    const { south, north, west, east } = SERVED_NETWORK_BOUNDS;
    expect(isPlottablePosition(south, west)).toBe(true);
    expect(isPlottablePosition(north, east)).toBe(true);
    expect(isPlottablePosition(south - 0.0001, west)).toBe(false);
    expect(isPlottablePosition(north, east + 0.0001)).toBe(false);
  });

  // The two gates are complementary, and this pins the gap that existed
  // between them so it cannot silently reopen.
  it('is strictly stronger than the feed-level coordinate gate', () => {
    // The feed gate passes it; this one does not. That difference IS the fix.
    expect(isValidCoordinate(0.0, 77.855354)).toBe(true);
    expect(isPlottablePosition(0.0, 77.855354)).toBe(false);
  });
});

describe('partitionPlottable', () => {
  const point = (id: string, latitude: number, longitude: number) => ({
    id,
    latitude,
    longitude,
    headingDegrees: null,
    dataQuality: 'good' as const,
  });

  it('separates drawable positions from unusable ones, preserving order', () => {
    const { plottable, unplottable } = partitionPlottable([
      point('A', 26.85, 80.95),
      point('BAD', 0, 77.85),
      point('B', 28.4, 79.5),
      point('NAN', Number.NaN, 79.5),
    ]);

    expect(plottable.map((p) => p.id)).toEqual(['A', 'B']);
    expect(unplottable.map((p) => p.id)).toEqual(['BAD', 'NAN']);
  });

  it('accounts for every record it was given', () => {
    const input = [point('A', 26.85, 80.95), point('BAD', 0, 0), point('B', 27, 80)];
    const { plottable, unplottable } = partitionPlottable(input);
    expect(plottable.length + unplottable.length).toBe(input.length);
  });

  it('handles an empty set', () => {
    expect(partitionPlottable([])).toEqual({ plottable: [], unplottable: [] });
  });
});
