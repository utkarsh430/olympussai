import { formatCount } from '@/lib/depot/format';
import type { FieldCoverage } from '@/lib/depot/types';

const PERCENT = 100;

function share(populated: number, of: number): number {
  return of === 0 ? 0 : (populated / of) * PERCENT;
}

/**
 * How many records populate each field, one labelled bar per field on a 0 to
 * 100% track. The exact count is always written beside the bar, so the bar is
 * only a visual aid.
 */
export function CoverageBars({ coverage }: { readonly coverage: readonly FieldCoverage[] }) {
  return (
    <ul className="flex flex-col gap-3" data-testid="depot-coverage-bars">
      {coverage.map((item) => {
        const percent = share(item.populated, item.of);
        return (
          <li key={item.field} className="grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr_auto] sm:items-center sm:gap-4">
            <span className="font-mono text-[13px] text-depot-ink">{item.label}</span>
            <span aria-hidden className="depot-bar-track">
              <span className="depot-bar-fill" style={{ width: `${percent}%` }} />
            </span>
            <span className="font-mono text-[13px] tabular-nums text-depot-muted">
              {`${formatCount(item.populated)} of ${formatCount(item.of)} buses (${Math.round(percent)}%)`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
