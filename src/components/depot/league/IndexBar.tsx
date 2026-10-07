import type { CSSProperties } from 'react';
import { indexRampColour, toneChannels } from '@/lib/depot/palette';

const MIN_INDEX = 0;
const MAX_INDEX = 100;
const MEDIAN_TICK = 50;

/**
 * An index bar fill's style: its width and the index ramp's colour for the value, set as
 * `--depot-tone` so the shared fill draws its gradient and glow in it.
 */
export function indexFillStyle(value: number, widthPct: number): CSSProperties {
  return { width: `${widthPct}%`, '--depot-tone': toneChannels(indexRampColour(value)) } as CSSProperties;
}

/**
 * A thin bar on a 0 to 100 track with a tick at 50, the peer median. Purely a
 * visual aid: the numeral beside it carries the value, so it is hidden from
 * assistive tech.
 */
export function IndexBar({ value }: { readonly value: number }) {
  const width = Math.min(MAX_INDEX, Math.max(MIN_INDEX, value));
  return (
    <span aria-hidden className="depot-bar-track">
      <span className="depot-bar-fill" style={indexFillStyle(value, width)} />
      <span className="depot-bar-tick" style={{ left: `${MEDIAN_TICK}%` }} />
    </span>
  );
}
