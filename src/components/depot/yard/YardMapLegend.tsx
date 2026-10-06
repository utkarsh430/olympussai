import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import { BUS_STATE_COLOUR, YARD_STATE_ORDER } from '@/lib/depot/yard/yardModel';

const SWATCH_PX = 12;
const CENTRE = SWATCH_PX / 2;

function Dot({ colour, hollow }: { readonly colour: string; readonly hollow: boolean }) {
  return (
    <svg width={SWATCH_PX} height={SWATCH_PX} aria-hidden className="shrink-0">
      <circle
        cx={CENTRE}
        cy={CENTRE}
        r={hollow ? 4 : 3.5}
        fill={hollow ? 'none' : colour}
        stroke={hollow ? colour : '#02040a'}
        strokeWidth={hollow ? 1.5 : 1}
      />
    </svg>
  );
}

const MARK_COLOUR = '#c7d2e0';

/**
 * The map's one caption row: what is drawn (the model's caption, which reconciles
 * with the figures), the state colours by name, the two marker shapes and what the
 * circle is. Colour never carries a state alone: each swatch has its word.
 */
export function YardMapLegend({ caption }: { readonly caption: string }) {
  return (
    <div
      data-testid="yard-map-legend"
      className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-depot-muted"
    >
      <span className="min-w-0 text-depot-ink" data-testid="yard-map-note">
        {caption}
      </span>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Bus state colours">
        {YARD_STATE_ORDER.map((state) => (
          <li key={state} className="flex items-center gap-1">
            <Dot colour={BUS_STATE_COLOUR[state]} hollow={false} />
            <span>{BUS_STATE_LABEL[state]}</span>
          </li>
        ))}
      </ul>
      <span className="flex items-center gap-1">
        <Dot colour={MARK_COLOUR} hollow={false} /> this depot&apos;s
        <Dot colour={MARK_COLOUR} hollow /> visiting
      </span>
      <span>Circle: the yard inferred from where buses park, not surveyed.</span>
    </div>
  );
}
