import Link from 'next/link';
import { metricOptions, trendsHref } from '@/lib/depot/forecast/trendsPageModel';
import type { MetricKey } from '@/lib/depot/sim/types';

const SELECTED =
  'aria-[current=page]:border-holo-glow/60 aria-[current=page]:bg-depot-raised ' +
  'aria-[current=page]:text-holo-glow';

export interface MetricChooserProps {
  readonly path: string;
  readonly metric: MetricKey;
}

/**
 * One link per history metric. The choice lives in the URL, so each view can
 * be linked and the back button walks through the measures read; links,
 * not buttons, because choosing one is navigation.
 */
export function MetricChooser({ path, metric }: MetricChooserProps) {
  return (
    <nav aria-label="Choose a measure" data-testid="trends-metric-chooser">
      <ul className="flex flex-wrap gap-2">
        {metricOptions().map((option) => (
          <li key={option.key}>
            <Link
              href={trendsHref(path, option.key)}
              scroll={false}
              aria-current={option.key === metric ? 'page' : undefined}
              className={`depot-filter-button inline-block ${SELECTED}`}
            >
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
