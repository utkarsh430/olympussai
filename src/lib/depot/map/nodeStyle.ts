import { clamp } from '@/lib/depot/stats/robust';
/**
 * How a depot is drawn on the network map: size from fleet, colour from the
 * Depot Efficiency Index. Pure, so the map, its legend and the tests agree.
 */

/** Smallest node, so a three-bus depot is still a visible, hoverable mark. */
export const MIN_RADIUS_PX = 4;
/** Largest node, kept small enough that Lucknow's depots do not bury each other. */
export const MAX_RADIUS_PX = 18;

const INDEX_MIN = 0;
const INDEX_MAX = 100;

export interface IndexBand {
  /** 0 (lowest index) to 4 (highest). */
  readonly level: number;
  readonly min: number;
  readonly max: number;
  readonly fill: string;
  readonly label: string;
}

/**
 * Five ordered bands from one blue ramp, darkest for the lowest index. The
 * steps were checked as an ordinal ramp against the dark basemap (`#06080f`)
 * and the panel surface (`#070f1d`): single hue, monotone lightness, every
 * step at least 0.06 lighter than the last, and the darkest still 2.4:1 on
 * the map. Blue, not the cyan accent, because cyan marks the selected depot.
 */
const TOP_BAND: IndexBand = {
  level: 4,
  min: 80,
  max: 100,
  fill: '#b7d3f6',
  label: 'Index 80 to 100',
};

export const INDEX_BANDS: readonly IndexBand[] = [
  { level: 0, min: 0, max: 20, fill: '#184f95', label: 'Index 0 to under 20' },
  { level: 1, min: 20, max: 40, fill: '#256abf', label: 'Index 20 to under 40' },
  { level: 2, min: 40, max: 60, fill: '#3987e5', label: 'Index 40 to under 60' },
  { level: 3, min: 60, max: 80, fill: '#6da7ec', label: 'Index 60 to under 80' },
  TOP_BAND,
];

/** Depots that are not ranked are outlines only, in the tertiary ink. */
export const UNRANKED_NODE = {
  stroke: '#6b84a0',
  label: 'Not ranked',
} as const;

/** Thin dark ring between filled nodes so overlapping depots stay separable. */
const FILLED_STROKE = '#02040a';
const FILLED_STROKE_WEIGHT = 1;
const HOLLOW_STROKE_WEIGHT = 1.5;
const FILLED_OPACITY = 0.92;

/**
 * Radius in pixels. Proportional to the square root of fleet, so a node's
 * area tracks its fleet, with the largest depot at the maximum; anything that
 * would fall below the minimum is lifted to it.
 */
export function nodeRadius(fleet: number, maxFleet: number): number {
  if (!Number.isFinite(maxFleet) || maxFleet <= 0) return MIN_RADIUS_PX;
  if (Number.isNaN(fleet) || fleet <= 0) return MIN_RADIUS_PX;
  const share = Math.min(1, fleet / maxFleet);
  return clamp(MAX_RADIUS_PX * Math.sqrt(share), MIN_RADIUS_PX, MAX_RADIUS_PX);
}

/**
 * The band an index falls in. Each band includes its lower bound; 100 belongs
 * to the top band. Null when there is no usable index.
 */
export function indexBand(index: number | null): IndexBand | null {
  if (index === null || !Number.isFinite(index)) return null;
  const value = clamp(index, INDEX_MIN, INDEX_MAX);
  return INDEX_BANDS.find((band) => value < band.max) ?? TOP_BAND;
}

export interface NodeInput {
  readonly fleet: number;
  readonly index: number | null;
  readonly ranked: boolean;
}

export interface NodeStyle {
  readonly radius: number;
  readonly fill: string;
  readonly fillOpacity: number;
  readonly stroke: string;
  readonly strokeWeight: number;
  readonly hollow: boolean;
  /** Words for the colour, for hover text and the side panel. */
  readonly bandLabel: string;
}

export function nodeStyle(input: NodeInput, maxFleet: number): NodeStyle {
  const radius = nodeRadius(input.fleet, maxFleet);
  const band = input.ranked ? indexBand(input.index) : null;
  if (!band) {
    return {
      radius,
      fill: UNRANKED_NODE.stroke,
      fillOpacity: 0,
      stroke: UNRANKED_NODE.stroke,
      strokeWeight: HOLLOW_STROKE_WEIGHT,
      hollow: true,
      bandLabel: UNRANKED_NODE.label,
    };
  }
  return {
    radius,
    fill: band.fill,
    fillOpacity: FILLED_OPACITY,
    stroke: FILLED_STROKE,
    strokeWeight: FILLED_STROKE_WEIGHT,
    hollow: false,
    bandLabel: band.label,
  };
}
