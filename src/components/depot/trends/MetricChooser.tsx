'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { metricInfo } from '@/lib/depot/forecast/wording';
import { metricOptions, trendsHref } from '@/lib/depot/forecast/trendsPageModel';
import type { MetricKey } from '@/lib/depot/sim/types';

const SELECTED =
  'aria-[current=page]:border-holo-glow/60 aria-[current=page]:bg-depot-selected ' +
  'aria-[current=page]:text-holo-glow';

export interface MetricChooserProps {
  readonly path: string;
  readonly metric: MetricKey;
}

/**
 * One link per history metric, a row that wraps. The choice lives in the URL, so each
 * view can be linked and the back button walks through the measures read; links, not
 * buttons, because choosing one is navigation. The pressed link keeps focus (the row
 * stays mounted), and a polite status says which measure is now shown, but only after
 * the first change, so arriving on the page announces nothing extra.
 */
export function MetricChooser({ path, metric }: MetricChooserProps) {
  const first = useRef(metric);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (metric !== first.current) setAnnounce(`Showing ${metricInfo(metric).label}`);
  }, [metric]);
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
      <p role="status" className="sr-only" data-testid="trends-metric-status">
        {announce}
      </p>
    </nav>
  );
}
