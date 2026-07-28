'use client';

import { AI_PIPELINE_STAGES } from '@/lib/bunching/config';
import type { ScenarioDefinition } from '@/lib/bunching/types';

/**
 * The written half of the demonstration (Section 48): what happened, why it
 * amplifies, and what the controller does differently — plus the decision
 * pipeline the controlled side runs on every iteration.
 */
export function ScenarioExplanation({ scenario }: { scenario: ScenarioDefinition }) {
  return (
    <section className="space-y-3" aria-label="Scenario explanation">
      <div className="grid gap-3 lg:grid-cols-3">
        <Block title="What happened?" body={scenario.narrative.whatHappened} />
        <Block title="Why does bunching amplify?" body={scenario.narrative.whyAmplifies} />
        <Block
          title="What does the AI do differently?"
          body={scenario.narrative.whatAiDoes}
          accent
        />
      </div>

      <div className="rounded-lg border border-holo-glow/20 bg-void-900/60 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-holo-glow">
            Decision pipeline
          </h3>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-holo-glow/40">
            Repeated every control cycle
          </span>
        </div>
        <ol className="flex flex-wrap items-center gap-1.5">
          {AI_PIPELINE_STAGES.map((stage, index) => (
            <li key={stage} className="flex items-center gap-1.5">
              <span className="whitespace-nowrap rounded border border-holo-glow/25 bg-holo-glow/[0.05] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-holo-glow/75">
                {stage}
              </span>
              {index < AI_PIPELINE_STAGES.length - 1 && (
                <span aria-hidden className="font-mono text-[10px] text-holo-glow/30">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-2 border-t border-holo-glow/10 pt-2 font-mono text-[9.5px] leading-relaxed text-holo-glow/50">
          Traditional practice reacts once buses are already bunched. The approach demonstrated here
          detects the disturbance, predicts the resulting headways, simulates the corridor-wide
          effect of candidate interventions, selects a coordinated correction and recalculates —
          repeating until spacing is restored. Every action is a recommendation for dispatcher
          review; nothing is transmitted to a driver, and no traffic-signal control is involved.
        </p>
      </div>
    </section>
  );
}

function Block({
  title,
  body,
  accent,
}: {
  title: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <article
      className={`rounded-lg border p-3 ${
        accent
          ? 'border-holo-teal/30 bg-holo-teal/[0.04]'
          : 'border-holo-glow/20 bg-void-900/60'
      }`}
    >
      <h3
        className={`mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] ${
          accent ? 'text-holo-teal' : 'text-holo-glow'
        }`}
      >
        {title}
      </h3>
      <p className="font-mono text-[10px] leading-relaxed text-holo-glow/65">{body}</p>
    </article>
  );
}
