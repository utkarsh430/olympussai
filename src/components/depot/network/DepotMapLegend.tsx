import { formatCount } from '@/lib/depot/format';
import { INDEX_BANDS, UNRANKED_NODE, nodeRadius } from '@/lib/depot/map/nodeStyle';
import { MIN_FLEET_FOR_RANK } from '@/lib/depot/score/config';

const SIZE_SAMPLES = [1, 0.25, 0.04] as const;
const SWATCH_PX = 12;
/** Size samples use the middle band, so they read as ordinary filled nodes. */
const SAMPLE_FILL = INDEX_BANDS[2]?.fill ?? UNRANKED_NODE.stroke;

export interface DepotMapLegendProps {
  /** Fleet of the largest depot on the map; the largest circle stands for it. */
  readonly maxFleet: number;
}

function Circle({ radius, hollow, fill }: { radius: number; hollow: boolean; fill: string }) {
  const size = radius * 2 + 2;
  return (
    <svg width={size} height={size} aria-hidden className="shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill={hollow ? 'none' : fill}
        stroke={hollow ? UNRANKED_NODE.stroke : 'none'}
        strokeWidth={hollow ? 1.5 : 0}
      />
    </svg>
  );
}

/**
 * Says in words what a circle's size and colour mean, with the actual marks
 * beside the words. Sample sizes are computed by the same function the map uses.
 */
export function DepotMapLegend({ maxFleet }: DepotMapLegendProps) {
  const samples = SIZE_SAMPLES.map((share) => Math.round(maxFleet * share)).filter(
    (fleet, index, all) => fleet > 0 && all.indexOf(fleet) === index,
  );

  return (
    <div
      data-testid="depot-map-legend"
      className="grid grid-cols-1 gap-x-8 gap-y-3 border-t border-depot-line pt-3 text-[11px] text-depot-muted md:grid-cols-2 xl:grid-cols-1"
    >
      <div>
        <div className="depot-label mb-1">Size</div>
        <p className="depot-caption mb-1.5">
          Circle area grows with the unit&apos;s fleet.
        </p>
        <ul className="flex flex-wrap items-end gap-4">
          {samples.map((fleet) => (
            <li key={fleet} className="flex items-center gap-1.5">
              <Circle radius={nodeRadius(fleet, maxFleet)} hollow={false} fill={SAMPLE_FILL} />
              <span className="tabular-nums">{formatCount(fleet)} buses</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="depot-label mb-1">Colour</div>
        <p className="depot-caption mb-1.5">
          Depot Efficiency Index against depots of similar size: lighter is better.
        </p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
          {INDEX_BANDS.map((band) => (
            <li key={band.level} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block rounded-full"
                style={{ width: SWATCH_PX, height: SWATCH_PX, backgroundColor: band.fill }}
              />
              <span className="tabular-nums">{band.label.replace('Index ', '')}</span>
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <Circle radius={SWATCH_PX / 2 - 1} hollow fill="none" />
            <span>
              {UNRANKED_NODE.label}: fewer than {MIN_FLEET_FOR_RANK} buses, or not a depot
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
