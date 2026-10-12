import { legendFor, type HeatMode, type HeatScale } from '@/lib/depot/redistribution/heatScale';

export interface HeatLegendProps {
  readonly mode: HeatMode;
  readonly scale: HeatScale;
  readonly bandLabel: string;
}

/** The heat map's legend in words for the view shown, then what the dimmed columns and the bright headers mean. */
export function HeatLegend({ mode, scale, bandLabel }: HeatLegendProps) {
  return (
    <ul className="depot-note mt-3 flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Heat map legend">
      {legendFor(mode, scale).map((step) => (
        <li key={step.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-4 shrink-0 rounded-[1px]" style={{ backgroundColor: step.colour }} />
          <span>{step.label}</span>
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3 w-4 shrink-0 rounded-[1px] border border-depot-line" />
        <span>No service</span>
      </li>
      <li className="text-depot-muted">{`Bright hour headers mark ${bandLabel}; other hours are dimmed. Click a cell to inspect it.`}</li>
    </ul>
  );
}
