import { MAX_ARC_PX, arcWidthPx } from '@/lib/depot/rebalance/mapGeometry';
import { BALANCED_COLOUR, DEFICIT_COLOUR, SURPLUS_COLOUR } from './BalanceBar';
import { DEPOT_PALETTE } from '@/lib/depot/palette';

/** Same arc colour the map draws with. */
export const ARC_COLOUR = DEPOT_PALETTE.label;

const SAMPLE_SHARES = [1, 0.25, 0.04] as const;
const SAMPLE_LENGTH_PX = 36;
const MARK_PX = 14;

export interface TransferMapLegendProps {
  /** Buses on the largest transfer; the widest arc stands for it. */
  readonly maxBuses: number;
}

function Mark({ shape }: { readonly shape: 'square' | 'triangle' | 'circle' }) {
  const c = MARK_PX / 2;
  return (
    <svg width={MARK_PX} height={MARK_PX} aria-hidden className="shrink-0">
      {shape === 'square' ? (
        <rect x={2} y={2} width={MARK_PX - 4} height={MARK_PX - 4} fill={SURPLUS_COLOUR} />
      ) : null}
      {shape === 'triangle' ? (
        <polygon points={`1,2 ${MARK_PX - 1},2 ${c},${MARK_PX - 1}`} fill={DEFICIT_COLOUR} />
      ) : null}
      {shape === 'circle' ? <circle cx={c} cy={c} r={c - 3} fill={BALANCED_COLOUR} /> : null}
    </svg>
  );
}

/**
 * What the map's shapes, colours and line widths mean: the marks and line samples beside
 * their labels, nothing more. No "· modelled" per item (the section label carries the tag)
 * and no paragraph (how a line's width is drawn is said in the closing disclosure). Shape
 * and colour both carry surplus and deficit.
 */
export function TransferMapLegend({ maxBuses }: TransferMapLegendProps) {
  const samples = SAMPLE_SHARES.map((share) => Math.max(1, Math.round(maxBuses * share))).filter(
    (buses, index, all) => maxBuses > 0 && all.indexOf(buses) === index,
  );

  return (
    <div
      data-testid="rebalance-map-legend"
      className="grid grid-cols-1 gap-x-8 gap-y-3 text-[11px] text-depot-muted md:grid-cols-2"
    >
      <div>
        <div className="depot-label mb-1.5">Depots</div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          <li className="flex items-center gap-1.5">
            <Mark shape="square" />
            Surplus buses
          </li>
          <li className="flex items-center gap-1.5">
            <Mark shape="triangle" />
            Short of buses
          </li>
          <li className="flex items-center gap-1.5">
            <Mark shape="circle" />
            Balanced
          </li>
        </ul>
      </div>
      <div>
        <div className="depot-label mb-1.5">Transfers, arrow at the receiver</div>
        <ul className="flex flex-wrap items-center gap-4">
          {samples.map((buses) => (
            <li key={buses} className="flex items-center gap-1.5">
              <svg width={SAMPLE_LENGTH_PX} height={MAX_ARC_PX} aria-hidden>
                <line
                  x1={0}
                  x2={SAMPLE_LENGTH_PX}
                  y1={MAX_ARC_PX / 2}
                  y2={MAX_ARC_PX / 2}
                  stroke={ARC_COLOUR}
                  strokeWidth={arcWidthPx(buses, maxBuses)}
                />
              </svg>
              <span className="tabular-nums">{buses === 1 ? '1 bus' : `${buses} buses`}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
