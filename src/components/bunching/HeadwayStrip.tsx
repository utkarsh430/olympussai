'use client';

import { BUS_COLORS, TARGET_HEADWAY_MINUTES } from '@/lib/bunching/config';
import { BUS_IDS, type HeadwayVector } from '@/lib/bunching/types';

/** Minutes of corridor shown across the full strip width. */
const SCALE_MINUTES = 36;

/**
 * Spacing strip: the headway vector drawn as distance rather than read as
 * numbers, so a bunch is visible at a glance and a recovery sequence can be
 * stacked iteration by iteration.
 *
 * The scale is deliberately fixed rather than normalised per row — that is what
 * makes rows from different iterations comparable — and the dashed ticks mark
 * where each bus would sit at a perfect ten-minute headway.
 *
 * Built from positioned elements rather than SVG: the strip has to stretch to
 * whatever width its column gives it, and a non-uniformly scaled SVG would
 * distort the bus badges and their letters.
 */
export function HeadwayStrip({
  headways,
  caption,
  dim,
}: {
  headways: HeadwayVector;
  caption?: string;
  dim?: boolean;
}) {
  // The lead bus anchors the right-hand edge; every follower is placed by the
  // cumulative headway in front of it.
  const cumulative = [
    0,
    headways[0],
    headways[0] + headways[1],
    headways[0] + headways[1] + headways[2],
  ] as const;

  /** Minutes behind the lead bus → percentage across the track. */
  const xFor = (minutes: number): number =>
    Math.max(3, Math.min(97, 96 - (minutes / SCALE_MINUTES) * 92));

  return (
    <div className="flex items-center gap-2">
      {caption && (
        <span className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-holo-glow/40">
          {caption}
        </span>
      )}

      <div
        className="relative h-7 min-w-0 flex-1"
        role="img"
        aria-label={`Bus spacing: ${headways
          .map((value, index) => `${BUS_IDS[index]} to ${BUS_IDS[index + 1]} ${value.toFixed(1)} minutes`)
          .join(', ')}`}
      >
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            aria-hidden
            className="absolute top-1 h-5 border-l border-dashed border-holo-glow/15"
            style={{ left: `${xFor(step * TARGET_HEADWAY_MINUTES)}%` }}
          />
        ))}

        <span
          aria-hidden
          className="absolute top-1/2 h-px -translate-y-1/2 bg-holo-glow/25"
          style={{ left: `${xFor(cumulative[3])}%`, right: '4%' }}
        />

        {BUS_IDS.map((bus, index) => (
          <span
            key={bus}
            className="absolute top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border font-mono text-[9px] font-bold"
            style={{
              left: `${xFor(cumulative[index] ?? 0)}%`,
              color: BUS_COLORS[bus],
              borderColor: `${BUS_COLORS[bus]}80`,
              backgroundColor: dim ? 'rgba(2,4,10,0.9)' : `${BUS_COLORS[bus]}26`,
              opacity: dim ? 0.55 : 1,
              // A leads: it must sit above followers when they overlap.
              zIndex: 10 - index,
            }}
          >
            {bus}
          </span>
        ))}
      </div>
    </div>
  );
}
