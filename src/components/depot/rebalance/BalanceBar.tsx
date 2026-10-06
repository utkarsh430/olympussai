import { MINUS } from '@/lib/depot/format';
import { DEPOT_PALETTE } from '@/lib/depot/palette';

/** Diverging pair in the command centre's colours: cyan surplus, crimson deficit. */
export const SURPLUS_COLOUR = DEPOT_PALETTE.bright;
export const DEFICIT_COLOUR = DEPOT_PALETTE.crimson;
/** Neutral midpoint: a balanced depot is slate, never a hue. */
export const BALANCED_COLOUR = DEPOT_PALETTE.slate;

const HALF = 50;

export interface BalanceBarProps {
  readonly balance: number;
  /** Largest absolute balance among the rows, so every bar shares one scale. */
  readonly maxMagnitude: number;
}

export function describeBalance(balance: number): string {
  if (balance < 0) return `${MINUS}${Math.abs(balance)} short`;
  if (balance > 0) return `+${balance} spare`;
  return '0 balanced';
}

/**
 * One depot's balance as a bar diverging from a centre line: deficit to the
 * left in red, surplus to the right in blue. The figure is always written
 * beside the bar, so the colour never carries the meaning alone.
 */
export function BalanceBar({ balance, maxMagnitude }: BalanceBarProps) {
  const share = maxMagnitude > 0 ? Math.min(1, Math.abs(balance) / maxMagnitude) : 0;
  const width = `${share * HALF}%`;
  const fill =
    balance < 0
      ? { right: `${HALF}%`, width, backgroundColor: DEFICIT_COLOUR }
      : { left: `${HALF}%`, width, backgroundColor: SURPLUS_COLOUR };

  return (
    <div className="flex min-w-[160px] items-center gap-3">
      <div aria-hidden className="depot-bar-track">
        {balance !== 0 ? <div className="absolute inset-y-0 rounded-[2px]" style={fill} /> : null}
        <div className="depot-bar-tick" style={{ left: `${HALF}%` }} />
      </div>
      <span className="w-[84px] shrink-0 whitespace-nowrap text-right tabular-nums">
        {describeBalance(balance)}
      </span>
    </div>
  );
}
