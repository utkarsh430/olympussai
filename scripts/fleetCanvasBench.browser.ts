/**
 * The in-page half of `pnpm bench:fleet-map`.
 *
 * Separate from the driver script because it is BUNDLED and injected into a
 * real page, which is the whole point: it imports the fleet layer's actual
 * paint path, so the frame cost reported is the cost of the code that ships
 * rather than of a reimplementation of it. See scripts/bench-fleet-canvas.ts.
 */
import {
  FLEET_PALETTE_DARK,
  FLEET_PALETTE_LIGHT,
  addMark,
  chevronPath,
  emptyMarkBatches,
  paintFleetMarks,
  type FleetLayerPalette,
} from '../src/components/map/fleetCanvasLayer';
import type { DataQuality } from '../src/models/canonical';

type Cvd = 'protanopia' | 'deuteranopia';

export interface BenchOptions {
  vehicles: number;
  frames: number;
  width: number;
  height: number;
}

export interface BenchReport {
  cost: Record<string, number>;
  breakdown?: Record<string, number>;
  cvd: Record<string, Record<string, Record<string, number>>>;
}

/** Statewide zoom taper — the busiest frame the renderer ever draws. */
const STATEWIDE_SCALE = 0.55;

/** The grounds a mark is actually read over, from MAP_DARK_STYLE / MAP_LIGHT_STYLE. */
const GROUNDS: Record<'dark' | 'light', Record<string, string>> = {
  dark: { road: '#0d1b2a', land: '#080d18', water: '#03060d' },
  light: { road: '#ffffff', land: '#e6ecf3', water: '#cddced' },
};

const QUALITY_PAIRS: [DataQuality, DataQuality][] = [
  ['good', 'degraded'],
  ['degraded', 'stale'],
  ['good', 'stale'],
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Viénot, Brettel & Mollon (1999) dichromat simulation of one sRGB triple. */
function simulate(r: number, g: number, b: number, kind: Cvd): [number, number, number] {
  const lin = [r, g, b].map((channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }) as [number, number, number];

  const L = 0.31399022 * lin[0] + 0.63951294 * lin[1] + 0.04649755 * lin[2];
  const M = 0.15537241 * lin[0] + 0.75789446 * lin[1] + 0.0867014 * lin[2];
  const S = 0.01775239 * lin[0] + 0.10944209 * lin[1] + 0.87256922 * lin[2];

  let l = L;
  let m = M;
  if (kind === 'protanopia') l = 1.05118294 * M - 0.05116099 * S;
  else m = 0.9513092 * L + 0.04866992 * S;

  const out: [number, number, number] = [
    5.47221206 * l - 4.6419601 * m + 0.16963708 * S,
    -1.1252419 * l + 2.29317094 * m - 0.1678952 * S,
    0.02980165 * l - 0.19318073 * m + 1.16364789 * S,
  ];
  return out.map((c) => Math.min(1, Math.max(0, c))) as [number, number, number];
}

/**
 * Mean distance in linear RGB after simulation, over the marks themselves.
 *
 * The same metric the palette audit used (Euclidean distance in linear RGB on
 * a simulated pair), applied to whole rendered marks rather than to a single
 * fill colour — so a difference in SHAPE or in casing contributes to it
 * exactly as a difference in hue does.
 *
 * Averaged over the UNION OF THE TWO MARKS' FOOTPRINTS rather than over the
 * whole tile. Averaging over the tile would divide by a few hundred identical
 * background pixels and report every pair as near-identical no matter how
 * differently they were drawn — it would measure how much of the tile is empty,
 * which is not a question anybody asked. `ground` is the tile rendered with no
 * mark on it, so "footprint" means every pixel either mark put ink in.
 */
function separation(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  ground: Uint8ClampedArray,
  kind: Cvd,
): number {
  const inked = (px: Uint8ClampedArray, i: number) =>
    px[i] !== ground[i] || px[i + 1] !== ground[i + 1] || px[i + 2] !== ground[i + 2];

  let total = 0;
  let counted = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (!inked(a, i) && !inked(b, i)) continue;
    const pa = simulate(a[i] ?? 0, a[i + 1] ?? 0, a[i + 2] ?? 0, kind);
    const pb = simulate(b[i] ?? 0, b[i + 1] ?? 0, b[i + 2] ?? 0, kind);
    total += Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    counted += 1;
  }
  return counted === 0 ? 0 : total / counted;
}

export function run(options: BenchOptions): BenchReport {
  const { vehicles, frames, width, height } = options;
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  // The same deterministic spread and quality mix the unit suite uses.
  const marks = Array.from({ length: vehicles }, (_, i) => ({
    x: (((i * 7919) % 100000) / 100000) * width,
    y: (((i * 6271) % 100000) / 100000) * height,
    heading: (i * 37) % 360,
    quality: (i % 11 === 0 ? 'stale' : i % 3 === 0 ? 'degraded' : 'good') as DataQuality,
  }));

  /** Force the frame to completion so rasterisation lands inside the timing. */
  const flush = () => ctx.getImageData(0, 0, 1, 1);

  /** AFTER — the shipped paint: shapes, ring and casing included. */
  const frameAfter = (palette: FleetLayerPalette) => {
    ctx.clearRect(0, 0, width, height);
    const batches = emptyMarkBatches();
    for (const mark of marks) {
      addMark(batches, mark.quality, mark.x, mark.y, mark.heading, STATEWIDE_SCALE);
    }
    paintFleetMarks(ctx, batches, palette, STATEWIDE_SCALE);
    flush();
  };

  /**
   * BEFORE — one fill per quality colour, no shape, no casing.
   *
   * Rebuilt here from the same `chevronPath` the layer uses, so the delta
   * measured is the encoding change and nothing else.
   */
  const frameBefore = (palette: FleetLayerPalette) => {
    ctx.clearRect(0, 0, width, height);
    const segments: Record<DataQuality, string[]> = { good: [], degraded: [], stale: [] };
    for (const mark of marks) {
      segments[mark.quality].push(chevronPath(mark.x, mark.y, mark.heading, STATEWIDE_SCALE));
    }
    ctx.globalAlpha = 0.9;
    for (const quality of ['good', 'degraded', 'stale'] as DataQuality[]) {
      const batch = segments[quality];
      if (batch.length === 0) continue;
      ctx.fillStyle = palette.quality[quality];
      ctx.fill(new Path2D(batch.join('')));
    }
    ctx.globalAlpha = 1;
    flush();
  };

  const time = (frame: () => void): number => {
    for (let i = 0; i < 8; i += 1) frame(); // warm-up: JIT, not render cost
    const samples: number[] = [];
    for (let i = 0; i < frames; i += 1) {
      const start = performance.now();
      frame();
      samples.push(performance.now() - start);
    }
    return median(samples);
  };

  // ── Phase breakdown, so a regression can be attributed rather than guessed ──
  const buildBatches = () => {
    const batches = emptyMarkBatches();
    for (const mark of marks) {
      addMark(batches, mark.quality, mark.x, mark.y, mark.heading, STATEWIDE_SCALE);
    }
    return batches;
  };
  const prebuilt = buildBatches();
  const paths = {
    good: new Path2D(prebuilt.chevrons.good.join('')),
    degraded: new Path2D(prebuilt.chevrons.degraded.join('')),
    stale: new Path2D(prebuilt.chevrons.stale.join('')),
    rings: new Path2D(prebuilt.rings.join('')),
  };
  /**
   * The stroke cliff, which is why the casing has a mark limit.
   *
   * Canvas has a hairline fast path that ends at one DEVICE pixel; a hair
   * either side of it is a 20x difference, and no amount of batching helps.
   */
  const breakdown: Record<string, number> = {
    'fill 9,170 chevrons': time(() => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#2bff88';
      ctx.fill(paths.good);
      ctx.fill(paths.degraded);
      ctx.fill(paths.stale);
      flush();
    }),
    'stroke 9,170, width 1.00 (hairline)': time(() => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#02040a';
      ctx.stroke(paths.good);
      ctx.stroke(paths.degraded);
      ctx.stroke(paths.stale);
      flush();
    }),
    'stroke 9,170, width 1.05': time(() => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1.05;
      ctx.strokeStyle = '#02040a';
      ctx.stroke(paths.good);
      ctx.stroke(paths.degraded);
      ctx.stroke(paths.stale);
      flush();
    }),
    'stroke 9,170, width 1.21 round join': time(() => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.21;
      ctx.strokeStyle = '#02040a';
      ctx.stroke(paths.good);
      ctx.stroke(paths.degraded);
      ctx.stroke(paths.stale);
      flush();
    }),
  };

  const cost: Record<string, number> = {
    beforeDark: time(() => frameBefore(FLEET_PALETTE_DARK)),
    afterDark: time(() => frameAfter(FLEET_PALETTE_DARK)),
    beforeLight: time(() => frameBefore(FLEET_PALETTE_LIGHT)),
    afterLight: time(() => frameAfter(FLEET_PALETTE_LIGHT)),
  };

  // ── Rendered-mark separation ────────────────────────────────────────────
  const TILE = 40;

  const renderMark = (
    quality: DataQuality,
    palette: FleetLayerPalette,
    ground: string,
  ): Uint8ClampedArray => {
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, TILE, TILE);
    const batches = emptyMarkBatches();
    // Scale 1: the zoom at which an operator reads an individual bus.
    addMark(batches, quality, TILE / 2, TILE / 2, 0, 1);
    paintFleetMarks(ctx, batches, palette, 1);
    return ctx.getImageData(0, 0, TILE, TILE).data;
  };

  const renderGround = (ground: string): Uint8ClampedArray => {
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, TILE, TILE);
    return ctx.getImageData(0, 0, TILE, TILE).data;
  };

  const fillOnly = (hex: string): Uint8ClampedArray => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data;
  };

  const cvd: Record<string, Record<string, Record<string, number>>> = {};
  const themes: [string, FleetLayerPalette][] = [
    ['dark', FLEET_PALETTE_DARK],
    ['light', FLEET_PALETTE_LIGHT],
  ];

  for (const [themeName, palette] of themes) {
    cvd[themeName] = {};
    const grounds = Object.values(GROUNDS[themeName as 'dark' | 'light']);
    for (const kind of ['protanopia', 'deuteranopia'] as Cvd[]) {
      const row: Record<string, number> = {};
      for (const [qa, qb] of QUALITY_PAIRS) {
        // A single pixel of each fill colour: nothing is background, so the
        // union mask is the whole (one-pixel) image.
        const fa = fillOnly(palette.quality[qa]);
        const fb = fillOnly(palette.quality[qb]);
        row[`${qa}/${qb} fill-only`] = separation(fa, fb, new Uint8ClampedArray(4), kind);

        // The worst of the three grounds the mark is read over.
        let worst = Infinity;
        for (const ground of grounds) {
          worst = Math.min(
            worst,
            separation(
              renderMark(qa, palette, ground),
              renderMark(qb, palette, ground),
              renderGround(ground),
              kind,
            ),
          );
        }
        row[`${qa}/${qb} rendered`] = worst;
      }
      cvd[themeName]![kind] = row;
    }
  }

  return { cost, breakdown, cvd };
}
