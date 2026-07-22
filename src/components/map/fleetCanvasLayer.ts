import type { CanonicalLiveBus, DataQuality } from '@/models/canonical';

/**
 * Canvas overlay for the live fleet.
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
 * dense corridor reads as dense. Two things keep that affordable at ~9.5k
 * markers: chevrons are accumulated into one Path2D per colour and filled in a
 * single call, and positions are projected with local Mercator maths rather
 * than ~9.5k round trips through the Maps projection API.
 */

const QUALITY_COLOUR: Record<DataQuality, string> = {
  good: '#2bff88',
  degraded: '#ffb020',
  stale: '#ff4d5e',
};

const QUALITIES: DataQuality[] = ['good', 'degraded', 'stale'];

const SELECTED_COLOUR = '#3ff0ff';

/** Google's world is 256px square at zoom 0; all projection maths derives from this. */
const TILE_SIZE = 256;

/** Chevron geometry at scale 1, in CSS pixels, nose pointing up. */
const NOSE_Y = -7;
const WING_X = 4.4;
const WING_Y = 5.6;
const TAIL_Y = 2.8;

export interface FleetLayerHandle {
  setBuses(buses: CanonicalLiveBus[]): void;
  setSelected(id: string | null): void;
  destroy(): void;
}

interface HitPoint {
  x: number;
  y: number;
  bus: CanonicalLiveBus;
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

export function createFleetLayer(
  map: google.maps.Map,
  onSelectBus: (bus: CanonicalLiveBus) => void,
): FleetLayerHandle {
  let buses: CanonicalLiveBus[] = [];
  let selectedId: string | null = null;
  let redrawQueued = false;

  /** Screen positions painted in the last frame, so hit-testing matches exactly what is drawn. */
  let hits: HitPoint[] = [];

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
      canvas.style.transform = `translate(${anchorDiv.x}px, ${anchorDiv.y}px)`;

      // Scale is read off the projection rather than map.getZoom() so markers
      // stay welded to the basemap through animated zooms, where the reported
      // zoom reaches its target before the projection does.
      const scale = projection.getWorldWidth() / TILE_SIZE;
      if (!Number.isFinite(scale) || scale <= 0) return;

      const originX = anchorPixel.x - worldX(anchorLng) * scale;
      const originY = anchorPixel.y - worldY(anchorLat) * scale;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const markerScale = markerScaleFor(map.getZoom() ?? 7);

      // ---- Project every vehicle, batching by colour ----
      const paths: Record<DataQuality, Path2D> = {
        good: new Path2D(),
        degraded: new Path2D(),
        stale: new Path2D(),
      };

      hits = [];

      let selected: HitPoint | null = null;

      for (const bus of buses) {
        const x = originX + worldX(bus.longitude) * scale;
        const y = originY + worldY(bus.latitude) * scale;

        // Cull generously so markers do not pop at the edges while panning.
        if (x < -60 || y < -60 || x > width + 60 || y > height + 60) continue;

        if (bus.id === selectedId) {
          selected = { x, y, bus };
          continue;
        }

        appendChevron(paths[bus.dataQuality], x, y, bus.headingDegrees ?? 0, markerScale);
        hits.push({ x, y, bus });
      }

      // ---- Paint: one fill per colour, whatever the vehicle count ----
      ctx.globalAlpha = 0.9;
      for (const quality of QUALITIES) {
        ctx.fillStyle = QUALITY_COLOUR[quality];
        ctx.fill(paths[quality]);
      }
      ctx.globalAlpha = 1;

      if (selected) {
        drawSelectedVehicle(ctx, selected.x, selected.y, selected.bus.headingDegrees ?? 0);
        hits.push(selected);
      }
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
    let best: CanonicalLiveBus | null = null;
    let bestDistance = 14; // px hit radius
    for (const hit of hits) {
      const distance = Math.hypot(hit.x - point.x, hit.y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = hit.bus;
      }
    }

    if (best) onSelectBus(best);
  });

  const moveListeners = [
    map.addListener('bounds_changed', scheduleRedraw),
    map.addListener('zoom_changed', scheduleRedraw),
    map.addListener('idle', scheduleRedraw),
    map.addListener('resize', scheduleRedraw),
  ];

  return {
    setBuses(next: CanonicalLiveBus[]) {
      buses = next;
      scheduleRedraw();
    },
    setSelected(id: string | null) {
      selectedId = id;
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
 * Add one heading-rotated chevron to a batch path.
 *
 * Vertices are rotated inline rather than through ctx.rotate() so thousands of
 * markers can share a single path and a single fill call.
 */
function appendChevron(
  path: Path2D,
  cx: number,
  cy: number,
  heading: number,
  scale: number,
): void {
  const radians = (heading * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const nose = NOSE_Y * scale;
  const wingX = WING_X * scale;
  const wingY = WING_Y * scale;
  const tail = TAIL_Y * scale;

  path.moveTo(cx - nose * sin, cy + nose * cos);
  path.lineTo(cx + wingX * cos - wingY * sin, cy + wingX * sin + wingY * cos);
  path.lineTo(cx - tail * sin, cy + tail * cos);
  path.lineTo(cx - wingX * cos - wingY * sin, cy - wingX * sin + wingY * cos);
  path.closePath();
}

/** The selected vehicle is drawn on its own, oversized and glowing, above the fleet. */
function drawSelectedVehicle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
): void {
  const path = new Path2D();
  appendChevron(path, x, y, heading, 1.7);

  ctx.save();
  ctx.fillStyle = SELECTED_COLOUR;
  ctx.fill(path);

  ctx.lineWidth = 1.4;
  ctx.strokeStyle = SELECTED_COLOUR;
  ctx.shadowColor = SELECTED_COLOUR;
  ctx.shadowBlur = 10;
  ctx.stroke(path);
  ctx.restore();
}
