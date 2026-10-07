import { HEAT_STEPS, type HeatTone } from '@/lib/depot/service/networkPageModel';
import { heatFill } from './heatStyle';

const STEP_WORDS = HEAT_STEPS.map((s, i) => {
  const next = HEAT_STEPS[i + 1];
  if (next === undefined) return `${s} or more`;
  return next - 1 === s ? `${s}` : `${s}–${next - 1}`;
});

function Swatch({ tone, step, measured }: { tone: HeatTone; step: number; measured: boolean }) {
  return (
    <span aria-hidden className="inline-block h-3 w-4 shrink-0" style={heatFill({ tone, step, measured })} />
  );
}

/** The heat map's legend in words: each side and strength, then solid against hatched. */
export function NetworkHeatLegend() {
  return (
    <ul className="depot-note mt-3 flex flex-wrap gap-x-5 gap-y-1" aria-label="Heat map legend">
      {(['short', 'over'] as const).map((tone) => (
        <li key={tone} className="flex flex-wrap items-center gap-1.5">
          <span>{tone === 'short' ? 'Short by' : 'Over by'}</span>
          {STEP_WORDS.map((words, i) => (
            <span key={words} className="flex items-center gap-1">
              <Swatch tone={tone} step={i + 1} measured />
              <span>{words}</span>
            </span>
          ))}
          <span>buses</span>
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <Swatch tone="even" step={0} measured />
        <span>Even</span>
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch tone="short" step={2} measured />
        <span>Solid: observed, or now from the feed</span>
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch tone="short" step={2} measured={false} />
        <span>Hatched: modelled day, so the gap is modelled</span>
      </li>
    </ul>
  );
}
