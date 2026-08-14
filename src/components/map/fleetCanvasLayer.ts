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
 * That default is what makes this change safe to land while another lane owns
 * the ops dashboards: `OpsFleetMap` calls `createFleetLayer` with no options
 * and gets the exact colours it draws today, byte for byte. Only a caller
 * that asks for the day palette gets different pixels.
 *
 * The day values are darkened and desaturated versions of the same three
 * hues — the operator's learned mapping (green good, amber degraded, red
 * stale) is preserved. And as everywhere else in this product, colour is
 * NOT the only encoding: quality is stated in words in the fleet panel and
 * the bus drawer, because roughly one in twelve male operators cannot
 * separate the good/degraded pair by hue at all.
 */
export interface FleetLayerPalette {
  quality: Record<DataQuality, string>;
  selected: string;
}

/** The night palette. Unchanged, and still the default for every caller. */
export const FLEET_PALETTE_DARK: FleetLayerPalette = {
  quality: { good: '#2bff88', degraded: '#ffb020', stale: '#ff4d5e' },
  selected: '#3ff0ff',
};

/** The day palette — same three hues, at the luminance a white ground needs. */
export const FLEET_PALETTE_LIGHT: FleetLayerPalette = {
  quality: { good: '#0b8450', degraded: '#995100', stale: '#cd1a37' },
  selected: '#0b6e87',
};

const QUALITIES: DataQuality[] = ['good', 'degraded', 'stale'];

/** Google's world is 256px square at zoom 0; all projection maths derives from this. */
const TILE_SIZE = 256;

/** Chevron geometry at scale 1, in CSS pixels, nose pointing up. */
const NOSE_Y = -7;
const WING_X = 4.4;
const WING_Y = 5.6;
const TAIL_Y = 2.8;

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

      // ---- Project every vehicle, batching by colour ----
      const segments: Record<DataQuality, string[]> = { good: [], degraded: [], stale: [] };

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

        segments[vehicle.dataQuality].push(
          chevronPath(x, y, vehicle.headingDegrees ?? 0, markerScale),
        );
        hits.push({ x, y, vehicle });
      }

      // ---- Paint: one fill per colour, whatever the vehicle count ----
      ctx.globalAlpha = 0.9;
      for (const quality of QUALITIES) {
        const batch = segments[quality];
        if (batch.length === 0) continue;
        ctx.fillStyle = palette.quality[quality];
        ctx.fill(new Path2D(batch.join('')));
      }
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
function chevronPath(cx: number, cy: number, heading: number, scale: number): string {
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
