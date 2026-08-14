/**
 * The shared canvas renderer, exercised through its real `draw()`.
 *
 * Two things are under test. First, correctness of the parts that decide what
 * an operator sees: the per-quality colour batching, the viewport cull, the
 * selected-vehicle pass, and the overlay geometry. Second, COST - the reason
 * this renderer exists instead of markers.
 *
 * ON THE COST MEASUREMENT, AND WHAT IT IS WORTH. The harness records
 * `fill`/`stroke` calls rather than shading pixels and stands in for Path2D,
 * so the figure here is the JavaScript half of a frame: projection maths,
 * culling, and building one SVG path string per colour. It excludes the C++
 * path parse and rasterisation. Treat it as a regression tripwire, not as the
 * frame time.
 *
 * THE AUTHORITATIVE FIGURE IS FROM A REAL BROWSER, and it is recorded in the
 * header of fleetCanvasLayer.ts: Chromium on Apple M5 Pro, statewide zoom,
 * 9,170 vehicles with nothing culled, median 4.3 ms per draw, sustained at the
 * 120 Hz rAF cap, unchanged by 60 incident overlay marks. The same measurement
 * against the per-vertex Path2D construction this file's subject replaced read
 * 53.7 ms and 18.5 fps.
 *
 * The assertion below is a ceiling far above the observed figure, because a
 * regression here means seconds, not milliseconds: the marker implementation
 * originally replaced measured 5.1 seconds of blocking across a few zoom
 * steps. A tight bound would only buy CI flakes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createFleetLayer } from '@/components/map/fleetCanvasLayer';
import { installFakeGoogleMaps, type FakeMapHarness } from '@/tests/helpers/fakeGoogleMap';
import type { MapVehicle } from '@/lib/maps/contract';

let harness: FakeMapHarness | null = null;

afterEach(() => {
  harness?.restore();
  harness = null;
});

/** Spread across Uttar Pradesh, deterministically - no PRNG seed to drift. */
function fleet(count: number): MapVehicle[] {
  const vehicles: MapVehicle[] = [];
  for (let index = 0; index < count; index += 1) {
    vehicles.push({
      id: `V${index}`,
      latitude: 24.5 + ((index * 7919) % 5800) / 1000,
      longitude: 77.2 + ((index * 6271) % 7400) / 1000,
      headingDegrees: (index * 37) % 360,
      dataQuality: index % 11 === 0 ? 'stale' : index % 3 === 0 ? 'degraded' : 'good',
    });
  }
  return vehicles;
}

/** Distinct shapes in a batched path, however the layer built it. */
function chevronCount(path: unknown): number {
  return (path as { subpaths?: number } | null)?.subpaths ?? 0;
}

describe('fleet canvas layer', () => {
  it('batches the whole fleet into exactly one fill per data-quality colour', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setVehicles(fleet(3000));
    harness.flushFrames();

    const fills = harness.context().fills;
    // Three quality colours, whatever the vehicle count. That ratio is the
    // property that makes 9k vehicles affordable.
    expect(fills).toHaveLength(3);
    expect(fills.map((entry) => entry.colour)).toEqual(['#2bff88', '#ffb020', '#ff4d5e']);
    const drawn = fills.reduce((total, entry) => total + chevronCount(entry.path), 0);
    expect(drawn).toBe(3000);
  });

  it('culls vehicles outside the viewport instead of drawing them off-screen', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setVehicles([
      { id: 'in', latitude: 27.0, longitude: 80.0, headingDegrees: 0, dataQuality: 'good' },
      // Southern hemisphere: nowhere near the viewport.
      { id: 'out', latitude: -30.0, longitude: 80.0, headingDegrees: 0, dataQuality: 'good' },
    ]);
    harness.flushFrames();

    const drawn = harness.context().fills.reduce((total, entry) => total + chevronCount(entry.path), 0);
    expect(drawn).toBe(1);
  });

  it('lifts the selected vehicle out of the batch and paints it separately', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setVehicles(fleet(10));
    layer.setSelected('V3');
    harness.flushFrames();

    const fills = harness.context().fills;
    const batched = fills.slice(0, 3).reduce((total, entry) => total + chevronCount(entry.path), 0);
    expect(batched).toBe(9);
    // The selected vehicle gets its own fill in its own colour, above the fleet.
    expect(fills.at(-1)?.colour).toBe('#3ff0ff');
  });

  it('redraws when the map moves', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setVehicles(fleet(5));
    harness.flushFrames();
    const before = harness.context().clears;

    harness.emit('bounds_changed');
    harness.flushFrames();
    expect(harness.context().clears).toBe(before + 1);
  });

  it('coalesces several updates in one animation frame into a single redraw', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setVehicles(fleet(5));
    layer.setSelected('V1');
    layer.setOverlays([]);
    expect(harness.flushFrames()).toBe(1);
  });
});

describe('fleet canvas layer overlays', () => {
  const A = { latitude: 27.0, longitude: 80.0 };
  const B = { latitude: 27.1, longitude: 80.1 };

  it('strokes a dashed link with a ring at each vertex, and labels it once', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setOverlays([
      { id: 'incidents', marks: [{ id: 'inc-1', points: [A, B], colour: '#ff8a3d', label: 'BUNCHED', dashed: true }] },
    ]);
    harness.flushFrames();

    const recorded = harness.context();
    expect(recorded.strokes).toHaveLength(1);
    expect(recorded.strokes[0]?.colour).toBe('#ff8a3d');
    expect(recorded.strokes[0]?.dash).toEqual([6, 5]);
    expect(chevronCount(recorded.strokes[0]?.path)).toBeGreaterThan(0);
    expect(recorded.texts.map((entry) => entry.text)).toEqual(['BUNCHED']);
  });

  it('batches marks sharing a colour and dash into one stroke', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setOverlays([
      {
        id: 'incidents',
        marks: Array.from({ length: 40 }, (_, index) => ({
          id: `inc-${index}`,
          points: [A, B],
          colour: '#ff8a3d',
          dashed: true,
        })),
      },
    ]);
    harness.flushFrames();
    expect(harness.context().strokes).toHaveLength(1);
  });

  it('separates batches by colour, so severity stays distinguishable', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setOverlays([
      {
        id: 'incidents',
        marks: [
          { id: 'w', points: [A], colour: '#ffd166' },
          { id: 'b', points: [A], colour: '#ff8a3d' },
          { id: 's', points: [A], colour: '#ff4d5e' },
        ],
      },
    ]);
    harness.flushFrames();
    expect(harness.context().strokes.map((entry) => entry.colour)).toEqual(['#ffd166', '#ff8a3d', '#ff4d5e']);
  });

  it('drops labels past the cap but keeps the geometry', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setOverlays([
      {
        id: 'incidents',
        marks: Array.from({ length: 200 }, (_, index) => ({
          id: `inc-${index}`,
          points: [A],
          colour: '#ff8a3d',
          label: 'BUNCHED',
        })),
      },
    ]);
    harness.flushFrames();
    expect(harness.context().texts).toHaveLength(0);
    expect(harness.context().strokes).toHaveLength(1);
  });

  it('keeps a link whose endpoints are both off-screen but which crosses the view', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setOverlays([
      {
        id: 'incidents',
        // Far west and far east of the viewport: a per-vertex cull would erase
        // the very connection the operator panned in to see.
        marks: [{ id: 'inc-1', points: [{ latitude: 27, longitude: 60 }, { latitude: 27, longitude: 100 }], colour: '#ff4d5e' }],
      },
    ]);
    harness.flushFrames();
    expect(harness.context().strokes).toHaveLength(1);
  });

  it('draws a beneath overlay before the fleet and a normal one after it', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setVehicles(fleet(5));
    layer.setOverlays([
      { id: 'under', beneath: true, marks: [{ id: 'u', points: [A], colour: '#111111' }] },
      { id: 'over', marks: [{ id: 'o', points: [B], colour: '#eeeeee' }] },
    ]);
    harness.flushFrames();

    const recorded = harness.context();
    // fills: [under-wash, good, degraded, stale, over-wash]
    expect(recorded.fills[0]?.colour).toBe('#111111');
    expect(recorded.fills.at(-1)?.colour).toBe('#eeeeee');
    expect(recorded.strokes.map((entry) => entry.colour)).toEqual(['#111111', '#eeeeee']);
  });
});

describe('fleet canvas layer render cost at statewide scale', () => {
  it('draws the full ~9,170-vehicle fleet well inside a frame budget', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    // The real statewide count, with nothing culled: the camera is on the
    // whole of Uttar Pradesh, so every vehicle is projected AND drawn.
    const vehicles = fleet(9170);

    // One warm-up frame so JIT compilation is not counted as render cost.
    layer.setVehicles(vehicles);
    harness.flushFrames();

    const frames = 30;
    const started = performance.now();
    for (let index = 0; index < frames; index += 1) {
      harness.emit('bounds_changed');
      harness.flushFrames();
    }
    const msPerFrame = (performance.now() - started) / frames;

    // Observed ~4.8 ms per frame for the JavaScript half on an M5 Pro. The
    // ceiling is 50 ms - three 60 Hz frames - because the failure this guards
    // against is an accidental return to per-vehicle objects or per-vehicle
    // projection calls, which costs seconds, not a few milliseconds of drift.
    expect(msPerFrame).toBeLessThan(50);

    // The last three fills are the final frame's three colour batches; the
    // recorder accumulates across every frame it saw.
    const drawn = harness
      .context()
      .fills.slice(-3)
      .reduce((total, entry) => total + chevronCount(entry.path), 0);
    expect(drawn).toBe(9170);
    console.info(`[render cost] 9,170 vehicles, nothing culled: ${msPerFrame.toFixed(2)} ms/frame (JS only)`);
  });
});
