import { formatCount } from '@/lib/depot/format';
import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import {
  BUS_STATE_COLOUR,
  DISPLAY_RADIUS_FACTOR,
  YARD_STATE_ORDER,
} from '@/lib/depot/yard/yardModel';

const SWATCH_PX = 14;
const CENTRE = SWATCH_PX / 2;

function Dot({ colour, hollow }: { readonly colour: string; readonly hollow: boolean }) {
  return (
    <svg width={SWATCH_PX} height={SWATCH_PX} aria-hidden className="shrink-0">
      <circle
        cx={CENTRE}
        cy={CENTRE}
        r={hollow ? 5 : 4}
        fill={hollow ? 'none' : colour}
        stroke={hollow ? colour : '#02040a'}
        strokeWidth={hollow ? 2 : 1}
      />
    </svg>
  );
}

/**
 * Says in words what every mark on the yard map means, with the mark beside the
 * words. States are listed by name, so colour is never the only carrier.
 */
export function YardMapLegend({
  visitorsDrawn,
  visitorsWithoutPosition,
}: {
  readonly visitorsDrawn: number;
  readonly visitorsWithoutPosition: number;
}) {
  return (
    <div
      data-testid="yard-map-legend"
      className="grid grid-cols-1 gap-x-8 gap-y-3 text-[11px] text-depot-muted md:grid-cols-2"
    >
      <div>
        <p className="depot-label mb-1.5">Bus state</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {YARD_STATE_ORDER.map((state) => (
            <li key={state} className="flex items-center gap-1.5">
              <Dot colour={BUS_STATE_COLOUR[state]} hollow={false} />
              <span>{BUS_STATE_LABEL[state]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 font-sans text-xs leading-snug">
          A filled dot is one of this depot&apos;s own buses. A ring with no fill is a bus from
          another depot standing here: {formatCount(visitorsDrawn)} drawn
          {visitorsWithoutPosition > 0
            ? `, ${formatCount(visitorsWithoutPosition)} with no position in the feed, listed below only`
            : ''}
          .
        </p>
      </div>
      <div>
        <p className="depot-label mb-1.5">Yard</p>
        <p className="font-sans text-xs leading-snug">
          The circle is inferred from where this depot&apos;s buses park. It is not a surveyed
          boundary. Buses further than {DISPLAY_RADIUS_FACTOR} radii from its centre are not drawn.
        </p>
      </div>
    </div>
  );
}
