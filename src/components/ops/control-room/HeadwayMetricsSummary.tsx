import type { HeadwayAggregate } from '@/models/control';
import { OpsGrid, OpsPanel, OpsStat } from '@/components/ops/ui';
import { METRIC } from '@/lib/ops/vocabulary';

function formatSeconds(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value)}s`;
}

/**
 * The four spacing figures for one corridor, at a glance.
 *
 * ─── THE LABELS ──────────────────────────────────────────────────────────
 *
 * These used to read `Target headway (H*)`, `Mean headway`, `Coefficient of
 * variation` and `Excess Wait Time`, with hints like "stddev / mean — lower is
 * more regular" and "Passenger-impact KPI". That is the vocabulary of the
 * transit-operations literature, and the readers are UPSRTC control-room staff.
 *
 * They now come from src/lib/ops/vocabulary.ts, which is also what the console
 * band uses, so the two surfaces cannot drift into two names for one number.
 * Two of the four keep their technical term deliberately: CV, because
 * "regularity %" would name a DIFFERENT statistic; and "extra" wait, because
 * dropping the word turns it into total passenger wait, which it is not.
 *
 * ─── THE DASH ────────────────────────────────────────────────────────────
 *
 * A null here is `—`, meaning the sweep ran and produced no value for this
 * figure — not `n/a`, which is reserved for a source that could not be read at
 * all. The page above owns that distinction: it only renders this card when
 * the snapshot actually carries an aggregate.
 */
export function HeadwayMetricsSummary({ aggregate }: { aggregate: HeadwayAggregate }) {
  const cards: { label: string; value: string; hint: string }[] = [
    {
      label: METRIC.targetHeadway.label,
      value: formatSeconds(aggregate.targetHeadwaySeconds),
      hint: METRIC.targetHeadway.hint,
    },
    {
      label: METRIC.meanHeadway.label,
      value: formatSeconds(aggregate.meanHeadwaySeconds),
      hint: `from ${aggregate.sampleCount} ${aggregate.sampleCount === 1 ? 'pair of buses' : 'pairs of buses'}`,
    },
    {
      label: METRIC.cv.label,
      value: aggregate.cv === null ? '—' : aggregate.cv.toFixed(2),
      hint: METRIC.cv.hint,
    },
    {
      label: METRIC.excessWait.label,
      value: formatSeconds(aggregate.ewtSeconds),
      hint: METRIC.excessWait.hint,
    },
  ];

  return (
    <OpsGrid columns={4}>
      {cards.map((card) => (
        <OpsPanel key={card.label} padded={false} className="px-3 py-3">
          <OpsStat label={card.label} value={card.value} />
          {/* Deliberately outside OpsStat's own `hint`, which truncates to keep
              a console tile's column width stable. Here there is room, and the
              reading key for CV is the whole reason an operator can use the
              number at all. */}
          <p className="mt-1 text-[11px] leading-snug text-subtle">{card.hint}</p>
        </OpsPanel>
      ))}
    </OpsGrid>
  );
}
