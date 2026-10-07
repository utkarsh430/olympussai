import type { CSSProperties } from 'react';
import { DEPOT_PALETTE, meaningColour } from '@/lib/depot/palette';
import type { HeatCell, HeatTone } from '@/lib/depot/service/networkPageModel';

/**
 * The heat map's fills, diverging from an empty (even) midpoint: short in the "worse"
 * crimson, over in the "standing" amber, as the route day's gap row colours them, each in
 * three strengths by size. A measured hour is a solid wash; a modelled hour is the same
 * colour as thin diagonal strokes, as the route day hatches its modelled bars.
 */
const TONE_COLOUR: Readonly<Record<Exclude<HeatTone, 'even'>, string>> = {
  short: meaningColour('worse'),
  over: meaningColour('standing'),
};

/** Wash strength per step; step 0 (even) has none. */
const STEP_ALPHA = [0, 0.3, 0.55, 0.85] as const;
const HEX_PAIR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

function rgba(hex: string, alpha: number): string {
  const m = HEX_PAIR.exec(hex);
  if (m === null) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x as string, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The inline fill of one cell (a value per cell, which a class cannot carry). */
export function heatFill(cell: Pick<HeatCell, 'tone' | 'step' | 'measured'>): CSSProperties {
  if (cell.tone === 'even') return { boxShadow: `inset 0 0 0 1px ${DEPOT_PALETTE.line}` };
  const colour = rgba(TONE_COLOUR[cell.tone], STEP_ALPHA[cell.step] ?? STEP_ALPHA[3]);
  if (cell.measured) return { backgroundColor: colour };
  return {
    backgroundImage: `repeating-linear-gradient(135deg, ${colour} 0 2px, transparent 2px 5px)`,
    boxShadow: `inset 0 0 0 1px ${rgba(TONE_COLOUR[cell.tone], STEP_ALPHA[1])}`,
  };
}
