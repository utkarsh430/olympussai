'use client';

import { MIN_SAFE_HEADWAY_MINUTES, TARGET_HEADWAY_MINUTES } from '@/lib/bunching/config';
import type { SimulationIteration } from '@/lib/bunching/types';
import { MetricTile, type Tone } from './primitives';

/**
 * The live metric block for one policy. Every figure is read straight off the
 * iteration's computed metrics — nothing is calculated in this component.
 */
export function HeadwayMetrics({ iteration }: { iteration: SimulationIteration }) {
  const { metrics, recoveryProgress } = iteration;

  const errorTone: Tone =
    metrics.mae <= 0.6 ? 'green' : metrics.mae <= 2 ? 'amber' : 'crimson';
  const regularityTone: Tone =
    metrics.regularity >= 94 ? 'green' : metrics.regularity >= 75 ? 'amber' : 'crimson';
  const minTone: Tone =
    metrics.minHeadway >= 8.5
      ? 'green'
      : metrics.minHeadway > MIN_SAFE_HEADWAY_MINUTES
        ? 'amber'
        : 'crimson';

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      <MetricTile
        label="Mean Headway Error"
        value={metrics.mae.toFixed(2)}
        unit="min"
        tone={errorTone}
        hint={`Mean absolute deviation of the three headways from the ${TARGET_HEADWAY_MINUTES.toFixed(1)}-minute demo target.`}
      />
      <MetricTile
        label="Headway Regularity"
        value={metrics.regularity.toFixed(1)}
        unit="%"
        tone={regularityTone}
        hint={`Demo score based on deviation from the ${TARGET_HEADWAY_MINUTES}-minute target headway. Not an official UPSRTC KPI.`}
      />
      <MetricTile
        label="Headway Variance"
        value={metrics.variance.toFixed(2)}
        unit="min²"
        tone={metrics.variance <= 1 ? 'green' : metrics.variance <= 8 ? 'amber' : 'crimson'}
        hint="Variance of the three headways. Lower means more even spacing along the corridor."
      />
      <MetricTile
        label="Passenger Wait Proxy"
        value={metrics.waitProxy.toFixed(2)}
        unit="min"
        tone={metrics.waitProxy <= 5.2 ? 'green' : metrics.waitProxy <= 7 ? 'amber' : 'crimson'}
        hint="Illustrative waiting-time proxy derived from service headway irregularity: sum of squared headways divided by twice their total."
      />
      <MetricTile
        label="Minimum Headway"
        value={metrics.minHeadway.toFixed(1)}
        unit="min"
        tone={minTone}
        hint={`The closest pair of buses on the corridor. Below ${MIN_SAFE_HEADWAY_MINUTES.toFixed(1)} minutes the services are effectively running together.`}
      />
      {recoveryProgress === null ? (
        <MetricTile
          label="Recovery Progress"
          value="—"
          tone="crimson"
          footnote="No control applied"
          hint="No intervention is applied on this side, so no recovery towards target headway is expected."
        />
      ) : (
        <MetricTile
          label="Recovery Progress"
          value={recoveryProgress.toFixed(0)}
          unit="%"
          tone={recoveryProgress >= 80 ? 'green' : recoveryProgress >= 40 ? 'teal' : 'amber'}
          hint="Share of the initial disturbance's headway error that has been removed. Progress towards stable target headway, not an official transport KPI."
        />
      )}
    </div>
  );
}
