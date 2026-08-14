import type { DataQuality } from '@/models/canonical';
import type { FleetMapOverlay, FleetMapOverlayMark, MapVehicle } from '@/lib/maps/contract';

/**
 * Canvas overlay for a live vehicle fleet.
 *
 * Why not google.maps.Marker: the feed carries ~9.5k vehicles. One Marker per
 * bus means 9.5k overlay objects, and MarkerClusterer then re-clusters and
 * re-creates cluster markers on every zoom/pan — measured at 5.1 seconds of
 * main-thread blocking across a handful of zoom steps.
 *
 * This layer draws every vehicle into a single canvas. Redraw is O(visible)
 * with no DOM churn, so pan/zoom stays on the compositor and the main thread
 * stays free.
 *
 * Every vehicle is drawn at its own position — there is no clustering, so a
 * dense corridor reads as dense. Three things keep that affordable at ~9.5k
 * markers: chevrons are accumulated into one Path2D per colour and filled in a
 * single call; positions are projected with local Mercator maths rather than
 * ~9.5k round trips through the Maps projection API; and each colour's path is
 * handed to Path2D as ONE SVG path string rather than built by ~46,000
 * individual moveTo/lineTo/closePath calls.
 *
 * That last one is not a micro-optimisation, and the numbers are the reason it
 * is called out here. Measured in Chromium (Metal, Apple M5 Pro), statewide
 * zoom, 9,170 vehicles with nothing culled, timing the draw callback itself:
 *
 *   per-vertex Path2D calls   median 53.7 ms/frame   sustained 18.5 fps
 *   one SVG string per colour median  4.3 ms/frame   sustained  120 fps
 *
 * The cause is binding crossings: ~46,000 moveTo/lineTo/closePath calls per
 * frame cost 111 ms, while building the identical geometry as one string per
 * colour and parsing it in a single Path2D construction costs 4.4 ms.
 * Rasterisation is ~15 ms either way and does not scale with the vehicle
 * count, which is what the per-colour batching buys. Sixty incident overlay
 * marks on top change the figure by nothing measurable. The output is pixel
 * for pixel identical to the imperative construction - see chevronPath below
 * for why that required full-precision coordinates. Do not "simplify" this
 * back into per-vertex calls; it turns a smooth statewide pan into a visibly
 * juddering one.
 *
 * GENERIC OVER THE CALLER'S VEHICLE TYPE. It used to be typed on
 * CanonicalLiveBus, which is why the ops dashboards could not use it without
 * either forking the renderer or pretending an ops vehicle was a
 * command-centre bus. It now takes anything satisfying `MapVehicle`
 * (src/lib/maps/contract.ts) and hands the caller's own record back to the
 * click callback, so both surfaces share one renderer and one set of
 * projection bugs to fix.
 *
 * Overlays (`setOverlays`) are annotations - bunching incidents today -
 * painted in the same frame as the fleet. Same canvas, same requestAnimationFrame,
 * so annotating costs no extra pass and no DOM node. The layer knows nothing
 * about incidents; it draws rings and paths at coordinates it is given.
 */

/**
 * ─── THE MARK PALETTE IS THEMED, AND HAS TO BE ───────────────────────────
 *
 * Canvas takes a colour STRING. It cannot read a CSS custom property, cannot
 * resolve a Tailwind class and does not care what `.dark` is on. So a fleet
 * layer that hard-codes neon draws neon: `#2bff88` is 1.19:1 against the
 * light basemap's road white, which is not "a bit low contrast", it is
 * invisible. Nine thousand buses would simply vanish when an operator moved
 * the console into light.
 *
 * The palette is therefore a parameter with the night values as its default.
 * The day values are darkened and desaturated versions of the same three
 * hues, so the operator's learned mapping (green good, amber degraded, red
 * stale) is preserved.
 *
 * ─── AND COLOUR IS NOT ENOUGH, WHICH IS WHY THERE ARE SHAPES ─────────────
 *
 * This file used to say that quality is "stated in words in the fleet panel
 * and the bus drawer" and treat that as the redundant encoding. It is not one,
 * for the surface that matters: on the MAP, where ~9,200 marks are read at a
 * glance, quality was `fillStyle` and nothing else. A panel three hundred
 * pixels away does not help an operator scanning a corridor.
 *
 * Simulating dichromacy on the committed hex values says how badly that
 * fails. Separation below is Euclidean distance in linear RGB after a Viénot
 * (1999) simulation; the FILL-ONLY column is the fill colour alone, which is
 * all the map used to have:
 *
 *                              fill-only            rendered mark
 *                          protan   deutan        protan   deutan
 *   dark  degraded/stale    0.433    0.351         0.187    0.225
 *   light good/degraded     0.127    0.087         0.371    0.357
 *   light degraded/stale    0.038    0.072         0.574    0.546
 *   light good/stale        0.121    0.100         0.609    0.570
 *
 * Light mode collapsed. 0.038 is not "low contrast", it is the same colour:
 * an operator with the most common form of colour blindness could not tell a
 * degraded bus from a stale one anywhere on the map. And it is not fixable by
 * choosing better hues — an exhaustive search over green/amber/red triads
 * tops out around 2.3:1, and only by making "degraded" the brightest thing on
 * screen, which is a worse lie than the one it fixes.
 *
 * So the marks carry a SECOND channel that colour blindness cannot touch:
 *
 *   good      filled chevron
 *   degraded  filled chevron inside a ring
 *   stale     hollow chevron
 *
 * plus a casing — an outline in the ground colour under every mark — so the
 * shape survives over road white, land grey and water blue alike, and so
 * overlapping marks in a dense corridor stay individually countable.
 *
 * That is the "rendered mark" column: the same simulation and the same metric,
 * run over the marks AS DRAWN rather than over three hex strings, averaged
 * across the pixels either mark inks and taken over the worst of the three
 * grounds. Light mode's collapsed pair goes from 0.038 to 0.574.
 *
 * Shape is decided by `DataQuality`, never by the palette, so it is identical
 * in both themes and cannot be tuned away by a colour change. The colour
 * figures and the shape guarantee are pinned in fleetCanvasCvd.test.ts; the
 * rendered figures need a real canvas and come from
 * scripts/bench-fleet-canvas.ts (`pnpm bench:fleet-map`).
 *
 * COST OF ALL THIS: measured by the same script, statewide, 9,170 marks with
 * nothing culled and every frame forced to completion, the draw went from
 * 14.4 ms to 17-20 ms across five runs — a constant handful of extra calls,
 * not a per-vehicle one. (Those are headless-Chromium figures with a
 * per-frame readback, so they sit well above the 4.3 ms this file's original
 * measurement records on GPU hardware; the RATIO is the comparable part.)
 * What keeps it there is CASING_MARK_LIMIT — read its note before
 * "simplifying" the casing into an always-on stroke, which measures 71 ms.
 */
export interface FleetLayerPalette {
  quality: Record<DataQuality, string>;
  selected: string;
  /**
   * Drawn under every mark, in the colour of the ground it sits on, so a
   * chevron keeps its outline over white road, grey land and blue water — and
   * so two overlapping buses read as two marks rather than one blob.
   */
  casing: string;
}

/** The night palette. Unchanged, and still the default for every caller. */
export const FLEET_PALETTE_DARK: FleetLayerPalette = {
  quality: { good: '#2bff88', degraded: '#ffb020', stale: '#ff4d5e' },
  selected: '#3ff0ff',
  casing: '#02040a',
};

/** The day palette — same three hues, at the luminance a white ground needs. */
export const FLEET_PALETTE_LIGHT: FleetLayerPalette = {
  quality: { good: '#0b8450', degraded: '#995100', stale: '#cd1a37' },
  selected: '#0b6e87',
  casing: '#ffffff',
};

/**
 * The shape each quality is drawn as.
 *
 * The redundant channel, and deliberately a property of the DATA rather than
 * of the palette: a theme change cannot alter it, and a future palette edit
 * cannot quietly remove it.
 */
export const QUALITY_SHAPE: Record<DataQuality, 'filled' | 'ringed' | 'hollow'> = {
  good: 'filled',
  degraded: 'ringed',
  stale: 'hollow',
};

const QUALITIES: DataQuality[] = ['good', 'degraded', 'stale'];

/** Google's world is 256px square at zoom 0; all projection maths derives from this. */
const TILE_SIZE = 256;

/** Chevron geometry at scale 1, in CSS pixels, nose pointing up. */
const NOSE_Y = -7;
const WING_X = 4.4;
const WING_Y = 5.6;
const TAIL_Y = 2.8;

/**
 * The degraded ring, at scale 1. Sits outside the chevron's nose (7px) so it
 * reads as a ring AROUND the mark rather than a line through it — which also
 * makes "degraded" the physically largest mark, a third channel after colour
 * and shape.
 */
const RING_RADIUS = 8.4;

/** Stroke weights at scale 1: the casing under every mark, and the two outlined shapes. */
const CASING_WIDTH = 2.2;
const RING_WIDTH = 1.3;
const HOLLOW_WIDTH = 1.6;

/**
 * Strokes stop thinning below this, in CSS pixels.
 *
 * At statewide zoom `markerScale` is 0.55 and a proportionally-scaled outline
 * would come out near a single device pixel, where antialiasing eats it and
 * the redundant encoding quietly stops existing at exactly the zoom with the
 * most marks on screen. The shapes shrink; the lines that distinguish them
 * hold a floor.
 */
const MIN_STROKE = 1;

/**
 * Above this many marks in a frame, the casing is dropped and the marks are
 * drawn shape-and-colour only.
 *
 * ─── WHY THERE IS A LIMIT AT ALL ─────────────────────────────────────────
 *
 * Measured in Chromium (scripts/bench-fleet-canvas.ts), 9,170 marks, whole
 * frame forced to completion. Canvas stroking has a hairline fast path that
 * cuts off at one DEVICE pixel, and the cliff on either side of it is the
 * whole story:
 *
 *   stroke 9,170 chevrons, width 1.00 (hairline)      2.0 ms
 *   stroke 9,170 chevrons, width 1.05                41.3 ms
 *   stroke 9,170 chevrons, width 1.21, round join    42.4 ms
 *   fill   9,170 chevrons                             9.9 ms
 *
 * A casing thin enough to be free is one physical pixel, which on the wall
 * display is not a casing. A casing thick enough to read costs four frames.
 *
 * So it is drawn when it can be afforded AND when it is worth anything, which
 * turn out to be the same moment. Nine thousand marks on screen means the
 * camera is on the whole state, every chevron is four to eight pixels, and an
 * outline around one would merge it with its neighbours rather than separate
 * it — at that zoom an operator reads density, and reads an individual bus in
 * the fleet panel. Once the camera is on a corridor the cull leaves a few
 * hundred marks, each at full size, and that is exactly where an outline earns
 * its cost: it is what keeps a chevron legible over white road, grey land and
 * blue water, and what keeps two overlapping buses countable.
 *
 * The SHAPE encoding is not gated this way and never degrades — it is the
 * accessibility fix, it costs a stroke only on the ringed and hollow marks
 * rather than on all of them, and it is what carries the distinction when the
 * casing is off. Same principle as OVERLAY_LABEL_LIMIT above: degrade the
 * ornament, never the information.
 */
const CASING_MARK_LIMIT = 900;

/** Default overlay ring radius, in CSS pixels. */
const DEFAULT_RING_RADIUS = 9;

/**
 * Above this many on-screen overlay marks, labels are dropped and only the
 * geometry is drawn. Text is the one part of a canvas frame that does not
 * batch - every `fillText` is its own shaping and rasterisation pass - so a
 * pathological overlay must degrade to shapes rather than drop the frame
 * rate for the fleet underneath it.
 */
const OVERLAY_LABEL_LIMIT = 120;

export interface FleetLayerHandle<T extends MapVehicle = MapVehicle> {
  setVehicles(vehicles: readonly T[]): void;
  setSelected(id: string | null): void;
  /** Replace every annotation. Pass `[]` to clear. Cheap: the redraw it schedules is O(visible marks). */
  setOverlays(overlays: readonly FleetMapOverlay[]): void;
  /**
   * Repaint the fleet in a different palette. Cheap — it only schedules the
   * next frame — so a surface may call it straight from a theme change.
   */
  setPalette(palette: FleetLayerPalette): void;
  destroy(): void;
}

interface HitPoint<T> {
  x: number;
  y: number;
  vehicle: T;
}

function worldX(lng: number): number {
  return TILE_SIZE * (0.5 + lng / 360);
}

function worldY(lat: number): number {
  // Clamped short of the poles, where the Mercator projection diverges.
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return TILE_SIZE * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI));
}

/**
 * Marker size tapers as the camera pulls back. Statewide, full-size chevrons
 * merge into one slab of colour; a smaller mark keeps individual vehicles
 * distinguishable without hiding any of them.
 */
function markerScaleFor(zoom: number): number {
  if (zoom <= 7) return 0.55;
  if (zoom <= 9) return 0.7;
  if (zoom <= 11) return 0.85;
  return 1;
}

export function createFleetLayer<T extends MapVehicle>(
  map: google.maps.Map,
  onSelectVehicle: (vehicle: T) => void,
  /**
   * Defaults to the night palette, so every existing caller — including the
   * ops dashboards' OpsFleetMap — renders exactly what it rendered before.
   */
  initialPalette: FleetLayerPalette = FLEET_PALETTE_DARK,
): FleetLayerHandle<T> {
  let vehicles: readonly T[] = [];
  let overlays: readonly FleetMapOverlay[] = [];
  let selectedId: string | null = null;
  let redrawQueued = false;
  let palette = initialPalette;

  /** Screen positions painted in the last frame, so hit-testing matches exactly what is drawn. */
  let hits: HitPoint<T>[] = [];

  class FleetOverlay extends google.maps.OverlayView {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;

    onAdd(): void {
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.left = '0';
      canvas.style.top = '0';
      // The canvas must never swallow map gestures; clicks are resolved by a
      // hit-test on the map's own click event instead.
      canvas.style.pointerEvents = 'none';
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.getPanes()?.overlayLayer.appendChild(canvas);
    }

    onRemove(): void {
      this.canvas?.parentNode?.removeChild(this.canvas);
      this.canvas = null;
      this.ctx = null;
    }

    draw(): void {
      const canvas = this.canvas;
      const ctx = this.ctx;
      const projection = this.getProjection();
      if (!canvas || !ctx || !projection) return;

      const div = map.getDiv();
      const width = div.clientWidth;
      const height = div.clientHeight;
      if (width === 0 || height === 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      // The overlayLayer pane is itself translated by the map; counter-position
      // the canvas so its origin stays aligned with the viewport top-left.
      const bounds = map.getBounds();
      if (!bounds) return;
      const anchorLat = bounds.getNorthEast().lat();
      const anchorLng = bounds.getSouthWest().lng();
      const anchor = new google.maps.LatLng(anchorLat, anchorLng);

      const anchorDiv = projection.fromLatLngToDivPixel(anchor);
      const anchorPixel = projection.fromLatLngToContainerPixel(anchor);
      if (!anchorDiv || !anchorPixel) return;
      // Vehicles below are placed in *container*-pixel space (relative to
      // anchorPixel). The canvas lives in the overlayLayer pane, whose origin
      // sits at (anchorPixel - anchorDiv) in container space, so translating the
      // canvas by (anchorDiv - anchorPixel) lands its origin exactly on the
      // container's top-left. Subtracting anchorPixel matters whenever the
      // top-left corner does not project to (0,0) — which happens as soon as the
      // map sits inside a scaled/zoomed container (CSS zoom or browser zoom);
      // without it every marker is uniformly offset by that residual. When the
      // corner already projects to (0,0) this is identical to the old behaviour.
      canvas.style.transform = `translate(${anchorDiv.x - anchorPixel.x}px, ${anchorDiv.y - anchorPixel.y}px)`;

      // Scale is read off the projection rather than map.getZoom() so markers
      // stay welded to the basemap through animated zooms, where the reported
      // zoom reaches its target before the projection does.
      const scale = projection.getWorldWidth() / TILE_SIZE;
      if (!Number.isFinite(scale) || scale <= 0) return;

      const originX = anchorPixel.x - worldX(anchorLng) * scale;
      const originY = anchorPixel.y - worldY(anchorLat) * scale;
      const project = (point: { latitude: number; longitude: number }) => ({
        x: originX + worldX(point.longitude) * scale,
        y: originY + worldY(point.latitude) * scale,
      });

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const markerScale = markerScaleFor(map.getZoom() ?? 7);

      drawOverlays(ctx, overlays, project, width, height, true);

      // ---- Project every vehicle, batching by the shape its quality draws as ----
      const batches = emptyMarkBatches();

      hits = [];

      let selected: HitPoint<T> | null = null;

      for (const vehicle of vehicles) {
        const x = originX + worldX(vehicle.longitude) * scale;
        const y = originY + worldY(vehicle.latitude) * scale;

        // Cull generously so markers do not pop at the edges while panning.
        if (x < -60 || y < -60 || x > width + 60 || y > height + 60) continue;

        if (vehicle.id === selectedId) {
          selected = { x, y, vehicle };
          continue;
        }

        addMark(batches, vehicle.dataQuality, x, y, vehicle.headingDegrees ?? 0, markerScale);
        hits.push({ x, y, vehicle });
      }

      // ---- Paint: a fixed handful of calls, whatever the vehicle count ----
      paintFleetMarks(ctx, batches, palette, markerScale);
      ctx.globalAlpha = 1;

      if (selected) {
        drawSelectedVehicle(
          ctx,
          selected.x,
          selected.y,
          selected.vehicle.headingDegrees ?? 0,
          palette.selected,
        );
        hits.push(selected);
      }

      drawOverlays(ctx, overlays, project, width, height, false);
    }
  }

  const overlay = new FleetOverlay();
  overlay.setMap(map);

  /** Coalesce redraws to one per animation frame. */
  function scheduleRedraw(): void {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      overlay.draw();
    });
  }

  const clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
    const projection = overlay.getProjection();
    if (!projection || !event.latLng) return;
    const point = projection.fromLatLngToContainerPixel(event.latLng);
    if (!point) return;

    // Nearest vehicle within the hit radius wins. Where markers overlap at low
    // zoom the pick is arbitrary between neighbours, but selecting flies the
    // camera to that vehicle's exact position, which resolves it visually.
    let best: T | null = null;
    let bestDistance = 14; // px hit radius
    for (const hit of hits) {
      const distance = Math.hypot(hit.x - point.x, hit.y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = hit.vehicle;
      }
    }

    if (best) onSelectVehicle(best);
  });

  const moveListeners = [
    map.addListener('bounds_changed', scheduleRedraw),
    map.addListener('zoom_changed', scheduleRedraw),
    map.addListener('idle', scheduleRedraw),
    map.addListener('resize', scheduleRedraw),
  ];

  return {
    setVehicles(next: readonly T[]) {
      vehicles = next;
      scheduleRedraw();
    },
    setSelected(id: string | null) {
      selectedId = id;
      scheduleRedraw();
    },
    setOverlays(next: readonly FleetMapOverlay[]) {
      overlays = next;
      scheduleRedraw();
    },
    setPalette(next: FleetLayerPalette) {
      palette = next;
      scheduleRedraw();
    },
    destroy() {
      clickListener.remove();
      moveListeners.forEach((listener) => listener.remove());
      overlay.setMap(null);
    },
  };
}

/**
 * One heading-rotated chevron, as an SVG subpath.
 *
 * Vertices are rotated inline rather than through ctx.rotate() so thousands of
 * markers can share a single path and a single fill call. The result is a
 * string rather than Path2D calls because at fleet scale the binding crossings
 * dominate the frame - see the note at the top of this file for the measured
 * difference.
 *
 * Coordinates are stringified at FULL double precision, not rounded. Rounding
 * to two decimals is marginally faster (3.7 ms against 4.4 ms per statewide
 * frame) but it is not free: compared pixel by pixel against the imperative
 * path over a 2800x1800 device-pixel canvas, two decimals moves 5,037 pixels
 * and three moves 568, all of them on antialiased marker edges. Full precision
 * moves zero. Paying 0.7 ms to make this a provably pure performance change,
 * rather than one that quietly resamples every marker edge, is the right
 * trade at 4 ms a frame.
 */
export function chevronPath(cx: number, cy: number, heading: number, scale: number): string {
  const radians = (heading * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const nose = NOSE_Y * scale;
  const wingX = WING_X * scale;
  const wingY = WING_Y * scale;
  const tail = TAIL_Y * scale;

  return (
    `M${cx - nose * sin} ${cy + nose * cos}` +
    `L${cx + wingX * cos - wingY * sin} ${cy + wingX * sin + wingY * cos}` +
    `L${cx - tail * sin} ${cy + tail * cos}` +
    `L${cx - wingX * cos - wingY * sin} ${cy - wingX * sin + wingY * cos}Z`
  );
}

/**
 * One ring, as an SVG subpath.
 *
 * Two half-arcs rather than a `Path2D.arc()` call for the same reason the
 * chevron is a string: it joins the batch, so a thousand degraded buses cost
 * one path construction instead of a thousand binding crossings. Full
 * precision, like the chevron — see its note.
 */
export function ringPath(cx: number, cy: number, radius: number): string {
  return (
    `M${cx + radius} ${cy}` +
    `A${radius} ${radius} 0 1 0 ${cx - radius} ${cy}` +
    `A${radius} ${radius} 0 1 0 ${cx + radius} ${cy}`
  );
}

/**
 * One frame's mark geometry, already batched.
 *
 * Accumulated as strings per quality so the paint below is a fixed handful of
 * calls whatever the vehicle count — the property the whole file is built
 * around.
 */
export interface FleetMarkBatches {
  chevrons: Record<DataQuality, string[]>;
  /** Rings for the degraded marks only. */
  rings: string[];
}

export function emptyMarkBatches(): FleetMarkBatches {
  return { chevrons: { good: [], degraded: [], stale: [] }, rings: [] };
}

/** Add one vehicle's marks to the batch, in the shape its quality is drawn as. */
export function addMark(
  batches: FleetMarkBatches,
  quality: DataQuality,
  x: number,
  y: number,
  heading: number,
  markerScale: number,
): void {
  batches.chevrons[quality].push(chevronPath(x, y, heading, markerScale));
  if (QUALITY_SHAPE[quality] === 'ringed') {
    batches.rings.push(ringPath(x, y, RING_RADIUS * markerScale));
  }
}

/**
 * Paint one frame of fleet marks.
 *
 * ─── WHY THIS IS EXPORTED ────────────────────────────────────────────────
 *
 * So the frame-cost benchmark and the colour-blindness simulation drive THIS
 * function rather than a reimplementation of it. A performance budget measured
 * against a copy of the renderer measures the copy; this file's 4 ms/frame
 * figure is only meaningful if the thing being timed is the thing that ships.
 *
 * ─── THE CALL BUDGET ─────────────────────────────────────────────────────
 *
 * Four Path2D constructions and at most eight paint calls, for any number of
 * vehicles: one casing stroke per non-empty batch, two fills (good, degraded),
 * and two colour strokes (the degraded rings, the hollow stale chevrons).
 * Adding shape and casing to the marks therefore costs a constant number of
 * additional calls, not a per-vehicle one — which is what keeps it inside
 * budget at 9,200 marks. Measured before and after in fleetCanvasLayer.bench.
 */
export function paintFleetMarks(
  ctx: CanvasRenderingContext2D,
  batches: FleetMarkBatches,
  palette: FleetLayerPalette,
  markerScale: number,
): void {
  const chevrons: Record<DataQuality, Path2D | null> = { good: null, degraded: null, stale: null };
  for (const quality of QUALITIES) {
    const batch = batches.chevrons[quality];
    if (batch.length > 0) chevrons[quality] = new Path2D(batch.join(''));
  }
  const rings = batches.rings.length > 0 ? new Path2D(batches.rings.join('')) : null;

  const stroke = (width: number) => Math.max(MIN_STROKE, width * markerScale);

  const markCount = QUALITIES.reduce(
    (total, quality) => total + batches.chevrons[quality].length,
    0,
  );

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ---- 1. The casing, under everything, in the colour of the ground ----
  // One pass over every shape, so a mark keeps its outline over road white,
  // land grey and water blue, and two overlapping buses stay countable.
  // Dropped on a statewide frame — see CASING_MARK_LIMIT for the measurements.
  if (markCount <= CASING_MARK_LIMIT) {
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = palette.casing;
    ctx.lineWidth = stroke(CASING_WIDTH);
    for (const quality of QUALITIES) {
      const path = chevrons[quality];
      if (path) ctx.stroke(path);
    }
    if (rings) ctx.stroke(rings);
  }

  // ---- 2. The marks themselves, one call per shape ----
  ctx.globalAlpha = 0.9;

  // good — a solid chevron.
  if (chevrons.good) {
    ctx.fillStyle = palette.quality.good;
    ctx.fill(chevrons.good);
  }

  // degraded — a solid chevron inside a ring.
  if (chevrons.degraded) {
    ctx.fillStyle = palette.quality.degraded;
    ctx.fill(chevrons.degraded);
  }
  if (rings) {
    ctx.strokeStyle = palette.quality.degraded;
    ctx.lineWidth = stroke(RING_WIDTH);
    ctx.stroke(rings);
  }

  // stale — a hollow chevron. The basemap shows through the middle, which is
  // the point: it reads as "no solid reading here" without depending on hue.
  if (chevrons.stale) {
    ctx.strokeStyle = palette.quality.stale;
    ctx.lineWidth = stroke(HOLLOW_WIDTH);
    ctx.stroke(chevrons.stale);
  }

  ctx.restore();
}

/** The selected vehicle is drawn on its own, oversized and glowing, above the fleet. */
function drawSelectedVehicle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  colour: string,
): void {
  const path = new Path2D(chevronPath(x, y, heading, 1.7));

  ctx.save();
  ctx.fillStyle = colour;
  ctx.fill(path);

  ctx.lineWidth = 1.4;
  ctx.strokeStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 10;
  ctx.stroke(path);
  ctx.restore();
}

/**
 * Paint every overlay whose `beneath` matches this pass.
 *
 * Marks are grouped by colour and dash style so a hundred incidents cost a
 * handful of stroke calls rather than a hundred: the same batching that makes
 * the fleet itself affordable. Labels are the exception - they cannot batch,
 * so they are collected and drawn last, and dropped entirely past
 * OVERLAY_LABEL_LIMIT.
 */
function drawOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: readonly FleetMapOverlay[],
  project: (point: { latitude: number; longitude: number }) => { x: number; y: number },
  width: number,
  height: number,
  beneathPass: boolean,
): void {
  interface Batch {
    colour: string;
    dashed: boolean;
    path: Path2D;
  }
  const batches = new Map<string, Batch>();
  const labels: { x: number; y: number; text: string; colour: string }[] = [];

  for (const group of overlays) {
    if ((group.beneath ?? false) !== beneathPass) continue;

    for (const mark of group.marks) {
      const screen = projectMark(mark, project);
      const first = screen[0];
      if (first === undefined) continue;
      // Bounding-box cull rather than a per-vertex one: a link whose two ends
      // are both off-screen can still cross the viewport, and dropping it
      // would erase the very connection the operator panned in to see.
      if (!bboxIntersectsViewport(screen, width, height)) continue;

      const dashed = mark.dashed ?? false;
      const key = `${mark.colour}|${dashed ? 'd' : 's'}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = { colour: mark.colour, dashed, path: new Path2D() };
        batches.set(key, batch);
      }

      const radius = mark.radiusPx ?? DEFAULT_RING_RADIUS;
      if (screen.length > 1) {
        batch.path.moveTo(first.x, first.y);
        for (const point of screen.slice(1)) batch.path.lineTo(point.x, point.y);
      }
      for (const point of screen) {
        batch.path.moveTo(point.x + radius, point.y);
        batch.path.arc(point.x, point.y, radius, 0, Math.PI * 2);
      }

      if (mark.label !== undefined && mark.label !== '') {
        labels.push({ x: first.x, y: first.y - radius - 5, text: mark.label, colour: mark.colour });
      }
    }
  }

  if (batches.size === 0) return;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const batch of batches.values()) {
    ctx.setLineDash(batch.dashed ? [6, 5] : []);
    ctx.strokeStyle = batch.colour;
    ctx.globalAlpha = 0.95;
    ctx.stroke(batch.path);
    // A translucent wash inside the rings keeps an annotation readable over a
    // dense chevron field without hiding the vehicles it is pointing at.
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = batch.colour;
    ctx.fill(batch.path);
  }
  ctx.restore();

  if (labels.length === 0 || labels.length > OVERLAY_LABEL_LIMIT) return;
  ctx.save();
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const label of labels) {
    ctx.fillStyle = label.colour;
    ctx.fillText(label.text, label.x, label.y);
  }
  ctx.restore();
}

function projectMark(
  mark: FleetMapOverlayMark,
  project: (point: { latitude: number; longitude: number }) => { x: number; y: number },
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const point of mark.points) out.push(project(point));
  return out;
}

function bboxIntersectsViewport(
  points: readonly { x: number; y: number }[],
  width: number,
  height: number,
): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const margin = 60;
  return minX <= width + margin && maxX >= -margin && minY <= height + margin && maxY >= -margin;
}
