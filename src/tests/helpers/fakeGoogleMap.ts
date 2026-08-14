/**
 * A minimum viable Google Maps + canvas stand-in, enough to drive
 * src/components/map/fleetCanvasLayer.ts's real `draw()` in a test process.
 *
 * The renderer is the one piece of this app whose cost scales with the fleet
 * (~9,170 vehicles), and it was previously untested because it needs a
 * basemap, a projection and a 2D context. None of those need to be real to
 * exercise the part that costs: the Mercator projection maths, the viewport
 * cull, and the per-colour Path2D batching. Those run identically here.
 *
 * WHAT THIS DELIBERATELY DOES NOT MEASURE: rasterisation. The recording
 * context counts `fill`/`stroke` calls instead of shading pixels, so a timing
 * taken through this harness is the JavaScript half of a frame and must be
 * reported as such. The GPU half is measured in a real browser - see the
 * measurement note in fleetCanvasLayer.test.ts.
 */

/** Google's world is 256px square at zoom 0. */
const TILE_SIZE = 256;

export interface RecordedPath {
  moveTo: number;
  lineTo: number;
  arc: number;
  closePath: number;
}

/**
 * Stands in for Path2D both ways the layer builds one: from an SVG path string
 * (the fleet batches, one string per colour) and from imperative calls (the
 * overlay batches, which are dozens of marks and not worth stringifying).
 *
 * `subpaths` counts what was actually drawn either way, so a test can assert
 * "9,170 chevrons went into three fills" without caring which construction
 * route produced them.
 */
export class FakePath2D {
  readonly ops: RecordedPath = { moveTo: 0, lineTo: 0, arc: 0, closePath: 0 };
  readonly svg: string;

  constructor(svg?: string) {
    this.svg = svg ?? '';
    if (svg !== undefined) {
      this.ops.moveTo = (svg.match(/M/g) ?? []).length;
      this.ops.lineTo = (svg.match(/L/g) ?? []).length;
      this.ops.closePath = (svg.match(/Z/g) ?? []).length;
    }
  }

  /** Number of distinct shapes in this path, however it was built. */
  get subpaths(): number {
    return this.ops.moveTo;
  }

  moveTo(): void {
    this.ops.moveTo += 1;
  }
  lineTo(): void {
    this.ops.lineTo += 1;
  }
  arc(): void {
    this.ops.arc += 1;
  }
  closePath(): void {
    this.ops.closePath += 1;
  }
}

export interface RecordingContext {
  fills: { colour: string; path: FakePath2D | null; alpha: number }[];
  strokes: { colour: string; path: FakePath2D | null; dash: number[] }[];
  texts: { text: string; x: number; y: number; colour: string }[];
  clears: number;
}

function createRecordingContext(): CanvasRenderingContext2D & { recorded: RecordingContext } {
  const recorded: RecordingContext = { fills: [], strokes: [], texts: [], clears: 0 };
  const stack: { fillStyle: string; strokeStyle: string; globalAlpha: number; lineDash: number[] }[] = [];
  const ctx = {
    recorded,
    fillStyle: '#000',
    strokeStyle: '#000',
    globalAlpha: 1,
    lineWidth: 1,
    lineJoin: 'miter',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    lineDash: [] as number[],
    setTransform() {},
    clearRect() {
      recorded.clears += 1;
    },
    setLineDash(dash: number[]) {
      ctx.lineDash = dash;
    },
    fill(path?: FakePath2D) {
      recorded.fills.push({ colour: String(ctx.fillStyle), path: path ?? null, alpha: ctx.globalAlpha });
    },
    stroke(path?: FakePath2D) {
      recorded.strokes.push({ colour: String(ctx.strokeStyle), path: path ?? null, dash: [...ctx.lineDash] });
    },
    fillText(text: string, x: number, y: number) {
      recorded.texts.push({ text, x, y, colour: String(ctx.fillStyle) });
    },
    save() {
      stack.push({
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
        globalAlpha: ctx.globalAlpha,
        lineDash: [...ctx.lineDash],
      });
    },
    restore() {
      const previous = stack.pop();
      if (!previous) return;
      ctx.fillStyle = previous.fillStyle;
      ctx.strokeStyle = previous.strokeStyle;
      ctx.globalAlpha = previous.globalAlpha;
      ctx.lineDash = previous.lineDash;
    },
  };
  return ctx as unknown as CanvasRenderingContext2D & { recorded: RecordingContext };
}

export interface FakeMapHarness {
  map: google.maps.Map;
  /** Run every queued animation frame callback. Returns how many ran. */
  flushFrames(): number;
  /** The recording 2D context the layer painted into. Available after the first frame. */
  context(): RecordingContext;
  /** Fire one of the map events the layer subscribes to. */
  emit(event: string): void;
  restore(): void;
}

/**
 * Installs the fakes on globalThis and returns a harness.
 *
 * `zoom` and the viewport determine what is culled: the defaults put the whole
 * of Uttar Pradesh on screen, which is the worst case for the renderer because
 * nothing is culled at all.
 */
export function installFakeGoogleMaps(
  options: { zoom?: number; width?: number; height?: number; northEastLat?: number; southWestLng?: number } = {},
): FakeMapHarness {
  const { zoom = 7, width = 1400, height = 900, northEastLat = 31.2, southWestLng = 76.4 } = options;

  const previousGoogle = (globalThis as { google?: unknown }).google;
  const previousPath2D = (globalThis as { Path2D?: unknown }).Path2D;
  const previousRaf = globalThis.requestAnimationFrame;
  const previousGetContext = HTMLCanvasElement.prototype.getContext;

  const ctx = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;

  (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;

  const frames: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  }) as typeof globalThis.requestAnimationFrame;

  const listeners = new Map<string, (() => void)[]>();
  const div = document.createElement('div');
  Object.defineProperty(div, 'clientWidth', { value: width });
  Object.defineProperty(div, 'clientHeight', { value: height });

  const pane = { appendChild: () => {} };

  class FakeOverlayView {
    private attachedMap: unknown = null;
    setMap(map: unknown) {
      this.attachedMap = map;
      if (map === null) {
        (this as unknown as { onRemove?: () => void }).onRemove?.();
        return;
      }
      (this as unknown as { onAdd?: () => void }).onAdd?.();
    }
    getMap() {
      return this.attachedMap;
    }
    getPanes() {
      return { overlayLayer: pane };
    }
    getProjection() {
      return projection;
    }
  }

  const projection = {
    fromLatLngToDivPixel: () => ({ x: 0, y: 0 }),
    fromLatLngToContainerPixel: () => ({ x: 0, y: 0 }),
    getWorldWidth: () => TILE_SIZE * 2 ** zoom,
  };

  const bounds = {
    getNorthEast: () => ({ lat: () => northEastLat, lng: () => 0 }),
    getSouthWest: () => ({ lat: () => 0, lng: () => southWestLng }),
  };

  const map = {
    getDiv: () => div,
    getBounds: () => bounds,
    getZoom: () => zoom,
    setZoom: () => {},
    panTo: () => {},
    setOptions: () => {},
    fitBounds: () => {},
    addListener: (event: string, handler: () => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(handler);
      listeners.set(event, existing);
      return {
        remove: () => listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== handler)),
      };
    },
  } as unknown as google.maps.Map;

  (globalThis as { google?: unknown }).google = {
    maps: {
      OverlayView: FakeOverlayView,
      LatLng: class {
        constructor(
          readonly latitude: number,
          readonly longitude: number,
        ) {}
      },
      event: { addListenerOnce: () => ({ remove: () => {} }) },
    },
  };

  return {
    map,
    flushFrames() {
      const pending = frames.splice(0, frames.length);
      for (const frame of pending) frame(0);
      return pending.length;
    },
    context: () => ctx.recorded,
    emit(event: string) {
      for (const handler of listeners.get(event) ?? []) handler();
    },
    restore() {
      (globalThis as { google?: unknown }).google = previousGoogle;
      (globalThis as { Path2D?: unknown }).Path2D = previousPath2D;
      globalThis.requestAnimationFrame = previousRaf;
      HTMLCanvasElement.prototype.getContext = previousGetContext;
    },
  };
}
