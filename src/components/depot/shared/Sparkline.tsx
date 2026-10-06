import { sparklineGeometry } from '@/lib/depot/forecast/sparklineModel';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';

export const SPARKLINE_WIDTH = 96;
export const SPARKLINE_HEIGHT = 24;
const LIVE_RADIUS = 4;

export interface SparklineProps {
  /** Daily values, oldest first; the last is the live value. */
  readonly values: readonly number[];
  /** Text equivalent; build it with `sparklineLabel` from the trend summary. */
  readonly label: string;
  /**
   * Shows the MODELLED tag beside the line. Turn it off only where the
   * enclosing column header or heading already says MODELLED.
   */
  readonly tagged?: boolean;
  readonly width?: number;
  readonly height?: number;
}

/**
 * A decorative trend summary: plain SVG with no axes, no hooks and nothing
 * interactive, cheap enough for a 143-row table. Modelled history is drawn
 * in the quiet tone and the live value as a distinct accent dot at the end.
 * Fewer than two finite values render a placeholder dash, never an error.
 */
export function Sparkline({
  values,
  label,
  tagged = true,
  width = SPARKLINE_WIDTH,
  height = SPARKLINE_HEIGHT,
}: SparklineProps) {
  const geometry = sparklineGeometry(values, width, height);
  const mark =
    geometry.kind === 'empty' ? (
      <span
        data-testid="sparkline-placeholder"
        role="img"
        aria-label={label}
        className="inline-block text-center font-mono text-[11px] text-depot-faint"
        style={{ width, lineHeight: `${height}px` }}
      >
        —
      </span>
    ) : (
      <svg
        role="img"
        aria-label={label}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="inline-block shrink-0"
      >
        <path
          data-mark="history"
          d={geometry.path}
          fill="none"
          className="stroke-depot-muted"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          data-mark="live"
          cx={geometry.live.x}
          cy={geometry.live.y}
          r={LIVE_RADIUS}
          className="fill-holo-glow stroke-depot-page"
          strokeWidth={1}
        />
      </svg>
    );
  if (!tagged) return mark;
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {mark}
      <ProvenanceBadge provenance="modelled" />
    </span>
  );
}
