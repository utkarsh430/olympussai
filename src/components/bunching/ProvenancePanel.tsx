import { OpsBadge, OpsPanel, OpsStack } from '@/components/ops/ui';
import type { ProvenanceSource, RehearsalResult } from '@/models/rehearsal';

/**
 * What in this run was measured, and what was invented.
 *
 * This panel is the reason the surface is allowed to exist. Everything else
 * on the page is a number produced by a model; without a field-by-field
 * account of which inputs came from the seeded network and which were made
 * up, the page is a demonstration wearing an operations console's clothes.
 *
 * It is a permanent panel, not a disclosure or a tooltip. A reader who has
 * to open something to find out that the passenger demand was invented will
 * not open it.
 */

const SOURCE_BADGE: Record<ProvenanceSource, { variant: 'live' | 'sim' | 'neutral'; text: string }> = {
  measured: { variant: 'live', text: 'Measured' },
  configured: { variant: 'neutral', text: 'Configured' },
  modelled: { variant: 'sim', text: 'Modelled' },
};

export function ProvenancePanel({ result }: { result: RehearsalResult }) {
  const modelledCount = result.provenance.filter((entry) => entry.source === 'modelled').length;

  return (
    <OpsStack>
      <OpsPanel
        title="What is real here"
        description={`${result.provenance.length - modelledCount} of ${result.provenance.length} inputs come from the seeded network; ${modelledCount} are invented by this simulator.`}
      >
        <ul className="divide-y divide-ops-line/60">
          {result.provenance.map((entry) => {
            const badge = SOURCE_BADGE[entry.source];
            return (
              <li key={entry.field} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ops-ink">{entry.field}</span>
                  <OpsBadge variant={badge.variant}>{badge.text}</OpsBadge>
                </div>
                <p className="mt-1 font-mono text-xs tabular-nums text-holo-glow">{entry.value}</p>
                <p className="mt-1 text-xs leading-relaxed text-ops-muted">{entry.note}</p>
              </li>
            );
          })}
        </ul>
      </OpsPanel>

      <OpsPanel
        title="What this does not rehearse"
        description="Named rather than left to be discovered, because a planner acting on this needs to know where it stops."
      >
        <ul className="space-y-3">
          {result.notRehearsed.map((item) => (
            <li key={item} className="text-xs leading-relaxed text-ops-muted">
              {item}
            </li>
          ))}
        </ul>
      </OpsPanel>
    </OpsStack>
  );
}
