// Colour is not enough on the fleet map, and this file is the proof plus the
// guard.
//
// ─── THE FINDING ─────────────────────────────────────────────────────────
//
// Simulating protanopia on the committed fleet palette, and measuring
// separation as Euclidean distance in linear RGB after a Viénot (1999)
// dichromat simulation, the LIGHT palette collapses:
//
//     degraded (#995100) vs stale (#cd1a37)   ->   0.038
//
// For scale: the same pair on the dark palette reads 0.433. 0.038 is not "low
// contrast"; it is the same colour. An operator with the most common form of
// colour blindness — roughly one in twelve men — could not tell a degraded bus
// from a stale one anywhere on the map, in the theme used in daylight.
//
// The design spec anticipated this and required redundant encoding. The code
// then claimed it, in a comment, by pointing at the fleet panel and the bus
// drawer. That is not redundant encoding OF THE MAP: on the surface where
// ~9,200 marks are read at a glance, quality was `fillStyle` and nothing else.
//
// It is also not fixable by choosing better hues. An exhaustive search over
// green/amber/red triads tops out near 2.3:1 and only by making "degraded" the
// brightest thing on screen. So the fix is a second channel — a distinct SHAPE
// per quality — and this file pins both halves of the argument:
//
//   1. the colour separations, so the weakness stays measured rather than
//      remembered, and a palette edit that made it worse would be caught; and
//   2. that every quality still has its own shape, so the redundancy cannot be
//      deleted or collapsed by a later change.
//
// The separation of the RENDERED marks — where shape and casing count, not
// just fill colour — needs a real canvas and is measured by
// scripts/bench-fleet-canvas.ts. Its figures are recorded in
// fleetCanvasLayer.ts's header.
import { describe, it, expect } from 'vitest';
import {
  FLEET_PALETTE_DARK,
  FLEET_PALETTE_LIGHT,
  QUALITY_SHAPE,
  type FleetLayerPalette,
} from '@/components/map/fleetCanvasLayer';
import type { DataQuality } from '@/models/canonical';

type Cvd = 'protanopia' | 'deuteranopia';

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * Viénot, Brettel & Mollon (1999) dichromat simulation, returned in LINEAR
 * RGB — which is the space the separation is measured in, so there is no
 * round trip back through the sRGB transfer function to lose precision in.
 */
function simulate(hex: string, kind: Cvd): [number, number, number] {
  const [r, g, b] = channels(hex).map(toLinear) as [number, number, number];

  const L = 0.31399022 * r + 0.63951294 * g + 0.04649755 * b;
  const M = 0.15537241 * r + 0.75789446 * g + 0.0867014 * b;
  const S = 0.01775239 * r + 0.10944209 * g + 0.87256922 * b;

  let l = L;
  let m = M;
  if (kind === 'protanopia') l = 1.05118294 * M - 0.05116099 * S;
  else m = 0.9513092 * L + 0.04866992 * S;

  return [
    5.47221206 * l - 4.6419601 * m + 0.16963708 * S,
    -1.1252419 * l + 2.29317094 * m - 0.1678952 * S,
    0.02980165 * l - 0.19318073 * m + 1.16364789 * S,
  ].map((c) => Math.min(1, Math.max(0, c))) as [number, number, number];
}

function separation(a: string, b: string, kind: Cvd): number {
  const [ar, ag, ab] = simulate(a, kind);
  const [br, bg, bb] = simulate(b, kind);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

const PAIRS: [DataQuality, DataQuality][] = [
  ['good', 'degraded'],
  ['degraded', 'stale'],
  ['good', 'stale'],
];

function worstPair(palette: FleetLayerPalette, kind: Cvd): number {
  return Math.min(
    ...PAIRS.map(([a, b]) => separation(palette.quality[a], palette.quality[b], kind)),
  );
}

describe('the fleet palette under simulated colour blindness', () => {
  it('reproduces the finding: light mode’s worst pair is indistinguishable by hue', () => {
    // The number the whole redundant-encoding change exists because of.
    const degradedVsStale = separation(
      FLEET_PALETTE_LIGHT.quality.degraded,
      FLEET_PALETTE_LIGHT.quality.stale,
      'protanopia',
    );
    expect(degradedVsStale).toBeLessThan(0.05);
    expect(degradedVsStale).toBeCloseTo(0.038, 2);
  });

  it('records where each palette stands, for both dichromacies', () => {
    // Not a threshold, a record: these are the figures the shape encoding was
    // designed against, and a palette change that moved them should show up in
    // a diff rather than be discovered by an operator.
    const measured = {
      darkProtan: worstPair(FLEET_PALETTE_DARK, 'protanopia'),
      darkDeutan: worstPair(FLEET_PALETTE_DARK, 'deuteranopia'),
      lightProtan: worstPair(FLEET_PALETTE_LIGHT, 'protanopia'),
      lightDeutan: worstPair(FLEET_PALETTE_LIGHT, 'deuteranopia'),
    };

    expect(measured.darkProtan).toBeCloseTo(0.433, 2);
    expect(measured.darkDeutan).toBeCloseTo(0.285, 2);
    expect(measured.lightProtan).toBeCloseTo(0.038, 2);
    expect(measured.lightDeutan).toBeCloseTo(0.072, 2);

    // The asymmetry that made this a light-mode defect specifically.
    expect(measured.lightProtan).toBeLessThan(measured.darkProtan / 5);
  });
});

describe('the redundant encoding that colour blindness cannot remove', () => {
  it('draws every quality as a different shape', () => {
    // THE FIX. If two qualities ever share a shape, the map is back to hue
    // alone for that pair — which in light mode means back to 0.038.
    const shapes = Object.values(QUALITY_SHAPE);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('covers every quality the renderer can be handed', () => {
    // A fourth DataQuality added without a shape would fall back to whatever
    // `QUALITY_SHAPE[q]` returns for a missing key, which is a filled chevron —
    // silently colliding with `good`.
    const qualities: DataQuality[] = ['good', 'degraded', 'stale'];
    for (const quality of qualities) {
      expect(QUALITY_SHAPE[quality], `no shape for ${quality}`).toBeDefined();
    }
    expect(Object.keys(QUALITY_SHAPE).sort()).toEqual([...qualities].sort());
  });

  it('decides shape from the data, never from the palette', () => {
    // Shape must be identical in both themes: it is the channel that survives
    // when hue does not, so a theme must not be able to alter it. Asserted
    // structurally — the palettes carry colours only, and no shape key.
    for (const palette of [FLEET_PALETTE_DARK, FLEET_PALETTE_LIGHT]) {
      expect(Object.keys(palette).sort()).toEqual(['casing', 'quality', 'selected']);
    }
  });

  it('gives every palette a casing colour to separate marks from the ground', () => {
    for (const palette of [FLEET_PALETTE_DARK, FLEET_PALETTE_LIGHT]) {
      expect(palette.casing).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // The casing is the ground, not a fourth mark colour: it must not collide
    // with any quality colour, or it would read as a state of its own.
    for (const palette of [FLEET_PALETTE_DARK, FLEET_PALETTE_LIGHT]) {
      expect(Object.values(palette.quality)).not.toContain(palette.casing);
    }
  });
});
