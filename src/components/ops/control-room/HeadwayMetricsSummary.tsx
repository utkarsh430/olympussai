import type { HeadwayAggregate } from '@/models/control';

function formatSeconds(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value)}s`;
}

/**
 * Route-direction-wide headway/EWT/CV summary (AC: "Time-domain fwd/bwd
 * headways, CV, EWT computed per route-direction"). Individual leader/
 * follower forward/backward headways are shown per-pair in the incidents'
 * evidence and are also what feeds this aggregate — this card is the
 * at-a-glance regularity read a control-room operator scans first.
 */
export function HeadwayMetricsSummary({ aggregate }: { aggregate: HeadwayAggregate }) {
  const cards: { label: string; value: string; hint: string }[] = [
    { label: 'Target headway (H*)', value: formatSeconds(aggregate.targetHeadwaySeconds), hint: 'Configured/policy value' },
    { label: 'Mean headway', value: formatSeconds(aggregate.meanHeadwaySeconds), hint: `${aggregate.sampleCount} pair sample(s)` },
    {
      label: 'Coefficient of variation',
      value: aggregate.cv === null ? '—' : aggregate.cv.toFixed(2),
      hint: 'stddev / mean — lower is more regular',
    },
    { label: 'Excess Wait Time', value: formatSeconds(aggregate.ewtSeconds), hint: 'Passenger-impact KPI' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-md border border-[rgba(255,255,255,0.08)] px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#6f7684]">{card.label}</p>
          <p className="mt-1 text-lg font-semibold text-[#e6e9ef]">{card.value}</p>
          <p className="mt-0.5 text-[11px] text-[#6f7684]">{card.hint}</p>
        </div>
      ))}
    </div>
  );
}
