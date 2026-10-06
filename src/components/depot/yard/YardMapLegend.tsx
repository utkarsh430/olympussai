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
 * The map's key, on a 90% surface chip inside the map's bottom-left from 640px (above the
 * basemap's own logo line); below that it sits under the map so it never hides the yard.
 * Every swatch has its word, so colour never carries a state alone.
 */
export function YardMapKey() {
  return (
    <div
      data-testid="yard-map-key"
      className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-depot-muted sm:absolute sm:bottom-8 sm:left-2 sm:z-10 sm:mt-0 sm:max-w-[calc(100%-1rem)] sm:rounded-[3px] sm:border sm:border-depot-line sm:bg-depot-surface/90 sm:px-2 sm:py-1"
    >
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

/** The one line under the map: what is drawn, in the model's words, which reconcile with the band. */
export function YardMapNote({ caption }: { readonly caption: string }) {
  return (
    <p className="depot-note mt-2 min-w-0" data-testid="yard-map-note">
      {caption}
    </p>
  );
}
