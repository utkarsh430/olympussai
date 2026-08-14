import {
  OpsAlert,
  OpsPanel,
  OpsStack,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsTdNumericClass,
  opsTheadRowClass,
  opsThClass,
  opsTrClass,
} from '@/components/ops/ui';
import { compareArms, verdict, VERDICT_SENTENCE, type ComparedMetric } from '@/lib/rehearsal/comparison';
import type { RehearsalResult } from '@/models/rehearsal';

/**
 * The two arms, side by side.
 *
 * Both were run over the SAME corridor, the same modelled conditions and the
 * same seed; the only difference is whether the deployed control laws were
 * allowed to act. That is what makes the delta column mean anything, and it
 * is why the two arms are produced by one request rather than by two runs an
 * operator triggers separately.
 */

function formatMetric(value: number | null, format: ComparedMetric['format']): string {
  if (value === null) return '—';
  switch (format) {
    case 'minutes':
      return `${Math.round(value / 60)} min`;
    case 'seconds':
      return `${Math.round(value)} s`;
    case 'ratio':
      return value.toFixed(3);
    case 'percent':
      return `${Math.round(value * 100)}%`;
    case 'count':
    default:
      return Math.round(value).toLocaleString('en-IN');
  }
}

function formatDelta(metric: ComparedMetric): string {
  if (metric.delta === null) return '—';
  if (metric.delta === 0) return 'no change';
  const sign = metric.delta > 0 ? '+' : '−';
  return `${sign}${formatMetric(Math.abs(metric.delta), metric.format)}`;
}

export function ComparisonPanel({ result }: { result: RehearsalResult }) {
  const metrics = compareArms(result);
  const outcome = verdict(metrics);

  return (
    <OpsStack>
      <OpsAlert tone={outcome === 'improved' ? 'success' : outcome === 'worse' ? 'warning' : 'info'}>
        {VERDICT_SENTENCE[outcome]} It is a result about a model, not a measurement of the service.
      </OpsAlert>

      <OpsPanel
        title="With the control laws, and without"
        description="Both arms ran the same corridor, the same modelled conditions and the same seed. The only difference is whether the deployed control laws were allowed to act."
        padded={false}
      >
        <OpsTableFrame className="rounded-none border-0">
          <table className={opsTableClass}>
            <caption className="sr-only">
              Rehearsal outcome with and without control, by measure
            </caption>
            <thead>
              <tr className={opsTheadRowClass}>
                <th scope="col" className={opsThClass}>
                  Measure
                </th>
                <th scope="col" className={opsThClass}>
                  No control
                </th>
                <th scope="col" className={opsThClass}>
                  Control laws acting
                </th>
                <th scope="col" className={opsThClass}>
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.key} className={opsTrClass}>
                  <th scope="row" className={`${opsTdClass} font-normal`}>
                    <span className="block text-ops-ink">{metric.label}</span>
                    <span className="mt-0.5 block max-w-prose text-xs leading-relaxed text-ops-faint">
                      {metric.meaning}
                    </span>
                  </th>
                  <td className={opsTdNumericClass}>{formatMetric(metric.uncontrolled, metric.format)}</td>
                  <td className={opsTdNumericClass}>{formatMetric(metric.controlled, metric.format)}</td>
                  <td
                    className={
                      metric.improved === true
                        ? `${opsTdNumericClass} text-alert-green`
                        : metric.improved === false
                          ? `${opsTdNumericClass} text-alert-amber`
                          : opsTdMutedClass
                    }
                  >
                    {formatDelta(metric)}
                    {metric.improved !== null ? (
                      <span className="ml-2 text-[11px] uppercase tracking-wider">
                        {metric.improved ? 'better' : 'worse'}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </OpsTableFrame>
      </OpsPanel>
    </OpsStack>
  );
}
